from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy.engine import Engine

from app.db.connection_manager import ConnectionManager
from app.db.query_timeout import apply_query_timeout
from app.db.readonly_query import _split_sql_statements, _with_limit, count_readonly_query, execute_query
from app.request_context import reset_query_timeout_seconds, set_query_timeout_seconds
from app.schemas.connection import ConnectionRequest


class FakeClickHouseClient:
    def __init__(self) -> None:
        self.params: dict[str, str] = {}

    def get_client_setting(self, key: str) -> str | None:
        return self.params.get(key)

    def set_client_setting(self, key: str, value: object) -> None:
        self.params[key] = str(value)


class FakeClickHouseConnection:
    def __init__(self) -> None:
        self.dialect = SimpleNamespace(name="clickhousedb")
        self.client = FakeClickHouseClient()
        self.connection = SimpleNamespace(driver_connection=SimpleNamespace(client=self.client))
        self.executed: list[str] = []

    def execute(self, statement: object) -> None:
        self.executed.append(str(statement))


class SqlCommentNormalizationTests(unittest.TestCase):
    def test_formatted_sql_keeps_internal_comments_and_drops_trailing_comment_statement(self) -> None:
        sql = """-- 查询说明
SELECT
  id, -- 字段说明
  name
FROM system.tables
WHERE database = 'system';
-- 末尾说明
"""

        statements = _split_sql_statements(sql)

        self.assertEqual(len(statements), 1)
        self.assertIn("-- 字段说明", statements[0])
        self.assertNotIn("-- 末尾说明", statements[0])
        self.assertFalse(statements[0].rstrip().endswith(";"))

    def test_comment_only_text_has_no_executable_statement(self) -> None:
        self.assertEqual(_split_sql_statements("-- 只有注释\n-- 没有 SQL"), [])

    def test_limit_is_appended_after_comment_normalization(self) -> None:
        engine = SimpleNamespace(dialect=SimpleNamespace(name="clickhousedb"))
        statement = _split_sql_statements("SELECT * FROM system.tables; -- 末尾说明")[0]

        self.assertEqual(
            _with_limit(engine, statement, 1001, 0),
            "SELECT * FROM system.tables LIMIT 1001 OFFSET 0",
        )

    def test_comments_are_normalized_for_every_supported_sql_dialect(self) -> None:
        sql = """SELECT
  id, -- 字段说明
  name
FROM items;
-- 末尾说明
"""
        dialects = (
            "sqlite",
            "mysql",
            "postgresql",
            "dm",
            "dmPython",
            "gaussdb",
            "oracle",
            "clickhouse",
            "clickhousedb",
        )

        for dialect in dialects:
            with self.subTest(dialect=dialect):
                statements = _split_sql_statements(sql)
                self.assertEqual(len(statements), 1)
                self.assertIn("-- 字段说明", statements[0])
                self.assertNotIn("-- 末尾说明", statements[0])

                limited_sql = _with_limit(
                    SimpleNamespace(dialect=SimpleNamespace(name=dialect)),
                    statements[0],
                    101,
                )
                self.assertNotIn("-- 末尾说明", limited_sql)
                self.assertNotIn("; --", limited_sql)


class ClickHouseQueryPerformanceTests(unittest.TestCase):
    def test_timeout_uses_client_settings_without_extra_sql_round_trips(self) -> None:
        connection = FakeClickHouseConnection()
        timeout_token = set_query_timeout_seconds(900)
        try:
            with apply_query_timeout(connection):  # type: ignore[arg-type]
                self.assertEqual(connection.client.params["max_execution_time"], "900")
        finally:
            reset_query_timeout_seconds(timeout_token)

        self.assertEqual(connection.executed, [])
        self.assertNotIn("max_execution_time", connection.client.params)

    def test_clickhouse_engine_disables_pre_ping_and_can_switch_database_by_factory(self) -> None:
        manager = ConnectionManager()
        request = ConnectionRequest(
            name="ClickHouse",
            database_type="clickhouse",
            host="127.0.0.1",
            port=8123,
            username="default",
            database="default",
        )

        engine = manager._create_clickhouse_engine(request)
        try:
            self.assertIsInstance(engine, Engine)
            self.assertFalse(engine.pool._pre_ping)  # type: ignore[attr-defined]
            factory = getattr(engine, "_datadjinn_engine_factory", None)
            self.assertTrue(callable(factory))
            switched_engine = factory("system")
            try:
                self.assertEqual(switched_engine.url.database, "system")
                self.assertFalse(switched_engine.pool._pre_ping)  # type: ignore[attr-defined]
            finally:
                switched_engine.dispose()
        finally:
            engine.dispose()


