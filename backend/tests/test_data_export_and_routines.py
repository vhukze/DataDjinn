from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app.api.metadata import execute_routine_endpoint
from app.api.backup import create_backup as create_backup_api
from app.db.backup_manager import BackupManager, _generate_postgresql_backup_internal
from app.db.data_export import parse_csv_text_value, write_tabular_export
from app.db.metadata import (
    _build_pg_table_ddl,
    _update_sqlite_table_columns_v2,
    build_mysql_update_statements,
    ensure_ddl_terminator,
    list_columns,
)
from app.db.routine_executor import coerce_routine_value, execute_routine, list_routine_parameters
from app.schemas.backup import BackupCreateRequest, BackupRecord, ResultExportRequest
from app.schemas.connection import ConnectionRequest
from app.schemas.metadata import ColumnInfo, RoutineArgumentValue, RoutineExecuteRequest, RoutineParameterInfo, TableUpdateColumn


class DataExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.columns = ["id", "name", "note"]
        self.rows = [
            {"id": 1, "name": "alpha", "note": None},
            {"id": 2, "name": "beta", "note": "a|b"},
        ]

    def test_postgresql_backup_keeps_physical_database_and_schema_separate(self) -> None:
        request = ConnectionRequest(
            name="PostgreSQL",
            database_type="postgresql",
            host="localhost",
            port=5432,
            username="user",
            database="default_db",
        )
        engine = object()
        output_path = self.root / "postgres.sql"
        manager = BackupManager()
        with (
            patch("app.db.backup_manager.connection_manager.get_connection_request", return_value=request),
            patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine),
            patch("app.db.backup_manager.connection_manager._connections", {"pg": SimpleNamespace(name="PostgreSQL")}),
            patch("app.db.backup_manager._generate_postgresql_backup", return_value="-- backup") as generate_backup,
            patch.object(manager, "_save"),
        ):
            record = manager.create_backup(
                "pg", database="sales", pg_database="analytics", output_path=str(output_path)
            )

        generate_backup.assert_called_once_with(engine, "analytics", "sales")
        self.assertEqual("analytics", record.database)
        self.assertEqual("analytics", record.pg_database)
        self.assertEqual("sales", record.schema_name)
        self.assertEqual("-- backup", output_path.read_text(encoding="utf-8"))
        with (
            patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine),
            patch(
                "app.db.backup_manager.execute_sql_file",
                return_value=SimpleNamespace(failed_count=0),
            ) as execute_file,
        ):
            manager.restore_backup(record.id)
        execute_file.assert_called_once_with(engine, "-- backup", None, "analytics")

    def test_postgresql_backup_api_forwards_database_and_schema_separately(self) -> None:
        backup = BackupRecord(
            id="backup-1",
            connection_id="pg",
            connection_name="PostgreSQL",
            database_type="postgresql",
            database="analytics",
            pg_database="analytics",
            schema_name="sales",
            file_path="C:/backup.sql",
            created_at=datetime.now(),
            status="completed",
        )
        request = BackupCreateRequest(
            connection_id="pg",
            database="sales",
            pg_database="analytics",
        )

        with patch("app.api.backup.backup_manager.create_backup", return_value=backup) as create_backup:
            result = create_backup_api(request)

        create_backup.assert_called_once_with("pg", "sales", None, pg_database="analytics")
        self.assertTrue(result.success)

    def test_postgresql_database_backup_covers_user_schemas(self) -> None:
        sqlite_engine = create_engine("sqlite://")
        connection = MagicMock()
        connection_context = MagicMock()
        connection_context.__enter__.return_value = connection
        engine = SimpleNamespace(
            dialect=sqlite_engine.dialect,
            connect=MagicMock(return_value=connection_context),
        )
        inspector = MagicMock()
        inspector.get_schema_names.return_value = ["public", "reporting", "pg_catalog", "information_schema"]
        inspector.get_table_names.side_effect = lambda schema: ["items"]
        inspector.get_columns.return_value = [
            {"name": "id", "type": "INTEGER", "nullable": False, "primary_key": True}
        ]
        try:
            with (
                patch("app.db.backup_manager.inspect", return_value=inspector),
                patch(
                    "app.db.backup_manager._build_pg_table_ddl",
                    side_effect=lambda _engine, table, schema, include_foreign_keys: (
                        f"CREATE TABLE {schema}.{table} (id INTEGER);"
                    ),
                ),
                patch(
                    "app.db.backup_manager._pg_table_constraints",
                    side_effect=lambda _engine, _table, schema: (
                        [("fk_items", "f", "FOREIGN KEY (id) REFERENCES public.items (id)")]
                        if schema == "reporting"
                        else []
                    ),
                ),
                patch("app.db.backup_manager.list_columns", return_value=[]),
            ):
                sql = _generate_postgresql_backup_internal(engine)
        finally:
            sqlite_engine.dispose()

        self.assertIn("CREATE SCHEMA IF NOT EXISTS public;", sql)
        self.assertIn("CREATE SCHEMA IF NOT EXISTS reporting;", sql)
        self.assertIn("CREATE TABLE public.items", sql)
        self.assertIn("CREATE TABLE reporting.items", sql)
        self.assertIn(
            "ALTER TABLE reporting.items ADD CONSTRAINT fk_items "
            "FOREIGN KEY (id) REFERENCES public.items (id);",
            sql,
        )
        self.assertLess(sql.index("CREATE TABLE reporting.items"), sql.index("ALTER TABLE reporting.items"))
        self.assertNotIn("pg_catalog", sql)

    def test_postgresql_table_ddl_recreates_identity_columns(self) -> None:
        engine = create_engine("sqlite://")
        try:
            with (
                patch(
                    "app.db.metadata.list_columns",
                    return_value=[
                        ColumnInfo(
                            name="id",
                            type="INTEGER",
                            nullable=False,
                            primary_key=True,
                            auto_increment=True,
                            auto_increment_step=5,
                        )
                    ],
                ),
                patch("app.db.metadata._pg_table_constraints", return_value=[]),
                patch("app.db.metadata._pg_non_constraint_indexes", return_value=[]),
                patch("app.db.metadata.get_table_comment", return_value=None),
            ):
                ddl = _build_pg_table_ddl(engine, "items", "public")
        finally:
            engine.dispose()

        self.assertIn("GENERATED BY DEFAULT AS IDENTITY (INCREMENT BY 5)", ddl)

    def test_sqlite_table_rebuild_preserves_defaults_indexes_and_triggers(self) -> None:
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT DEFAULT 'legacy')"))
                connection.execute(text("CREATE INDEX idx_items_value ON items (value)"))
                connection.execute(text("CREATE TABLE audit (value TEXT)"))
                connection.execute(
                    text(
                        "CREATE TRIGGER items_update_audit AFTER UPDATE ON items "
                        "BEGIN INSERT INTO audit VALUES (NEW.value); END"
                    )
                )
                connection.execute(text("INSERT INTO items (id, value) VALUES (1, 'before')"))

            _update_sqlite_table_columns_v2(
                engine,
                "items",
                [
                    TableUpdateColumn(name="id", type="INTEGER", nullable=False, primary_key=True),
                    TableUpdateColumn(name="value", type="TEXT", nullable=True, primary_key=False),
                ],
            )

            columns = list_columns(engine, "items")
            with engine.begin() as connection:
                index_sql = connection.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_items_value'")
                ).scalar_one()
                trigger_sql = connection.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='items_update_audit'")
                ).scalar_one()
                connection.execute(text("UPDATE items SET value='after' WHERE id=1"))
                audit_value = connection.execute(text("SELECT value FROM audit")).scalar_one()
                connection.execute(text("INSERT INTO items (id) VALUES (2)"))
                default_value = connection.execute(text("SELECT value FROM items WHERE id=2")).scalar_one()

            self.assertEqual("'legacy'", next(column for column in columns if column.name == "value").default_value)
            self.assertIn("CREATE INDEX", index_sql)
            self.assertIn("CREATE TRIGGER", trigger_sql)
            self.assertEqual("after", audit_value)
            self.assertEqual("legacy", default_value)
        finally:
            engine.dispose()

    def test_mysql_update_definition_retains_existing_column_default(self) -> None:
        engine = create_engine("sqlite://")
        mysql_engine = SimpleNamespace(
            dialect=SimpleNamespace(
                name="mysql",
                identifier_preparer=engine.dialect.identifier_preparer,
            )
        )
        current_column = ColumnInfo(
            name="value",
            type="VARCHAR(20)",
            nullable=True,
            primary_key=False,
            default_value="'legacy'",
        )
        try:
            with (
                patch("app.db.metadata.list_columns", return_value=[current_column]),
                patch("app.db.metadata._mysql_single_column_unique_indexes", return_value={}),
            ):
                statements = build_mysql_update_statements(
                    mysql_engine,
                    "items",
                    [TableUpdateColumn(name="value", type="VARCHAR(40)", nullable=True, primary_key=False)],
                )
            self.assertIn("DEFAULT 'legacy'", statements[0])
        finally:
            engine.dispose()

    def test_csv_json_and_markdown_exports_keep_selected_columns(self) -> None:
        csv_path = self.root / "rows.csv"
        json_path = self.root / "rows.json"
        markdown_path = self.root / "rows.md"

        write_tabular_export(csv_path, "csv", ["name", "note"], self.rows)
        write_tabular_export(json_path, "json", ["name"], self.rows)
        write_tabular_export(markdown_path, "markdown", ["name", "note"], self.rows)

        self.assertEqual(csv_path.read_text(encoding="utf-8-sig"), "name,note\nalpha,\\N\nbeta,a|b\n")
        self.assertIsNone(parse_csv_text_value(r"\N"))
        self.assertEqual(parse_csv_text_value(""), "")
        self.assertEqual(
            json.loads(json_path.read_text(encoding="utf-8")),
            [{"name": "alpha"}, {"name": "beta"}],
        )
        markdown = markdown_path.read_text(encoding="utf-8")
        self.assertIn("| name | note |", markdown)
        self.assertIn("| beta | a\\|b |", markdown)

    def test_csv_import_preserves_null_empty_and_literal_null_marker(self) -> None:
        from app.db.backup_manager import BackupManager

        csv_path = self.root / "null-values.csv"
        csv_path.write_text(
            'id,note\n1,\\N\n2,""\n3,\\\\N\n', encoding="utf-8"
        )
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE values_table (id INTEGER, note TEXT)"))

            BackupManager()._import_csv_with_engine(engine, csv_path, None, "values_table")

            with engine.connect() as connection:
                values = connection.execute(
                    text("SELECT id, note FROM values_table ORDER BY id")
                ).all()
            self.assertEqual(values, [(1, None), (2, ""), (3, r"\N")])
        finally:
            engine.dispose()

    def test_sql_export_contains_only_selected_data_columns(self) -> None:
        sql_path = self.root / "rows.sql"

        write_tabular_export(
            sql_path,
            "sql",
            ["name"],
            self.rows,
            table_name='"main"."items"',
            quote_identifier=lambda value: f'"{value}"',
        )

        sql = sql_path.read_text(encoding="utf-8")
        self.assertIn('INSERT INTO "main"."items" ("name") VALUES (\'alpha\');', sql)
        self.assertNotIn('"id"', sql)

    def test_query_result_rejects_sql_export_without_target_table(self) -> None:
        with self.assertRaisesRegex(ValueError, "查询结果不支持导出为 SQL"):
            write_tabular_export(
                self.root / "query.sql",
                "sql",
                self.columns,
                self.rows,
            )

    def test_result_export_respects_page_scope_filter_sort_and_selected_columns(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, active INTEGER)"))
            connection.execute(
                text("INSERT INTO items (id, name, active) VALUES (1, 'alpha', 1), (2, 'beta', 1), (3, 'gamma', 0)")
            )

        manager = BackupManager()
        current_page_path = self.root / "current.json"
        all_rows_path = self.root / "all.md"
        with patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine):
            manager.export_result_data(
                ResultExportRequest(
                    connection_id="sqlite-test",
                    source="table",
                    format="json",
                    output_path=str(current_page_path),
                    columns=["name"],
                    data_scope="current_page",
                    table="items",
                    where="active = 1",
                    sort_column="id",
                    sort_direction="descend",
                    limit=1,
                    offset=0,
                )
            )
            manager.export_result_data(
                ResultExportRequest(
                    connection_id="sqlite-test",
                    source="table",
                    format="markdown",
                    output_path=str(all_rows_path),
                    columns=["id", "name"],
                    data_scope="all",
                    table="items",
                    where="active = 1",
                    sort_column="id",
                    sort_direction="descend",
                    limit=1,
                    offset=1,
                )
            )

        self.assertEqual(json.loads(current_page_path.read_text(encoding="utf-8")), [{"name": "beta"}])
        all_rows = all_rows_path.read_text(encoding="utf-8")
        self.assertLess(all_rows.index("beta"), all_rows.index("alpha"))
        self.assertNotIn("gamma", all_rows)

    def test_structured_table_export_streams_all_rows_across_pages(self) -> None:
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)"))
            connection.execute(
                text("INSERT INTO items (id, value) VALUES (:id, :value)"),
                [{"id": index, "value": f"row-{index}"} for index in range(1205)],
            )

        json_path = self.root / "streamed.json"
        markdown_path = self.root / "streamed.md"
        manager = BackupManager()
        with patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine):
            manager._export_structured_tables(
                "sqlite-test", json_path, "json", None, None, "items", "table", None
            )
            manager._export_structured_tables(
                "sqlite-test", markdown_path, "markdown", None, None, "items", "table", None
            )

        rows = json.loads(json_path.read_text(encoding="utf-8"))
        self.assertEqual(1205, len(rows))
        self.assertEqual({"id": 1204, "value": "row-1204"}, rows[-1])
        markdown = markdown_path.read_text(encoding="utf-8")
        self.assertEqual(1209, len(markdown.splitlines()))
        self.assertIn("| 1204 | row-1204 |", markdown)

    def test_redis_json_export_does_not_truncate_after_one_hundred_thousand_keys(self) -> None:
        client = MagicMock()
        client.scan_iter.return_value = (f"key-{index}".encode() for index in range(100_005))
        client.type.return_value = b"string"
        client.get.return_value = b"value"
        client.ttl.return_value = -1
        output_path = self.root / "redis.json"

        with (
            patch("app.db.backup_manager.connection_manager.get_engine", return_value=client),
            patch("app.db.backup_manager.is_redis_client", return_value=True),
            patch("app.db.backup_manager.redis_client_for_database", return_value=client),
        ):
            BackupManager()._export_redis("redis-test", output_path, None, None, "database")

        exported = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(100_005, len(exported["keys"]))
        self.assertEqual("value", exported["keys"]["key-100004"]["value"])

    def test_table_result_sql_export_keeps_full_ddl_and_filters_only_insert_columns(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER)"
                )
            )
            connection.execute(text("INSERT INTO items VALUES (1, 'alpha', 1)"))

        output_path = self.root / "items.sql"
        with patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine):
            BackupManager().export_result_data(
                ResultExportRequest(
                    connection_id="sqlite-test",
                    source="table",
                    format="sql",
                    output_path=str(output_path),
                    columns=["name"],
                    data_scope="all",
                    table="items",
                )
            )

        sql = output_path.read_text(encoding="utf-8")
        self.assertIn(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER);",
            sql,
        )
        self.assertIn("INSERT INTO items (name) VALUES ('alpha');", sql)
        self.assertNotIn("INSERT INTO items (id", sql)

    def test_database_scope_expands_all_postgresql_schemas(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "postgresql"

        with (
            patch(
                "app.db.backup_manager.list_schemas",
                return_value=[SimpleNamespace(name="public"), SimpleNamespace(name="reporting")],
            ),
            patch(
                "app.db.backup_manager.list_tables",
                side_effect=[
                    [SimpleNamespace(name="users")],
                    [SimpleNamespace(name="daily_totals")],
                ],
            ) as list_tables_mock,
        ):
            targets = BackupManager._export_table_targets(
                engine,
                None,
                "analytics",
                None,
                "database",
            )

        self.assertEqual(
            targets,
            [
                ("public.users", "public", "users"),
                ("reporting.daily_totals", "reporting", "daily_totals"),
            ],
        )
        self.assertEqual(
            list_tables_mock.call_args_list,
            [
                call(engine, "public", "analytics"),
                call(engine, "reporting", "analytics"),
            ],
        )

    def test_database_sql_export_preserves_sqlite_indexes_and_triggers(self) -> None:
        database_path = self.root / "full.sqlite"
        connection = sqlite3.connect(database_path)
        try:
            connection.executescript(
                """
                CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
                CREATE INDEX idx_items_name ON items(name);
                CREATE TRIGGER trg_items_name AFTER INSERT ON items BEGIN
                  UPDATE items SET name = upper(name) WHERE id = NEW.id;
                END;
                """
            )
        finally:
            connection.close()

        engine = create_engine(f"sqlite:///{database_path.as_posix()}")
        self.addCleanup(engine.dispose)
        output_path = self.root / "full.sql"
        request = ConnectionRequest(
            name="SQLite fixture",
            database_type="sqlite",
            sqlite_path=str(database_path),
        )
        with (
            patch(
                "app.db.backup_manager.connection_manager.get_connection_request",
                return_value=request,
            ),
            patch("app.db.backup_manager.connection_manager.get_engine", return_value=engine),
        ):
            BackupManager().export_file(
                "sqlite-test",
                str(output_path),
                "sql",
                scope="database",
            )

        sql = output_path.read_text(encoding="utf-8")
        self.assertIn("CREATE INDEX idx_items_name", sql)
        self.assertIn("CREATE TRIGGER trg_items_name", sql)


class RoutineTests(unittest.TestCase):
    def test_invalid_routine_argument_returns_a_client_error_without_a_snapshot(self) -> None:
        request = RoutineExecuteRequest(
            arguments=[RoutineArgumentValue(name="missing", value="1")]
        )
        with (
            patch("app.api.metadata.connection_manager.get_engine", return_value=object()),
            patch("app.api.metadata.list_routine_parameters", return_value=[]),
            patch("app.api.metadata.database_versioning_service.complete_write_snapshot") as complete_snapshot,
        ):
            with self.assertRaises(HTTPException) as raised:
                execute_routine_endpoint("connection-1", "refresh_total", request)

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("参数不存在", raised.exception.detail)
        complete_snapshot.assert_called_once_with("connection-1", None, False)

    def test_routine_ddl_always_has_a_trailing_semicolon(self) -> None:
        self.assertEqual(
            ensure_ddl_terminator("CREATE PROCEDURE demo()\nBEGIN\n  SELECT 1;\nEND", "procedure"),
            "CREATE PROCEDURE demo()\nBEGIN\n  SELECT 1;\nEND;",
        )
        self.assertEqual(
            ensure_ddl_terminator("CREATE PROCEDURE demo() SELECT 1;", "procedure"),
            "CREATE PROCEDURE demo() SELECT 1;",
        )

    def test_routine_argument_values_follow_declared_types(self) -> None:
        self.assertEqual(coerce_routine_value("42", "INTEGER"), 42)
        self.assertEqual(coerce_routine_value("3.5", "DECIMAL"), 3.5)
        self.assertTrue(coerce_routine_value("true", "BOOLEAN"))
        self.assertEqual(coerce_routine_value('{"enabled": true}', "JSON"), {"enabled": True})
        self.assertIsNone(coerce_routine_value(None, "VARCHAR"))

    def test_routine_rejects_default_for_parameter_without_default_value(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "mysql"
        parameters = [
            RoutineParameterInfo(name="amount", mode="IN", data_type="INTEGER", position=1)
        ]

        with self.assertRaisesRegex(ValueError, "参数没有默认值：amount"):
            execute_routine(
                engine,
                "refresh_total",
                parameters,
                [RoutineArgumentValue(name="amount", use_default=True)],
                "app",
            )

    def test_mysql_parameter_metadata_does_not_reference_unsupported_default_column(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "mysql"
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.fetchall.return_value = [
            ("amount", "IN", "INTEGER", 1, None)
        ]

        parameters = list_routine_parameters(engine, "refresh_total", "app")

        statement = str(connection.execute.call_args.args[0])
        self.assertNotIn("parameter_default", statement)
        self.assertIn("NULL AS has_default", statement)
        self.assertFalse(parameters[0].has_default)

    def test_postgresql_parameter_metadata_resolves_trailing_defaults_from_pg_proc(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "postgresql"
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.fetchall.return_value = [
            ("threshold", "IN", "INTEGER", 1, True)
        ]

        parameters = list_routine_parameters(engine, "refresh_total", "public")

        statement = str(connection.execute.call_args.args[0])
        self.assertIn("JOIN pg_proc proc", statement)
        self.assertIn("proc.pronargdefaults", statement)
        self.assertTrue(parameters[0].has_default)

    def test_dameng_parameter_metadata_falls_back_to_procedure_ddl(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "dm"
        engine.url.username = "APP"
        connection = engine.connect.return_value.__enter__.return_value
        connection.execute.return_value.fetchall.return_value = []

        with patch(
            "app.db.routine_executor.get_object_ddl",
            return_value=(
                "CREATE OR REPLACE PROCEDURE generate_ds_stat(\n"
                "  datasource_id_int BIGINT,\n"
                "  target_name IN VARCHAR(200) DEFAULT 'all',\n"
                "  updated_count OUT INTEGER\n"
                ") AS\nBEGIN\n  NULL;\nEND;"
            ),
        ) as get_ddl:
            parameters = list_routine_parameters(engine, "generate_ds_stat", "APP")

        self.assertIn("ALL_ARGUMENTS", str(connection.execute.call_args.args[0]))
        get_ddl.assert_called_once_with(engine, "generate_ds_stat", "procedure", "APP")
        self.assertEqual(
            [(item.name, item.mode, item.data_type, item.has_default) for item in parameters],
            [
                ("datasource_id_int", "IN", "BIGINT", False),
                ("target_name", "IN", "VARCHAR(200)", True),
                ("updated_count", "OUT", "INTEGER", False),
            ],
        )

    def test_postgresql_execution_skips_default_and_returns_output_rows(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "postgresql"
        engine.dialect.identifier_preparer.quote.side_effect = lambda value: f'"{value}"'
        connection = engine.begin.return_value.__enter__.return_value
        result = MagicMock()
        result.returns_rows = True
        result.keys.return_value = ["out_value"]
        result.mappings.return_value.fetchall.return_value = [{"out_value": 9}]
        connection.execute.return_value = result
        parameters = [
            RoutineParameterInfo(
                name="threshold", mode="IN", data_type="INTEGER", position=1, has_default=True
            ),
            RoutineParameterInfo(name="factor", mode="IN", data_type="INTEGER", position=2),
            RoutineParameterInfo(name="out_value", mode="OUT", data_type="INTEGER", position=3),
        ]
        arguments = [
            RoutineArgumentValue(name="threshold", use_default=True),
            RoutineArgumentValue(name="factor", value="7"),
            RoutineArgumentValue(name="out_value", is_null=True),
        ]

        with patch("app.db.routine_executor.apply_query_timeout", return_value=nullcontext()):
            response = execute_routine(engine, "refresh_total", parameters, arguments, "public")

        statement = str(connection.execute.call_args.args[0])
        binds = connection.execute.call_args.args[1]
        self.assertNotIn("threshold", statement)
        self.assertIn('CALL "public"."refresh_total"', statement)
        self.assertEqual(binds, {"routine_arg_1": 7, "routine_arg_2": None})
        self.assertEqual(response.rows, [{"out_value": 9}])

    def test_mysql_execution_reads_out_parameters_from_driver_variables(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "mysql"
        raw_connection = engine.raw_connection.return_value
        cursor = raw_connection.cursor.return_value
        cursor.description = None
        cursor.nextset.return_value = False
        cursor.fetchone.return_value = [12]
        parameters = [
            RoutineParameterInfo(name="amount", mode="IN", data_type="INTEGER", position=1),
            RoutineParameterInfo(name="new_total", mode="OUT", data_type="INTEGER", position=2),
        ]
        arguments = [
            RoutineArgumentValue(name="amount", value="5"),
            RoutineArgumentValue(name="new_total", is_null=True),
        ]

        response = execute_routine(engine, "refresh_total", parameters, arguments, "app")

        cursor.callproc.assert_called_once_with("refresh_total", [5, None])
        cursor.execute.assert_any_call("SELECT @_refresh_total_1")
        self.assertEqual(response.rows, [{"new_total": 12}])
        raw_connection.commit.assert_called_once()

    def test_dameng_jdbc_execution_uses_positional_call_parameters(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "dm"
        engine.dialect.identifier_preparer.quote.side_effect = lambda value: f'"{value}"'
        raw_connection = engine.raw_connection.return_value
        cursor = raw_connection.cursor.return_value
        cursor.description = None
        cursor.nextset.return_value = False
        parameters = [
            RoutineParameterInfo(name="datasource_id_int", mode="IN", data_type="BIGINT", position=1)
        ]

        response = execute_routine(
            engine,
            "generate_ds_stat",
            parameters,
            [RoutineArgumentValue(name="datasource_id_int", value="929")],
            "APP",
        )

        cursor.execute.assert_called_once_with('CALL "APP"."generate_ds_stat"(?)', [929])
        self.assertEqual(response.rows, [{"message": "存储过程执行成功", "affected_rows": 0}])
        raw_connection.commit.assert_called_once()

    def test_oracle_execution_uses_named_parameters_and_returns_output_values(self) -> None:
        engine = MagicMock()
        engine.dialect.name = "oracle"
        engine.dialect.identifier_preparer.quote.side_effect = lambda value: f'"{value}"'
        raw_connection = engine.raw_connection.return_value
        cursor = raw_connection.cursor.return_value
        cursor.description = None
        cursor.nextset.return_value = False
        output_variable = cursor.var.return_value
        output_variable.getvalue.return_value = 21
        parameters = [
            RoutineParameterInfo(
                name="OPTIONAL_VALUE", mode="IN", data_type="INTEGER", position=1, has_default=True
            ),
            RoutineParameterInfo(name="RESULT_VALUE", mode="OUT", data_type="INTEGER", position=2),
        ]
        arguments = [
            RoutineArgumentValue(name="OPTIONAL_VALUE", use_default=True),
            RoutineArgumentValue(name="RESULT_VALUE", is_null=True),
        ]

        response = execute_routine(engine, "REFRESH_TOTAL", parameters, arguments, "APP")

        cursor.execute.assert_called_once_with(
            'BEGIN "APP"."REFRESH_TOTAL"("RESULT_VALUE" => :routine_arg_2); END;',
            {"routine_arg_2": output_variable},
        )
        self.assertEqual(response.rows, [{"RESULT_VALUE": 21}])
        raw_connection.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
