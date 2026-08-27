"""Local stdio MCP server for DataDjinn saved connections.

The server deliberately has no HTTP listener. It is started by an MCP client as
its child process and communicates only through stdin/stdout using JSON-RPC.
"""

from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from collections.abc import Callable
from pathlib import Path
from typing import Any

# MCP clients commonly launch this file by absolute path from their own working
# directory, so make the backend package root available before app imports.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _configure_stdio_encoding() -> None:
    """MCP stdio is a UTF-8 JSON-RPC stream, including on Chinese Windows."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            # Some MCP clients replace stdio with a binary or minimal stream.
            continue


_configure_stdio_encoding()


def _configure_data_directory() -> None:
    """Find Electron's saved-connection directory without overriding an explicit path."""
    if os.environ.get("DATADJINN_DATA_DIR"):
        return
    data_roots = (os.environ.get("APPDATA"), os.environ.get("LOCALAPPDATA"))
    candidates: list[Path] = []
    for data_root in data_roots:
        if not data_root:
            continue
        for directory_name in ("datadjinn", "DataDjinn"):
            candidate = Path(data_root) / directory_name
            if candidate not in candidates:
                candidates.append(candidate)

    for desktop_data_dir in candidates:
        # config.json is created before the first connection is saved. Using it
        # here lets a newly installed client complete the MCP handshake too.
        if (desktop_data_dir / "config.json").exists() or (desktop_data_dir / "connections.json").exists():
            os.environ["DATADJINN_DATA_DIR"] = str(desktop_data_dir)
            return


# The desktop app stores saved connections under Electron userData. When an MCP
# client starts this script directly it does not inherit that environment.
_configure_data_directory()

# Database drivers are intentionally loaded after the MCP handshake. Importing
# every optional driver before reading stdin can make an MCP client wait forever
# while PyInstaller initializes native database dependencies.
class _LazyRuntimeObject:
    _RUNTIME_METHODS = {
        "list_connections",
        "open_connection",
        "close_connection",
        "get_engine",
    }

    def __init__(self, global_name: str) -> None:
        self._global_name = global_name

    def __getattr__(self, name: str) -> Any:
        # unittest.mock and a few MCP launchers probe dunder attributes while
        # resolving the command object. Do not turn those probes into a runtime
        # import (or recurse through this proxy indefinitely).
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        if name not in self._RUNTIME_METHODS:
            raise AttributeError(name)

        def deferred_call(*args: Any, **kwargs: Any) -> Any:
            _load_database_runtime()
            runtime_object = globals()[self._global_name]
            return getattr(runtime_object, name)(*args, **kwargs)

        return deferred_call


connection_manager: Any = _LazyRuntimeObject("connection_manager")
list_columns: Any = None
list_databases: Any = None
list_schemas: Any = None
list_tables: Any = None
execute_query: Any = None
execute_readonly_query: Any = None
preview_table: Any = None
_runtime_loaded = False
_tool_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="datadjinn-mcp-tool")


