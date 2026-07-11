import importlib
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.db.query_timeout import apply_query_timeout
from app.request_context import reset_query_timeout_seconds, set_query_timeout_seconds


class LocalApiSecurityTests(unittest.TestCase):
    def test_local_api_requires_the_process_token_except_for_health(self) -> None:
        import app.main as main_module

        with patch.dict(os.environ, {"DATADJINN_API_TOKEN": "test-token"}, clear=False):
            protected_app = importlib.reload(main_module).app
            client = TestClient(protected_app)

            self.assertEqual(client.get("/api/health").status_code, 200)
            self.assertEqual(client.get("/api/connections").status_code, 401)
            self.assertEqual(
                client.get("/api/connections", headers={"X-DataDjinn-Api-Token": "test-token"}).status_code,
                200,
            )

        importlib.reload(main_module)


class QueryTimeoutTests(unittest.TestCase):
    def test_sqlite_timeout_interrupts_an_overdue_statement(self) -> None:
        engine = create_engine("sqlite://")
        timeout_token = set_query_timeout_seconds(0)
        try:
            with engine.connect() as connection:
                with apply_query_timeout(connection):
                    with self.assertRaises(Exception):
                        connection.execute(
                            text(
                                "WITH RECURSIVE numbers(value) AS "
                                "(SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < 1000000) "
                                "SELECT sum(value) FROM numbers"
                            )
                        ).scalar()
        finally:
            reset_query_timeout_seconds(timeout_token)
            engine.dispose()
