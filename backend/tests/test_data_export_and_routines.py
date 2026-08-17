from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app.db.backup_manager import BackupManager
from app.db.data_export import write_tabular_export
from app.db.metadata import ensure_ddl_terminator
from app.db.routine_executor import coerce_routine_value, execute_routine, list_routine_parameters
from app.schemas.backup import ResultExportRequest
from app.schemas.connection import ConnectionRequest
from app.schemas.metadata import RoutineArgumentValue, RoutineParameterInfo


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

    def test_csv_json_and_markdown_exports_keep_selected_columns(self) -> None:
        csv_path = self.root / "rows.csv"
        json_path = self.root / "rows.json"
        markdown_path = self.root / "rows.md"

        write_tabular_export(csv_path, "csv", ["name", "note"], self.rows)
        write_tabular_export(json_path, "json", ["name"], self.rows)
        write_tabular_export(markdown_path, "markdown", ["name", "note"], self.rows)

        self.assertEqual(csv_path.read_text(encoding="utf-8-sig"), "name,note\nalpha,\nbeta,a|b\n")
        self.assertEqual(
            json.loads(json_path.read_text(encoding="utf-8")),
            [{"name": "alpha"}, {"name": "beta"}],
        )
        markdown = markdown_path.read_text(encoding="utf-8")
        self.assertIn("| name | note |", markdown)
        self.assertIn("| beta | a\\|b |", markdown)

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