SERVER_INFO = {"name": "datadjinn-local", "version": "0.1.0"}
PROTOCOL_VERSION = "2025-03-26"
MAX_QUERY_ROWS = 1_000
MAX_SAMPLE_ROWS = 100
MCP_TOOL_TIMEOUT_SECONDS = 45
READONLY_PREFIXES = ("SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "PRAGMA")
REDIS_READONLY_COMMANDS = {"SCAN", "KEYS", "GET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL"}


def _load_database_runtime() -> None:
    global _runtime_loaded, connection_manager, list_columns, list_databases, list_schemas, list_tables
    global execute_query, execute_readonly_query, preview_table
    if _runtime_loaded:
        return
    deferred_connection_manager = connection_manager
    from app.db.connection_manager import connection_manager as loaded_connection_manager
    from app.db.metadata import (
        list_columns as loaded_list_columns,
        list_databases as loaded_list_databases,
        list_schemas as loaded_list_schemas,
        list_tables as loaded_list_tables,
    )
    from app.db.readonly_query import (
        execute_query as loaded_execute_query,
        execute_readonly_query as loaded_execute_readonly_query,
        preview_table as loaded_preview_table,
    )

    if isinstance(deferred_connection_manager, _LazyRuntimeObject):
        for name, value in vars(deferred_connection_manager).items():
            if name != "_global_name":
                setattr(loaded_connection_manager, name, value)
    connection_manager = loaded_connection_manager
    list_columns = loaded_list_columns
    list_databases = loaded_list_databases
    list_schemas = loaded_list_schemas
    list_tables = loaded_list_tables
    execute_query = loaded_execute_query
    execute_readonly_query = loaded_execute_readonly_query
    preview_table = loaded_preview_table
    _runtime_loaded = True


def _mcp_settings() -> dict[str, Any]:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if not data_dir:
        return {"enabled": False, "allowWrite": False, "restrictConnections": False, "allowedConnectionIds": []}
    config_path = Path(data_dir) / "config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        config = {}
    settings = config.get("mcpSettings") if isinstance(config, dict) else None
    if not isinstance(settings, dict):
        settings = {}
    allowed_connection_ids = settings.get("allowedConnectionIds")
    return {
        "enabled": bool(settings.get("enabled")),
        "allowWrite": bool(settings.get("allowWrite")),
        "restrictConnections": bool(settings.get("restrictConnections")),
        "allowedConnectionIds": [
            item for item in allowed_connection_ids if isinstance(item, str) and item.strip()
        ]
        if isinstance(allowed_connection_ids, list)
        else [],
    }


def _mcp_module_installed() -> bool:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if not data_dir:
        return False
    config_path = Path(data_dir) / "config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    modules = config.get("optionalModules") if isinstance(config, dict) else None
    return isinstance(modules, list) and any(
        isinstance(module, dict) and module.get("id") == "mcp" for module in modules
    )


def _ensure_mcp_enabled() -> None:
    if not _mcp_module_installed():
        raise PermissionError("本机 MCP 服务模块未安装。请先在 DataDjinn 的“设置 -> 扩展”中安装该模块。")
    if not _mcp_settings()["enabled"]:
        raise PermissionError("本机 MCP 服务未启用。请先在 DataDjinn 的“设置 -> MCP”中启用本机 MCP 服务。")


def _ensure_connection_allowed(connection_id: str) -> None:
    settings = _mcp_settings()
    if settings["restrictConnections"] and connection_id not in settings["allowedConnectionIds"]:
        raise PermissionError("当前连接未获 MCP 访问授权。请在 DataDjinn 的“设置 -> MCP”中添加该连接。")


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = required
    return {"name": name, "description": description, "inputSchema": schema}


TOOLS = [
    _tool("list_connections", "List all locally saved DataDjinn connections. Passwords and SSH secrets are never returned.", {}),
    _tool("open_connection", "Open one saved connection for this local MCP process. Use connection_id returned by list_connections.", {"connection_id": {"type": "string"}}, ["connection_id"]),
    _tool("close_connection", "Close one connection opened by this MCP process.", {"connection_id": {"type": "string"}}, ["connection_id"]),
    _tool("list_databases", "List databases available on an opened saved connection.", {"connection_id": {"type": "string"}}, ["connection_id"]),
    _tool(
        "list_schemas",
        "List schemas in a PostgreSQL or GaussDB physical database on an opened connection.",
        {"connection_id": {"type": "string"}, "pg_database": {"type": "string", "description": "Physical PostgreSQL/GaussDB database; defaults to the saved connection database."}},
        ["connection_id"],
    ),
    _tool(
        "list_tables",
        "List tables or collections in a database/schema on an opened connection.",
        {"connection_id": {"type": "string"}, "database": {"type": "string"}, "pg_database": {"type": "string"}},
        ["connection_id"],
    ),
    _tool(
        "describe_table",
        "Describe columns for one table or collection on an opened connection.",
        {"connection_id": {"type": "string"}, "table_name": {"type": "string"}, "database": {"type": "string"}, "pg_database": {"type": "string"}},
        ["connection_id", "table_name"],
    ),
    _tool(
        "get_sample_data",
        "Read a limited sample from one table or collection on an opened connection.",
        {"connection_id": {"type": "string"}, "table_name": {"type": "string"}, "database": {"type": "string"}, "pg_database": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": MAX_SAMPLE_ROWS, "default": 20}},
        ["connection_id", "table_name"],
    ),
    _tool(
        "execute_query",
        "Execute SQL, MongoDB shell syntax, or Redis commands. Read-only execution is the default. A write operation requires confirm_write=true in this same tool call.",
        {"connection_id": {"type": "string"}, "sql": {"type": "string"}, "database": {"type": "string"}, "pg_database": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": MAX_QUERY_ROWS, "default": 200}, "confirm_write": {"type": "boolean", "default": False, "description": "Must be true to execute non-read-only SQL."}},
        ["connection_id", "sql"],
    ),
]


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return value


def _tool_result(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(_jsonable(value), ensure_ascii=False, default=str)}]}


def _tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _connection(connection_id: str) -> Any:
    _load_database_runtime()
    _ensure_connection_allowed(connection_id)
    if connection_id not in {item.connection_id for item in connection_manager.list_connections()}:
        raise ValueError("连接不存在")
    engine = connection_manager.get_engine(connection_id)
    if engine is None:
        connection_manager.open_connection(connection_id)
        engine = connection_manager.get_engine(connection_id)
    if engine is None:
        raise RuntimeError("连接打开失败")
    return engine


def _connection_summary(connection: Any) -> dict[str, Any]:
    return {
        "connection_id": connection.connection_id,
        "name": connection.name,
        "database_type": connection.database_type,
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "is_open": connection.is_open,
        "server_version": connection.server_version,
    }


def _is_readonly_sql(sql: str) -> bool:
    normalized = sql.lstrip().upper()
    if normalized.startswith(READONLY_PREFIXES):
        return True
    if normalized.startswith("DB."):
        return ".FIND" in normalized
    return bool(normalized.split(maxsplit=1) and normalized.split(maxsplit=1)[0] in REDIS_READONLY_COMMANDS)


def list_connections() -> dict[str, Any]:
    _load_database_runtime()
    settings = _mcp_settings()
    connections = connection_manager.list_connections()
    if settings["restrictConnections"]:
        allowed_ids = set(settings["allowedConnectionIds"])
        connections = [connection for connection in connections if connection.connection_id in allowed_ids]
    return {"connections": [_connection_summary(connection) for connection in connections]}


def open_connection(connection_id: str) -> dict[str, Any]:
    _load_database_runtime()
    _ensure_connection_allowed(connection_id)
    return _connection_summary(connection_manager.open_connection(connection_id))


def close_connection(connection_id: str) -> dict[str, Any]:
    _load_database_runtime()
    _ensure_connection_allowed(connection_id)
    return _connection_summary(connection_manager.close_connection(connection_id))


def list_databases(connection_id: str) -> dict[str, Any]:
    return {"databases": [_jsonable(item) for item in list_databases(_connection(connection_id))]}


def list_schemas(connection_id: str, pg_database: str | None = None) -> dict[str, Any]:
    engine = _connection(connection_id)
    return {"schemas": [_jsonable(item) for item in list_schemas(engine, pg_database)]}


def list_tables(connection_id: str, database: str | None = None, pg_database: str | None = None) -> dict[str, Any]:
    return {"tables": [_jsonable(item) for item in list_tables(_connection(connection_id), database, pg_database)]}


def describe_table(connection_id: str, table_name: str, database: str | None = None, pg_database: str | None = None) -> dict[str, Any]:
    return {"columns": [_jsonable(item) for item in list_columns(_connection(connection_id), table_name, database, pg_database)]}


def get_sample_data(connection_id: str, table_name: str, database: str | None = None, pg_database: str | None = None, limit: int = 20) -> dict[str, Any]:
    response = preview_table(_connection(connection_id), table_name, min(max(limit, 1), MAX_SAMPLE_ROWS), 0, database, pg_database)
    return _jsonable(response)


def execute_query(connection_id: str, sql: str, database: str | None = None, pg_database: str | None = None, limit: int = 200, confirm_write: bool = False) -> dict[str, Any]:
    engine = _connection(connection_id)
    safe_limit = min(max(limit, 1), MAX_QUERY_ROWS)
    if _is_readonly_sql(sql):
        return _jsonable(execute_readonly_query(engine, sql, safe_limit, 0, database, pg_database))
    if not _mcp_settings()["allowWrite"]:
        raise PermissionError("MCP 写操作未启用。请先在 DataDjinn 的“设置 -> MCP”中允许 MCP 执行写操作。")
    if not confirm_write:
        raise ValueError("写操作未执行。请核对 connection_id、数据库和 SQL 后，使用 confirm_write=true 重新调用 execute_query。")
    return _jsonable(execute_query(engine, sql, safe_limit, 0, database, pg_database))


TOOL_HANDLERS: dict[str, Callable[..., dict[str, Any]]] = {
    "list_connections": list_connections,
    "open_connection": open_connection,
    "close_connection": close_connection,
    "list_databases": list_databases,
    "list_schemas": list_schemas,
    "list_tables": list_tables,
    "describe_table": describe_table,
    "get_sample_data": get_sample_data,
    "execute_query": execute_query,
}


def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    params = request.get("params") or {}
    try:
        _ensure_mcp_enabled()
    except PermissionError as exc:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": str(exc)}}
    if method == "notifications/initialized":
        return None
    if method == "initialize":
        requested_version = params.get("protocolVersion")
        protocol_version = requested_version if requested_version in {"2024-11-05", PROTOCOL_VERSION} else PROTOCOL_VERSION
        result = {"protocolVersion": protocol_version, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        try:
            name = str(params.get("name") or "")
            arguments = params.get("arguments") or {}
            if not isinstance(arguments, dict):
                raise ValueError("工具参数必须是对象")
            handler = TOOL_HANDLERS.get(name)
            if handler is None:
                raise ValueError(f"未知工具：{name}")
            future = _tool_executor.submit(handler, **arguments)
            try:
                result = _tool_result(future.result(timeout=MCP_TOOL_TIMEOUT_SECONDS))
            except FutureTimeoutError:
                result = _tool_error(
                    f"MCP 工具调用超过 {MCP_TOOL_TIMEOUT_SECONDS} 秒仍未返回，已中止等待；请检查数据库连接或重新启动 MCP 进程。"
                )
        except Exception as exc:
            result = _tool_error(str(exc))
    else:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"未知方法：{method}"}}
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def main() -> None:
    for line in sys.stdin:
        try:
            request = json.loads(line)
            response = handle_request(request)
            if response is not None:
                sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except Exception as exc:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
