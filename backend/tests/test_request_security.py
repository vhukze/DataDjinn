import asyncio
import importlib
import os
import threading
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from starlette.requests import Request
from starlette.responses import JSONResponse

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

    def test_database_requests_receive_a_structured_connection_unavailable_code(self) -> None:
        import app.main as main_module

        with patch.object(main_module.connection_manager, "ensure_connection_available", return_value=False):
            response = TestClient(main_module.app).post(
                "/api/query",
                json={"connection_id": "stale-connection", "sql": "SELECT 1"},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error_code"], "CONNECTION_UNAVAILABLE")


class LocalApiConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_connection_health_check_does_not_block_the_async_event_loop(self) -> None:
        import app.main as main_module

        request = Request({
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/connections/stale-connection/tables",
            "raw_path": b"/api/connections/stale-connection/tables",
            "query_string": b"",
            "headers": [],
            "server": ("localhost", 8000),
            "client": ("localhost", 50000),
        })
        release_check = threading.Event()
        connection_check_thread_ids: list[int] = []
        event_loop_thread_id = threading.get_ident()

        def slow_connection_check(*args: object, **kwargs: object) -> bool:
            connection_check_thread_ids.append(threading.get_ident())
            release_check.wait(timeout=1)
            return True

        async def event_loop_heartbeat() -> bool:
            await asyncio.sleep(0.02)
            event_loop_remained_responsive = not release_check.is_set()
            if event_loop_remained_responsive:
                release_check.set()
            return event_loop_remained_responsive

        async def call_next(_request: Request) -> JSONResponse:
            return JSONResponse({"ok": True})

        with patch.object(
            main_module.connection_manager,
            "ensure_connection_available",
            side_effect=slow_connection_check,
        ):
            request_task = asyncio.create_task(main_module.protect_local_api(request, call_next))
            heartbeat_before_release = await event_loop_heartbeat()
            await request_task

        self.assertTrue(heartbeat_before_release)
        self.assertNotEqual(connection_check_thread_ids, [event_loop_thread_id])


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
