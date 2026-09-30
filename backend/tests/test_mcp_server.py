import json
import io
import os
import tempfile
import unittest
from concurrent.futures import CancelledError, ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from threading import Event, Lock
from unittest.mock import patch

from app import mcp_server
from app.mcp_server import (
    MAX_QUERY_ROWS,
    _run_tool,
    _configure_data_directory,
    _configure_optional_jdbc_runtime,
    _configure_stdio_encoding,
    _is_readonly_sql,
    handle_request,
)
from app.schemas.query import QueryResponse


class DataDjinnMcpServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = {
            "enabled": True,
            "allowWrite": False,
            "restrictConnections": False,
            "allowedConnectionIds": [],
        }
        self.settings_patcher = patch("app.mcp_server._mcp_settings", side_effect=lambda: self.settings)
        self.settings_patcher.start()
        self.module_patcher = patch("app.mcp_server._mcp_module_installed", return_value=True)
        self.module_patcher.start()

    def tearDown(self) -> None:
        self.settings_patcher.stop()
        self.module_patcher.stop()

    def test_uninstalled_module_rejects_requests_before_service_setting(self) -> None:
        self.module_patcher.stop()
        with patch("app.mcp_server._mcp_module_installed", return_value=False):
            response = handle_request({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}})

        self.assertEqual(response["error"]["code"], -32000)
        self.assertIn("模块未安装", response["error"]["message"])

    def test_disabled_mcp_rejects_all_requests_before_advertising_tools(self) -> None:
        self.settings["enabled"] = False

        response = handle_request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})

        self.assertEqual(response["error"]["code"], -32000)
        self.assertIn("未启用", response["error"]["message"])

    def test_initialize_advertises_stdio_tool_capability(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})

        self.assertEqual(response["result"]["serverInfo"]["name"], "datadjinn-local")
        self.assertEqual(response["result"]["capabilities"], {"tools": {}})

    def test_initialize_and_tools_list_do_not_load_database_runtime(self) -> None:
        with patch("app.mcp_server._load_database_runtime") as load_runtime:
            initialize = handle_request(
                {"jsonrpc": "2.0", "id": 20, "method": "initialize", "params": {}}
            )
            tools = handle_request(
                {"jsonrpc": "2.0", "id": 21, "method": "tools/list", "params": {}}
            )

        self.assertIn("result", initialize)
        self.assertIn("result", tools)
        load_runtime.assert_not_called()

    def test_mcp_uses_explicit_data_directory_without_overriding_it(self) -> None:
        with patch.dict(os.environ, {"DATADJINN_DATA_DIR": "C:\\custom\\DataDjinn"}, clear=True):
            _configure_data_directory()
            self.assertEqual(os.environ["DATADJINN_DATA_DIR"], "C:\\custom\\DataDjinn")

    def test_mcp_finds_data_directory_before_connections_are_saved(self) -> None:
        with tempfile.TemporaryDirectory() as data_root:
            data_dir = os.path.join(data_root, "datadjinn")
            os.makedirs(data_dir)
            with open(os.path.join(data_dir, "config.json"), "w", encoding="utf-8") as stream:
                stream.write("{}")
            with patch.dict(
                os.environ,
                {"APPDATA": data_root, "LOCALAPPDATA": "", "DATADJINN_DATA_DIR": ""},
                clear=True,
            ):
                _configure_data_directory()
                self.assertEqual(os.environ["DATADJINN_DATA_DIR"], data_dir)

    def test_mcp_finds_installed_jdbc_runtime_from_saved_modules(self) -> None:
        with tempfile.TemporaryDirectory() as data_root:
            data_dir = os.path.join(data_root, "datadjinn")
            runtime_dir = os.path.join(data_root, "jdbc-runtime")
            for marker in (
                os.path.join(runtime_dir, "python", "jpype", "__init__.py"),
                os.path.join(runtime_dir, "python", "jaydebeapi", "__init__.py"),
                os.path.join(runtime_dir, "python", "org.jpype.jar"),
            ):
                os.makedirs(os.path.dirname(marker), exist_ok=True)
                with open(marker, "w", encoding="utf-8"):
                    pass
            os.makedirs(data_dir)
            with open(os.path.join(data_dir, "config.json"), "w", encoding="utf-8") as stream:
                json.dump({"optionalModules": [{"id": "jdbc-runtime", "installPath": runtime_dir}]}, stream)

            with patch.dict(
                os.environ,
                {"DATADJINN_DATA_DIR": data_dir, "DATADJINN_JDBC_RUNTIME_PATH": ""},
                clear=False,
            ):
                _configure_optional_jdbc_runtime()
                self.assertEqual(os.environ["DATADJINN_JDBC_RUNTIME_PATH"], runtime_dir)

    def test_mcp_falls_back_to_stable_jdbc_runtime_directory(self) -> None:
        with tempfile.TemporaryDirectory() as data_root:
            data_dir = os.path.join(data_root, "datadjinn")
            runtime_dir = os.path.join(data_dir, "modules", "jdbc-runtime", "current")
            for marker in (
                os.path.join(runtime_dir, "python", "jpype", "__init__.py"),
                os.path.join(runtime_dir, "python", "jaydebeapi", "__init__.py"),
                os.path.join(runtime_dir, "python", "org.jpype.jar"),
            ):
                os.makedirs(os.path.dirname(marker), exist_ok=True)
                with open(marker, "w", encoding="utf-8"):
                    pass
            os.makedirs(data_dir, exist_ok=True)

            with patch.dict(
                os.environ,
                {"DATADJINN_DATA_DIR": data_dir, "DATADJINN_JDBC_RUNTIME_PATH": ""},
                clear=False,
            ):
                _configure_optional_jdbc_runtime()
                self.assertEqual(os.environ["DATADJINN_JDBC_RUNTIME_PATH"], runtime_dir)

    def test_mcp_preserves_explicit_jdbc_runtime_path(self) -> None:
        with patch.dict(
            os.environ,
            {"DATADJINN_DATA_DIR": "C:/DataDjinn", "DATADJINN_JDBC_RUNTIME_PATH": "C:/custom-jdbc"},
            clear=False,
        ):
            _configure_optional_jdbc_runtime()
            self.assertEqual(os.environ["DATADJINN_JDBC_RUNTIME_PATH"], "C:/custom-jdbc")

    def test_mcp_stdio_is_configured_for_utf8_json_rpc(self) -> None:
        input_stream = io.TextIOWrapper(io.BytesIO(), encoding="cp936")
        output_stream = io.TextIOWrapper(io.BytesIO(), encoding="cp936")
        error_stream = io.TextIOWrapper(io.BytesIO(), encoding="cp936")
        with patch("app.mcp_server.sys.stdin", input_stream), patch(
            "app.mcp_server.sys.stdout", output_stream
        ), patch("app.mcp_server.sys.stderr", error_stream):
            _configure_stdio_encoding()

        self.assertEqual("utf-8", input_stream.encoding.lower())
        self.assertEqual("utf-8", output_stream.encoding.lower())
        self.assertEqual("utf-8", error_stream.encoding.lower())
        input_stream.close()
        output_stream.close()
        error_stream.close()

    def test_ping_and_protocol_version_are_compatible_with_mcp_clients(self) -> None:
        ping = handle_request({"jsonrpc": "2.0", "id": 10, "method": "ping", "params": {}})
        initialize = handle_request(
            {
                "jsonrpc": "2.0",
                "id": 11,
                "method": "initialize",
                "params": {"protocolVersion": "2024-11-05"},
            }
        )

        self.assertEqual(ping["result"], {})
        self.assertEqual(initialize["result"]["protocolVersion"], "2024-11-05")
        instructions = initialize["result"]["instructions"]
        self.assertIn("open_connection 是可选的显式预热步骤", instructions)
        self.assertIn("完成一组操作后再调用 close_connection", instructions)
        self.assertIn("支持 SQLite、MySQL、PostgreSQL、GaussDB、达梦 DM、Oracle、ClickHouse、Elasticsearch、MongoDB 和 Redis", instructions)
        self.assertIn("confirm_write=true", instructions)

    def test_tools_list_exposes_connection_scoped_operations(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools = {tool["name"]: tool for tool in response["result"]["tools"]}

        self.assertTrue({"list_connections", "open_connection", "list_databases", "list_tables", "describe_table", "get_sample_data", "execute_query"}.issubset(tools))
        self.assertIn("connection_id", tools["execute_query"]["inputSchema"]["properties"])
        self.assertIn("confirm_write", tools["execute_query"]["inputSchema"]["properties"])
        self.assertIn("opened automatically", tools["list_tables"]["description"])
        self.assertIn("JSON Query DSL", tools["execute_query"]["description"])

    def test_mcp_open_connection_uses_the_shared_connection_manager(self) -> None:
        connection = type("Connection", (), {
            "connection_id": "connection_1",
            "name": "Local DB",
            "database_type": "mysql",
            "host": "db.internal",
            "port": 3306,
            "database": "app",
            "is_open": True,
            "server_version": "8.0",
        })()
        request = {
            "jsonrpc": "2.0",
            "id": 22,
            "method": "tools/call",
            "params": {
                "name": "open_connection",
                "arguments": {"connection_id": "connection_1"},
            },
        }

        with (
            patch("app.mcp_server._load_database_runtime"),
            patch("app.mcp_server._ensure_connection_allowed"),
            patch("app.mcp_server.connection_manager") as manager,
        ):
            manager.open_connection.return_value = connection
            response = handle_request(request)

        manager.open_connection.assert_called_once_with("connection_1")
        result = json.loads(response["result"]["content"][0]["text"])
        self.assertEqual(result["connection_id"], "connection_1")

    def test_list_connections_never_returns_password_or_ssh_secrets(self) -> None:
        connection = type(
            "Connection",
            (),
            {
                "connection_id": "connection_1",
                "name": "Local DB",
                "database_type": "sqlite",
                "host": None,
                "port": None,
                "database": "main",
                "is_open": False,
                "server_version": None,
                "password": "secret",
                "ssh_password": "ssh-secret",
            },
        )()
        request = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_connections", "arguments": {}}}

        with patch("app.mcp_server.connection_manager.list_connections", return_value=[connection]):
            response = handle_request(request)

        payload = response["result"]["content"][0]["text"]
        self.assertIn("connection_1", payload)
        self.assertNotIn("secret", payload)
        self.assertNotIn("password", payload)

    def test_write_query_requires_explicit_confirmation(self) -> None:
        self.settings["allowWrite"] = True
        request = {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "execute_query", "arguments": {"connection_id": "connection_1", "sql": "DELETE FROM audit_log"}},
        }

        with patch("app.mcp_server._connection", return_value=object()), patch("app.mcp_server.execute_query") as execute:
            response = handle_request(request)

        self.assertTrue(response["result"]["isError"])
        self.assertIn("confirm_write=true", response["result"]["content"][0]["text"])
        execute.assert_not_called()

    def test_write_query_requires_setting_authorization_even_when_confirmed(self) -> None:
        request = {
            "jsonrpc": "2.0",
            "id": 41,
            "method": "tools/call",
            "params": {
                "name": "execute_query",
                "arguments": {"connection_id": "connection_1", "sql": "DELETE FROM audit_log", "confirm_write": True},
            },
        }

        with patch("app.mcp_server._connection", return_value=object()), patch("app.mcp_server.execute_query") as execute:
            response = handle_request(request)

        self.assertTrue(response["result"]["isError"])
        self.assertIn("写操作未启用", response["result"]["content"][0]["text"])
        execute.assert_not_called()

    def test_connection_restriction_filters_list_and_blocks_direct_access(self) -> None:
        self.settings.update({"restrictConnections": True, "allowedConnectionIds": ["connection_1"]})
        allowed = type("Connection", (), {"connection_id": "connection_1", "name": "Allowed", "database_type": "sqlite", "host": None, "port": None, "database": None, "is_open": False, "server_version": None})()
        blocked = type("Connection", (), {"connection_id": "connection_2", "name": "Blocked", "database_type": "sqlite", "host": None, "port": None, "database": None, "is_open": False, "server_version": None})()
        list_request = {"jsonrpc": "2.0", "id": 42, "method": "tools/call", "params": {"name": "list_connections", "arguments": {}}}
        direct_request = {"jsonrpc": "2.0", "id": 43, "method": "tools/call", "params": {"name": "open_connection", "arguments": {"connection_id": "connection_2"}}}

        with patch("app.mcp_server._load_database_runtime"), patch("app.mcp_server.connection_manager") as manager:
            manager.list_connections.return_value = [allowed, blocked]
            listed = handle_request(list_request)
        blocked_result = handle_request(direct_request)

        payload = listed["result"]["content"][0]["text"]
        self.assertIn("connection_1", payload)
        self.assertNotIn("connection_2", payload)
        self.assertTrue(blocked_result["result"]["isError"])
        self.assertIn("未获 MCP 访问授权", blocked_result["result"]["content"][0]["text"])

    def test_confirmed_write_keeps_selected_connection_and_database(self) -> None:
        self.settings["allowWrite"] = True
        response = QueryResponse(columns=[], rows=[], row_count=0, limited=False)
        request = {
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "execute_query",
                "arguments": {"connection_id": "connection_1", "sql": "DELETE FROM audit_log", "database": "analytics", "confirm_write": True},
            },
        }

        with (
            patch("app.mcp_server._connection", return_value="engine") as connection,
            patch("app.git_versioning.database_history.database_versioning_service.prepare_write_snapshot", return_value=None),
            patch("app.git_versioning.database_history.database_versioning_service.complete_write_snapshot"),
            patch("app.mcp_server._db_execute_query", return_value=response) as execute,
        ):
            result = handle_request(request)

        connection.assert_called_once_with("connection_1")
        execute.assert_called_once_with("engine", "DELETE FROM audit_log", 200, 0, "analytics", None)
        self.assertFalse(result["result"].get("isError", False))

    def test_write_cte_requires_confirmation_and_prepares_a_snapshot(self) -> None:
        self.settings["allowWrite"] = True
        sql = "WITH removed AS (DELETE FROM audit_log RETURNING *) SELECT * FROM removed"
        request = {
            "jsonrpc": "2.0",
            "id": 25,
            "method": "tools/call",
            "params": {
                "name": "execute_query",
                "arguments": {"connection_id": "connection_1", "sql": sql, "confirm_write": True},
            },
        }
        response = QueryResponse(columns=[], rows=[], row_count=0, limited=False)

        with (
            patch("app.mcp_server._connection", return_value="engine"),
            patch(
                "app.git_versioning.database_history.database_versioning_service.prepare_write_snapshot",
                return_value="snapshot-1",
            ) as prepare_snapshot,
            patch("app.git_versioning.database_history.database_versioning_service.complete_write_snapshot"),
            patch("app.mcp_server._db_execute_query", return_value=response) as execute,
        ):
            result = handle_request(request)

        self.assertFalse(result["result"].get("isError", False))
        prepare_snapshot.assert_called_once_with("connection_1", "MCP 写入前快照")
        execute.assert_called_once()

    def test_show_create_table_is_readonly_without_prefix_collision(self) -> None:
        self.assertTrue(_is_readonly_sql("SHOW CREATE TABLE orders"))
        self.assertFalse(_is_readonly_sql("SHOWCASE orders"))

    def test_mcp_database_listing_requests_lightweight_metadata(self) -> None:
        with (
            patch("app.mcp_server._connection", return_value="engine"),
            patch("app.mcp_server._metadata_list_databases", return_value=["database"]) as list_databases,
        ):
            result = mcp_server.list_databases("connection_1")

        list_databases.assert_called_once_with("engine", include_stats=False)
        self.assertEqual(result["databases"], ["database"])

    def test_same_connection_mcp_tools_are_serialized(self) -> None:
        first_started = Event()
        release_first = Event()
        second_entered = Event()
        state_lock = Lock()
        active_calls = 0
        max_active_calls = 0

        def probe(**_: object) -> dict[str, str]:
            nonlocal active_calls, max_active_calls
            with state_lock:
                active_calls += 1
                max_active_calls = max(max_active_calls, active_calls)
            try:
                if not first_started.is_set():
                    first_started.set()
                    release_first.wait(2)
                else:
                    second_entered.set()
                return {"status": "ok"}
            finally:
                with state_lock:
                    active_calls -= 1

        with patch.dict(mcp_server.TOOL_HANDLERS, {"probe": probe}):
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(_run_tool, "probe", {"connection_id": "connection_1"})
                self.assertTrue(first_started.wait(1))
                second = executor.submit(_run_tool, "probe", {"connection_id": "connection_1"})
                self.assertFalse(second_entered.wait(0.1))
                release_first.set()
                self.assertEqual(first.result(), {"status": "ok"})
                self.assertEqual(second.result(), {"status": "ok"})

        self.assertEqual(max_active_calls, 1)

    def test_mcp_tool_applies_request_query_timeout_to_handler(self) -> None:
        from app.request_context import get_query_timeout_seconds

        def probe(**_: object) -> dict[str, int]:
            return {"timeout": get_query_timeout_seconds()}

        with patch.dict(mcp_server.TOOL_HANDLERS, {"probe": probe}):
            result = _run_tool("probe", {"connection_id": "connection_1"})

        self.assertEqual(result, {"timeout": mcp_server.MCP_QUERY_TIMEOUT_SECONDS})

    def test_tool_timeout_defers_reset_without_replacing_the_connection_lock(self) -> None:
        class TimedOutFuture:
            def result(self, timeout: float) -> dict[str, str]:
                raise FutureTimeoutError()

            def cancel(self) -> bool:
                return False

        class FakeExecutor:
            def submit(self, _handler: object, _name: str, _arguments: dict, control: object) -> TimedOutFuture:
                control.try_start()
                return TimedOutFuture()

        connection_id = "timed-out-connection"
        old_lock = mcp_server._connection_tool_lock(connection_id)
        with (
            patch.object(mcp_server, "_tool_executor", FakeExecutor()),
            patch.object(mcp_server, "_reset_timed_out_connection") as reset,
            patch.dict(mcp_server.TOOL_HANDLERS, {"probe": lambda **_: {"status": "ok"}}),
        ):
            response = handle_request(
                {
                    "jsonrpc": "2.0",
                    "id": 42,
                    "method": "tools/call",
                    "params": {
                        "name": "probe",
                        "arguments": {"connection_id": connection_id},
                    },
                }
            )
            self.assertIs(mcp_server._connection_tool_lock(connection_id), old_lock)
            self.assertIn(connection_id, mcp_server._connections_pending_reset)
            reset.assert_not_called()

            with self.assertRaisesRegex(RuntimeError, "正在释放上一次超时操作"):
                _run_tool("probe", {"connection_id": connection_id})

            mcp_server._reset_connection_if_pending(connection_id)

        self.assertTrue(response["result"]["isError"])
        self.assertIn("结束后会重置连接", response["result"]["content"][0]["text"])
        reset.assert_called_once_with(connection_id)
        self.assertNotIn(connection_id, mcp_server._connections_pending_reset)

    def test_pending_reset_rejects_new_tool_without_reusing_the_connection(self) -> None:
        connection_id = "pending-reset-connection"
        with mcp_server._connection_tool_locks_guard:
            mcp_server._connections_pending_reset.add(connection_id)
        try:
            with patch.dict(
                mcp_server.TOOL_HANDLERS,
                {"probe": lambda **_: self.fail("handler ran")},
            ):
                with self.assertRaisesRegex(RuntimeError, "正在释放上一次超时操作"):
                    _run_tool("probe", {"connection_id": connection_id})
        finally:
            with mcp_server._connection_tool_locks_guard:
                mcp_server._connections_pending_reset.discard(connection_id)

    def test_timed_out_tool_waiting_for_lock_does_not_execute_later(self) -> None:
        connection_id = "cancelled-queued-connection"
        control = mcp_server._ToolCallControl()
        self.assertEqual("queued", control.cancel())
        with patch.dict(
            mcp_server.TOOL_HANDLERS,
            {"probe": lambda **_: self.fail("handler ran")},
        ):
            with self.assertRaises(CancelledError):
                _run_tool("probe", {"connection_id": connection_id}, control)

    def test_queued_tool_timeout_does_not_claim_connection_will_reset(self) -> None:
        class TimedOutFuture:
            def result(self, timeout: float) -> dict[str, str]:
                raise FutureTimeoutError()

            def cancel(self) -> bool:
                return True

        class FakeExecutor:
            def submit(self, _handler: object, _name: str, _arguments: dict, _control: object) -> TimedOutFuture:
                return TimedOutFuture()

        connection_id = "queued-timeout-connection"
        with (
            patch.object(mcp_server, "_tool_executor", FakeExecutor()),
            patch.dict(mcp_server.TOOL_HANDLERS, {"probe": lambda **_: {"status": "ok"}}),
        ):
            response = handle_request(
                {
                    "jsonrpc": "2.0",
                    "id": 43,
                    "method": "tools/call",
                    "params": {
                        "name": "probe",
                        "arguments": {"connection_id": connection_id},
                    },
                }
            )

        self.assertTrue(response["result"]["isError"])
        message = response["result"]["content"][0]["text"]
        self.assertIn("尚未开始的排队调用已取消", message)
        self.assertIn("不会重置连接", message)
        self.assertNotIn(connection_id, mcp_server._connections_pending_reset)

    def test_finished_tool_timeout_does_not_claim_it_was_cancelled_or_reset(self) -> None:
        class TimedOutFuture:
            def result(self, timeout: float) -> dict[str, str]:
                raise FutureTimeoutError()

            def cancel(self) -> bool:
                return False

        class FakeExecutor:
            def submit(self, _handler: object, _name: str, _arguments: dict, control: object) -> TimedOutFuture:
                control.try_start()
                control.finish()
                return TimedOutFuture()

        connection_id = "finished-timeout-connection"
        with (
            patch.object(mcp_server, "_tool_executor", FakeExecutor()),
            patch.dict(mcp_server.TOOL_HANDLERS, {"probe": lambda **_: {"status": "ok"}}),
        ):
            response = handle_request(
                {
                    "jsonrpc": "2.0",
                    "id": 44,
                    "method": "tools/call",
                    "params": {
                        "name": "probe",
                        "arguments": {"connection_id": connection_id},
                    },
                }
            )

        message = response["result"]["content"][0]["text"]
        self.assertIn("刚在超时边界结束", message)
        self.assertNotIn("已取消", message)
        self.assertNotIn(connection_id, mcp_server._connections_pending_reset)

    def test_readonly_detection_does_not_allow_mongo_or_redis_writes(self) -> None:
        self.assertTrue(_is_readonly_sql("db.orders.find({})"))
        self.assertFalse(_is_readonly_sql("db.orders.insertOne({})"))
        self.assertFalse(_is_readonly_sql("db.orders.insertOne({}); db.orders.find({})"))
        self.assertFalse(_is_readonly_sql("WITH removed AS (DELETE FROM items RETURNING *) SELECT * FROM removed"))
        self.assertFalse(_is_readonly_sql("EXPLAIN ANALYZE DELETE FROM items"))
        self.assertFalse(_is_readonly_sql("PRAGMA journal_mode=WAL"))
        self.assertTrue(_is_readonly_sql("GET session:1"))
        self.assertFalse(_is_readonly_sql("SET session:1 value"))

    def test_query_limit_is_capped(self) -> None:
        response = QueryResponse(columns=[], rows=[], row_count=0, limited=False)
        request = {
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {"name": "execute_query", "arguments": {"connection_id": "connection_1", "sql": "SELECT 1", "limit": MAX_QUERY_ROWS + 1}},
        }

        with patch("app.mcp_server._connection", return_value="engine"), patch("app.mcp_server._db_execute_readonly_query", return_value=response) as execute:
            handle_request(request)

        execute.assert_called_once_with("engine", "SELECT 1", MAX_QUERY_ROWS, 0, None, None)

    def test_invalid_tool_returns_mcp_error_result(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "missing", "arguments": {}}})

        self.assertTrue(response["result"]["isError"])
        self.assertIn("未知工具", response["result"]["content"][0]["text"])

    def test_response_is_json_serializable(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 8, "method": "tools/list", "params": {}})

        self.assertEqual(json.loads(json.dumps(response)), response)
