import json
import os
import unittest
from unittest.mock import patch

from app.mcp_server import MAX_QUERY_ROWS, _configure_data_directory, _is_readonly_sql, handle_request
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

    def test_mcp_uses_explicit_data_directory_without_overriding_it(self) -> None:
        with patch.dict(os.environ, {"DATADJINN_DATA_DIR": "C:\\custom\\DataDjinn"}, clear=True):
            _configure_data_directory()
            self.assertEqual(os.environ["DATADJINN_DATA_DIR"], "C:\\custom\\DataDjinn")

    def test_tools_list_exposes_connection_scoped_operations(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        tools = {tool["name"]: tool for tool in response["result"]["tools"]}

        self.assertTrue({"list_connections", "open_connection", "list_databases", "list_tables", "describe_table", "get_sample_data", "execute_query"}.issubset(tools))
        self.assertIn("connection_id", tools["execute_query"]["inputSchema"]["properties"])
        self.assertIn("confirm_write", tools["execute_query"]["inputSchema"]["properties"])

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

        with patch("app.mcp_server.connection_manager.list_connections", return_value=[allowed, blocked]):
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

        with patch("app.mcp_server._connection", return_value="engine") as connection, patch("app.mcp_server.execute_query", return_value=response) as execute:
            result = handle_request(request)

        connection.assert_called_once_with("connection_1")
        execute.assert_called_once_with("engine", "DELETE FROM audit_log", 200, 0, "analytics", None)
        self.assertFalse(result["result"].get("isError", False))

    def test_readonly_detection_does_not_allow_mongo_or_redis_writes(self) -> None:
        self.assertTrue(_is_readonly_sql("db.orders.find({})"))
        self.assertFalse(_is_readonly_sql("db.orders.insertOne({})"))
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

        with patch("app.mcp_server._connection", return_value="engine"), patch("app.mcp_server.execute_readonly_query", return_value=response) as execute:
            handle_request(request)

        execute.assert_called_once_with("engine", "SELECT 1", MAX_QUERY_ROWS, 0, None, None)

    def test_invalid_tool_returns_mcp_error_result(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "missing", "arguments": {}}})

        self.assertTrue(response["result"]["isError"])
        self.assertIn("未知工具", response["result"]["content"][0]["text"])

    def test_response_is_json_serializable(self) -> None:
        response = handle_request({"jsonrpc": "2.0", "id": 8, "method": "tools/list", "params": {}})

        self.assertEqual(json.loads(json.dumps(response)), response)
