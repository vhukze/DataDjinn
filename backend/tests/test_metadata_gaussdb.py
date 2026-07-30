from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.db.metadata import create_database, drop_database
from app.db.readonly_query import execute_query
from app.db.sql_executor import execute_sql_file


class FakeJdbcConnection:
    def __init__(self) -> None:
        self.auto_commit = False
        self.auto_commit_updates: list[bool] = []

    def getAutoCommit(self) -> bool:
        return self.auto_commit

    def setAutoCommit(self, enabled: bool) -> None:
        self.auto_commit = enabled
        self.auto_commit_updates.append(enabled)


class FakeConnection:
    def __init__(self, jdbc_connection: FakeJdbcConnection) -> None:
        self.connection = SimpleNamespace(
            dbapi_connection=SimpleNamespace(_connection=SimpleNamespace(jconn=jdbc_connection))
        )
        self.statements: list[str] = []

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        return None

    def execute(self, statement) -> None:
        self.statements.append(str(statement))


class FakeGaussDbEngine:
    def __init__(self) -> None:
        self.jdbc_connection = FakeJdbcConnection()
        self.connection = FakeConnection(self.jdbc_connection)
        self.dialect = SimpleNamespace(
            name="gaussdb",
            identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"'),
        )

    def connect(self) -> FakeConnection:
        return self.connection

    def begin(self) -> None:
        raise AssertionError("高斯数据库的 CREATE/DROP DATABASE 不应使用事务执行")


class GaussDbMetadataTests(unittest.TestCase):
    def test_create_database_uses_native_jdbc_autocommit_and_restores_it(self) -> None:
        engine = FakeGaussDbEngine()

        created = create_database(engine, "analytics")

        self.assertEqual(created.name, "analytics")
        self.assertEqual(engine.connection.statements, ['CREATE DATABASE "analytics"'])
        self.assertEqual(engine.jdbc_connection.auto_commit_updates, [True, False])
        self.assertFalse(engine.jdbc_connection.auto_commit)

    def test_drop_database_uses_native_jdbc_autocommit_and_restores_it(self) -> None:
        engine = FakeGaussDbEngine()

        drop_database(engine, "analytics")

        self.assertEqual(engine.connection.statements, ['DROP DATABASE "analytics"'])
        self.assertEqual(engine.jdbc_connection.auto_commit_updates, [True, False])
        self.assertFalse(engine.jdbc_connection.auto_commit)

    def test_sql_editor_executes_database_ddl_with_native_jdbc_autocommit(self) -> None:
        engine = FakeGaussDbEngine()

        response = execute_query(engine, '-- 创建分析库\nCREATE DATABASE "analytics"', limit=1000)

        self.assertEqual(response.rows[0]["message"], "SQL 执行成功")
        self.assertTrue(engine.connection.statements[0].endswith('CREATE DATABASE "analytics"'))
        self.assertEqual(engine.jdbc_connection.auto_commit_updates, [True, False])

    def test_sql_editor_rejects_mixed_database_ddl_and_transactional_sql(self) -> None:
        engine = FakeGaussDbEngine()

        with self.assertRaisesRegex(ValueError, "不能与其他 SQL"):
            execute_query(engine, 'CREATE DATABASE "analytics"; CREATE TABLE items (id INTEGER)', limit=1000)

        self.assertEqual(engine.connection.statements, [])

    def test_sql_file_executes_database_ddl_with_native_jdbc_autocommit(self) -> None:
        engine = FakeGaussDbEngine()

        response = execute_sql_file(engine, 'CREATE DATABASE "analytics"; DROP DATABASE "analytics"')

        self.assertEqual(response.success_count, 2)
        self.assertEqual(response.failed_count, 0)
        self.assertEqual(engine.connection.statements, ['CREATE DATABASE "analytics"', 'DROP DATABASE "analytics"'])
        self.assertEqual(engine.jdbc_connection.auto_commit_updates, [True, False, True, False])

    def test_sql_file_rejects_mixed_database_ddl_and_transactional_sql(self) -> None:
        engine = FakeGaussDbEngine()

        with self.assertRaisesRegex(ValueError, "不能与其他 SQL"):
            execute_sql_file(engine, 'DROP DATABASE "analytics"; CREATE TABLE items (id INTEGER)')

        self.assertEqual(engine.connection.statements, [])


if __name__ == "__main__":
    unittest.main()