class QueryPaginationTests(unittest.TestCase):
    def test_readonly_query_count_supports_last_page_navigation(self) -> None:
        from sqlalchemy import create_engine, text

        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY)"))
                connection.execute(
                    text(
                        "WITH RECURSIVE numbers(value) AS ("
                        "SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 601"
                        ") INSERT INTO items(id) SELECT value FROM numbers"
                    )
                )

            self.assertEqual(count_readonly_query(engine, "SELECT * FROM items"), 601)
        finally:
            engine.dispose()

    def test_clickhouse_query_switches_engine_without_sending_use_statement(self) -> None:
        manager = ConnectionManager()
        engine = manager._create_clickhouse_engine(
            ConnectionRequest(
                name="ClickHouse",
                database_type="clickhouse",
                host="127.0.0.1",
                port=8123,
                username="default",
                database="default",
            )
        )
        response = SimpleNamespace()

        try:
            with patch("app.db.readonly_query._execute_limited_query", return_value=response) as execute:
                actual = execute_query(engine, "SELECT 1", 1000, database="system")

            self.assertIs(actual, response)
            selected_engine = execute.call_args.args[0]
            self.assertEqual(selected_engine.url.database, "system")
            self.assertEqual(execute.call_args.args[1], "SELECT 1")
        finally:
            engine.dispose()

    def test_gaussdb_mutation_switches_to_selected_database_and_schema(self) -> None:
        base_engine = SimpleNamespace(dialect=SimpleNamespace(name="gaussdb"))
        selected_engine = SimpleNamespace(dialect=SimpleNamespace(name="gaussdb"), dispose=Mock())
        factory = Mock(return_value=selected_engine)
        base_engine._datadjinn_engine_factory = factory
        response = SimpleNamespace()

        with patch("app.db.readonly_query._execute_mutation_statements", return_value=response) as execute:
            actual = execute_query(
                base_engine,
                "CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)",
                None,
                database="test",
                pg_database="vhukze",
            )

        self.assertIs(actual, response)
        factory.assert_called_once_with("vhukze")
        execute.assert_called_once_with(
            selected_engine,
            ["CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)"],
            "test",
        )
        selected_engine.dispose.assert_called_once()

    def test_postgresql_mutation_switches_to_selected_database_and_schema(self) -> None:
        selected_engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), dispose=Mock())
        url = SimpleNamespace(set=Mock(return_value="postgresql://selected/vhukze"))
        base_engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), url=url)
        response = SimpleNamespace()

        with patch("sqlalchemy.create_engine", return_value=selected_engine) as create_engine, patch(
            "app.db.readonly_query._execute_mutation_statements", return_value=response
        ) as execute:
            actual = execute_query(
                base_engine,
                "CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)",
                None,
                database="test",
                pg_database="vhukze",
            )

        self.assertIs(actual, response)
        url.set.assert_called_once_with(database="vhukze")
        create_engine.assert_called_once_with("postgresql://selected/vhukze", pool_pre_ping=True)
        execute.assert_called_once_with(
            selected_engine,
            ["CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)"],
            "test",
        )
        selected_engine.dispose.assert_called_once()

    def test_mutation_preserves_context_for_database_and_schema_scoped_engines(self) -> None:
        sql = "CREATE TABLE test_department (dept_id INTEGER PRIMARY KEY)"
        cases = (
            ("mysql", "sales"),
            ("dm", "APP"),
            ("dmPython", "APP"),
            ("oracle", "APP"),
        )

        for dialect, database in cases:
            with self.subTest(dialect=dialect):
                engine = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
                response = SimpleNamespace()
                with patch("app.db.readonly_query._execute_mutation_statements", return_value=response) as execute:
                    actual = execute_query(engine, sql, None, database=database)

                self.assertIs(actual, response)
                execute.assert_called_once_with(engine, [sql], database)

    def test_clickhouse_mutation_switches_to_selected_database(self) -> None:
        selected_engine = SimpleNamespace(
            dialect=SimpleNamespace(name="clickhousedb"),
            url=SimpleNamespace(database="analytics"),
            dispose=Mock(),
        )
        factory = Mock(return_value=selected_engine)
        base_engine = SimpleNamespace(
            dialect=SimpleNamespace(name="clickhousedb"),
            url=SimpleNamespace(database="default"),
            _datadjinn_engine_factory=factory,
        )
        response = SimpleNamespace()

        with patch("app.db.readonly_query._execute_mutation_statements", return_value=response) as execute:
            actual = execute_query(
                base_engine,
                "CREATE TABLE test_department (dept_id INTEGER PRIMARY KEY)",
                None,
                database="analytics",
            )

        self.assertIs(actual, response)
        factory.assert_called_once_with("analytics")
        execute.assert_called_once_with(
            selected_engine,
            ["CREATE TABLE test_department (dept_id INTEGER PRIMARY KEY)"],
            None,
        )
        selected_engine.dispose.assert_called_once()


if __name__ == "__main__":
    unittest.main()
