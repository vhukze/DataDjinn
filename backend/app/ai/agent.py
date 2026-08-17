import hashlib
import json
import math
import re
import unicodedata
from collections.abc import Iterator
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

import sqlparse
from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Engine

from app.db.backup_manager import backup_manager
from app.db.mongo_utils import MongoClient, is_mongo_client
from app.db.redis_utils import is_redis_client
from app.db.metadata import list_columns, list_databases, list_schemas, list_tables
from app.db.readonly_query import execute_query, execute_readonly_query, preview_table
from app.schemas.query import QueryResponse
from app.ai.product_knowledge import get_product_knowledge


class AIConfig(BaseModel):
    provider: Literal["openai-compatible", "anthropic"] = "openai-compatible"
    base_url: str = Field(min_length=1)
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1)
    max_context_tokens: int | None = Field(default=None, ge=1)


class AIMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None


class AgentContextSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: str
    type: Literal["database", "schema"]
    connectionId: str
    connectionName: str
    dbType: str
    database: str | None = None
    schema_name: str | None = Field(default=None, alias="schema", serialization_alias="schema")
    pgDatabase: str | None = None
    sizeDisplay: str | None = None
    sizeBytes: int | None = None
    storageSizeDisplay: str | None = None
    storageSizeBytes: int | None = None


class AgentConnectionSummary(BaseModel):
    connectionId: str
    name: str
    dbType: str
    database: str | None = None
    isOpen: bool = False
    serverVersion: str | None = None


class AgentFocusedResource(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    kind: str
    connectionId: str | None = None
    connectionName: str | None = None
    dbType: str | None = None
    database: str | None = None
    schema_name: str | None = Field(default=None, alias="schema", serialization_alias="schema")
    pgDatabase: str | None = None
    table: str | None = None
    objectType: str | None = None
    name: str | None = None
    sizeDisplay: str | None = None
    rowCount: int | None = None


class AgentWorkspaceAction(BaseModel):
    type: Literal["append_query_sql"]
    sql: str
    title: str | None = None


class AgentWorkspaceContext(BaseModel):
    active_sql: str | None = None
    active_tab_kind: str | None = None
    selected_table: str | None = None
    current_connection_name: str | None = None
    current_db_type: str | None = None
    current_server_version: str | None = None
    current_database: str | None = None
    current_pg_database: str | None = None
    focused_resource: AgentFocusedResource | None = None
    connections: list[AgentConnectionSummary] = Field(default_factory=list)
    recent_queries: list[str] = Field(default_factory=list)
    visible_result_columns: list[str] = Field(default_factory=list)
    visible_result_sample: list[dict[str, Any]] = Field(default_factory=list)
    context_sources: list[AgentContextSource] = Field(default_factory=list)


class AgentTaskStep(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: Literal["pending", "running", "completed", "failed", "skipped"] = "pending"
    tool_name: str | None = None
    arguments: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    risk_level: Literal["safe", "review", "dangerous"] = "safe"


class AgentPlan(BaseModel):
    goal: str
    summary: str
    steps: list[AgentTaskStep]
    requires_confirmation: bool = False
    risk_level: Literal["safe", "review", "dangerous"] = "safe"


class AgentConfirmation(BaseModel):
    id: str
    title: str
    risk_level: Literal["review", "dangerous"]
    sql: str | None = None
    explanation: str
    estimated_impact: dict[str, Any] | None = None


class PendingConfirmation(BaseModel):
    id: str
    connection_id: str
    database: str | None = None
    pg_database: str | None = None
    sql: str | None = None
    sql_hash: str | None = None
    statement_type: str
    risk_level: Literal["review", "dangerous"]
    action: Literal["sql", "restore_backup"] = "sql"
    backup_id: str | None = None


class AgentConfirmRequest(BaseModel):
    connection_id: str
    confirmation_id: str
    approved: bool
    database: str | None = None
    pg_database: str | None = None


class AIChatRequest(BaseModel):
    messages: list[AIMessage]
    config: AIConfig
    connection_id: str | None = None
    database: str | None = None
    pg_database: str | None = None
    workspace: AgentWorkspaceContext | None = None


class AIPingRequest(BaseModel):
    config: AIConfig


class AICompactRequest(BaseModel):
    messages: list[AIMessage]
    config: AIConfig
    workspace: AgentWorkspaceContext | None = None


class AICompactResponse(BaseModel):
    summary: str


class AIContextStatsRequest(BaseModel):
    messages: list[AIMessage]
    config: AIConfig
    workspace: AgentWorkspaceContext | None = None


class AIContextStatsResponse(BaseModel):
    used_tokens: int
    max_tokens: int
    usage_ratio: float


class AIPingResponse(BaseModel):
    success: bool
    message: str


MAX_AGENT_TURNS = 48
MAX_TABLES_IN_TOOL_RESULT = 200
MAX_COLUMNS_IN_TOOL_RESULT = 200
MAX_ROWS_IN_TOOL_RESULT = 20
DEFAULT_QUERY_ROWS_FOR_AGENT = 200
MAX_QUERY_ROWS_FOR_AGENT = 10000
MAX_SAMPLE_ROWS_FOR_AGENT = 50
MAX_CELL_CHARS_IN_TOOL_RESULT = 500
WRITE_SQL_TYPES = {"INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "REPLACE", "MERGE"}
READONLY_SQL_TYPES = {"SELECT", "WITH"}
PENDING_CONFIRMATIONS: dict[str, PendingConfirmation] = {}
ANTHROPIC_VERSION = "2023-06-01"

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def estimate_text_tokens(text: str) -> int:
    if not text:
        return 0
    normalized = unicodedata.normalize("NFKC", text)
    cjk_count = len(_CJK_RE.findall(normalized))
    non_cjk = _CJK_RE.sub(" ", normalized)
    ascii_word_count = len(re.findall(r"[A-Za-z0-9_]+", non_cjk))
    punctuation_count = len(re.findall(r"[^\w\s]", normalized))
    whitespace_cost = math.ceil(len(re.findall(r"\s+", normalized)) * 0.2)
    remainder_chars = max(0, len(normalized) - cjk_count - sum(len(word) for word in re.findall(r"[A-Za-z0-9_]+", non_cjk)))
    remainder_cost = math.ceil(remainder_chars / 3)
    return max(1, cjk_count + ascii_word_count + punctuation_count + whitespace_cost + remainder_cost)


def estimate_message_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        total += 6
        total += estimate_text_tokens(str(message.get("role", "")))
        content = message.get("content")
        if isinstance(content, str):
            total += estimate_text_tokens(content)
        elif content is not None:
            total += estimate_text_tokens(json.dumps(content, ensure_ascii=False, default=str))
        tool_calls = message.get("tool_calls")
        if tool_calls:
            total += estimate_text_tokens(json.dumps(tool_calls, ensure_ascii=False, default=str))
        if message.get("tool_call_id"):
            total += estimate_text_tokens(str(message["tool_call_id"]))
    return total + 3


def build_context_stats(messages: list[dict[str, Any]], config: AIConfig) -> AIContextStatsResponse:
    used_tokens = estimate_message_tokens(messages)
    max_tokens = config.max_context_tokens or 0
    ratio = 0 if max_tokens <= 0 else min(1.0, used_tokens / max_tokens)
    return AIContextStatsResponse(used_tokens=used_tokens, max_tokens=max_tokens, usage_ratio=ratio)


DATABASE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_agent_plan",
            "description": "为复杂数据库任务创建可见执行计划。复杂分析、排查、写操作前应先调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "用户目标"},
                    "summary": {"type": "string", "description": "计划摘要"},
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "description": "步骤标题"},
                                "description": {"type": "string", "description": "步骤说明"},
                                "risk_level": {"type": "string", "enum": ["safe", "review", "dangerous"], "default": "safe"},
                            },
                            "required": ["title"],
                            "additionalProperties": False,
                        },
                    },
                    "requires_confirmation": {"type": "boolean", "description": "是否包含需要用户确认的操作", "default": False},
                    "risk_level": {"type": "string", "enum": ["safe", "review", "dangerous"], "default": "safe"},
                },
                "required": ["goal", "summary", "steps"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_sql",
            "description": "校验 SQL 类型、是否多语句、只读状态和风险等级。执行 SQL 前应先调用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "要校验的 SQL"},
                    "readonly": {"type": "boolean", "description": "是否按只读模式校验", "default": True},
                    "database": {"type": "string", "description": "Target database or schema on the current connection; defaults to the current context"},
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database on the current connection"},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_databases",
            "description": "List databases available on the current connection. The current database is the default target, but other returned databases may be inspected by explicitly passing database or pg_database to later tools.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_schemas",
            "description": "List schemas in a PostgreSQL or GaussDB database on the current connection. Pass pg_database only when inspecting another physical database on this same connection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database name; defaults to the current one"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_tables",
            "description": "列出当前数据库中的所有表名。",
            "parameters": {
                "type": "object",
                "properties": {
                    "database": {"type": "string", "description": "Target database or schema on the current connection; defaults to the current context"},
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database on the current connection"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "describe_table",
            "description": "返回指定表的字段结构。",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string", "description": "表名"},
                    "database": {"type": "string", "description": "Target database or schema on the current connection; defaults to the current context"},
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database on the current connection"},
                },
                "required": ["table_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_query",
            "description": "执行 SQL、MongoDB shell 风格语句或 Redis 命令。SQL readonly=true 时只允许 SELECT/WITH；MongoDB 当前支持 find、createCollection、insertOne、insertMany；Redis 当前支持 SCAN/KEYS/GET/HGETALL/LRANGE/SMEMBERS/ZRANGE/XRANGE/TYPE/TTL 以及基础写入命令。",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "要执行的 SQL"},
                    "readonly": {"type": "boolean", "description": "是否只读执行", "default": True},
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_QUERY_ROWS_FOR_AGENT,
                        "default": DEFAULT_QUERY_ROWS_FOR_AGENT,
                        "description": "默认查询行数。用户没有明确要求全部数据时使用该限制。",
                    },
                    "fetch_all": {
                        "type": "boolean",
                        "default": False,
                        "description": "只有用户明确要求获取全部、所有、全量数据时才设置为 true。",
                    },
                    "database": {"type": "string", "description": "Target database or schema on the current connection; defaults to the current context"},
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database on the current connection"},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_sample_data",
            "description": "读取指定表的样本数据。",
            "parameters": {
                "type": "object",
                "properties": {
                    "table_name": {"type": "string", "description": "表名"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 10},
                    "database": {"type": "string", "description": "Target database or schema on the current connection; defaults to the current context"},
                    "pg_database": {"type": "string", "description": "PostgreSQL or GaussDB physical database on the current connection"},
                },
                "required": ["table_name"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_database_backup",
            "description": "备份当前连接下指定数据库。SQLite 使用文件备份；MySQL 需要 mysqldump；PostgreSQL 需要 pg_dump；达梦暂不支持。",
            "parameters": {
                "type": "object",
                "properties": {
                    "database": {"type": "string", "description": "要备份的数据库名；不传则使用当前上下文数据库"},
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_database_backups",
            "description": "列出当前连接的备份记录，用于恢复前确认可用备份。",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "restore_database_backup",
            "description": "恢复指定备份。恢复会覆盖/回滚当前数据库数据，必须触发用户确认按钮后才执行。",
            "parameters": {
                "type": "object",
                "properties": {
                    "backup_id": {"type": "string", "description": "要恢复的备份记录 ID"},
                },
                "required": ["backup_id"],
                "additionalProperties": False,
            },
        },
    },
]

WORKSPACE_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "append_query_sql",
            "description": "把生成的 SQL 追加写入 DataDjinn 查询窗口。用户要求生成 SQL 到查询窗口时必须调用该工具；如果当前没有查询窗口，前端会自动新建查询窗口。该工具只写入编辑器，不执行 SQL。",
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "要追加到查询窗口的 SQL 内容"},
                    "title": {"type": "string", "description": "需要新建查询窗口时使用的标题"},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    }
]

TOOLS = [*DATABASE_TOOLS, *WORKSPACE_TOOLS]


def _extra_value(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        return value.get(key)
    dumped = value.model_dump(exclude_none=True) if hasattr(value, "model_dump") else {}
    if key in dumped:
        return dumped[key]
    return getattr(value, key, None)


def _reasoning_value(value: Any) -> Any:
    for key in ("reasoning_content", "reasoning", "thinking"):
        extra = _extra_value(value, key)
        if extra:
            return extra
    return None


def _text_from_stream_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        fragments: list[str] = []
        for item in value:
            fragments.append(_text_from_stream_value(item))
        return "".join(fragment for fragment in fragments if fragment)
    if isinstance(value, dict):
        for key in ("text", "content", "reasoning", "thinking"):
            next_value = value.get(key)
            if next_value:
                return _text_from_stream_value(next_value)
        return ""
    return str(value)


def _append_stream_text(target: dict[str, Any], key: str, fragment: str) -> None:
    if not fragment:
        return
    target[key] = f"{target.get(key, '')}{fragment}"


def _merge_openai_tool_call_delta(current_value: str, fragment: str) -> str:
    if not fragment:
        return current_value
    if not current_value:
        return fragment
    if current_value.endswith(fragment):
        return current_value
    return f"{current_value}{fragment}"


def _update_openai_tool_call_state(states: dict[int, dict[str, Any]], tool_call: Any) -> None:
    tool_call_id = str(_extra_value(tool_call, "id") or "")
    index = _extra_value(tool_call, "index")
    if not isinstance(index, int):
        index = next(
            (existing_index for existing_index, state in states.items() if state["id"] == tool_call_id),
            0 if len(states) == 1 else len(states),
        )
    state = states.setdefault(
        index,
        {
            "id": "",
            "type": "function",
            "function": {"name": "", "arguments": ""},
        },
    )
    if tool_call_id:
        state["id"] = tool_call_id
    tool_type = str(_extra_value(tool_call, "type") or "")
    if tool_type:
        state["type"] = tool_type
    function_value = _extra_value(tool_call, "function") or _extra_value(tool_call, "function_call")
    function_name_value = (
        _extra_value(function_value, "name") if function_value else None
    ) or _extra_value(tool_call, "name")
    function_name = str(function_name_value or "")
    if function_name:
        state["function"]["name"] = _merge_openai_tool_call_delta(state["function"]["name"], function_name)
    function_arguments_value = (
        _extra_value(function_value, "arguments") if function_value else None
    ) or _extra_value(tool_call, "arguments")
    function_arguments = str(function_arguments_value or "")
    if function_arguments:
        state["function"]["arguments"] = f"{state['function']['arguments']}{function_arguments}"


def _finalize_openai_tool_calls(states: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": state["id"] or f"tool_call_{index}",
            "type": state.get("type") or "function",
            "function": {
                "name": state["function"].get("name") or "",
                "arguments": state["function"].get("arguments") or "{}",
            },
        }
        for index, state in sorted(states.items(), key=lambda item: item[0])
    ]


def _parse_tool_arguments(value: Any) -> tuple[dict[str, Any], str | None]:
    raw_arguments = str(value or "{}")
    try:
        arguments = json.loads(raw_arguments)
    except json.JSONDecodeError:
        return {}, "工具参数不是合法 JSON，未执行该操作。请使用合法 JSON 参数重新调用工具。"

    if not isinstance(arguments, dict):
        return {}, "工具参数必须是 JSON 对象，未执行该操作。请使用对象参数重新调用工具。"

    return arguments, None


def _truncate_value(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS_IN_TOOL_RESULT:
        return f"{value[:MAX_CELL_CHARS_IN_TOOL_RESULT]}... [已截断，原长度 {len(value)}]"
    if isinstance(value, dict):
        return {key: _truncate_value(next_value) for key, next_value in value.items()}
    if isinstance(value, list):
        return [_truncate_value(next_value) for next_value in value]
    return value


def sql_hash(sql: str) -> str:
    return hashlib.sha256(sql.strip().encode("utf-8")).hexdigest()


def _anthropic_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    return normalized if normalized.endswith("/v1/messages") else f"{normalized}/v1/messages"


def _anthropic_tools(tools: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    return [
        {
            "name": tool["function"]["name"],
            "description": tool["function"].get("description", ""),
            "input_schema": tool["function"].get("parameters", {"type": "object", "properties": {}}),
        }
        for tool in (tools or TOOLS)
    ]


def _content_blocks(content: str | None) -> list[dict[str, Any]]:
    return [{"type": "text", "text": content}] if content else []


def _anthropic_messages(messages: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]]]:
    system: str | None = None
    converted: list[dict[str, Any]] = []
    pending_tool_results: list[dict[str, Any]] = []

    for message in messages:
        role = message.get("role")
        if role == "system":
            system = str(message.get("content") or "")
            continue

        if role == "tool":
            pending_tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": str(message.get("tool_call_id") or ""),
                    "content": str(message.get("content") or ""),
                }
            )
            continue

        if pending_tool_results:
            converted.append({"role": "user", "content": pending_tool_results})
            pending_tool_results = []

        if role == "user":
            converted.append({"role": "user", "content": _content_blocks(str(message.get("content") or ""))})
            continue

        if role == "assistant":
            content = _content_blocks(str(message.get("content") or ""))
            if isinstance(message.get("content"), list):
                content = message["content"]
            for tool_call in message.get("tool_calls") or []:
                function = tool_call.get("function") or {}
                try:
                    tool_input = json.loads(function.get("arguments") or "{}")
                except json.JSONDecodeError:
                    tool_input = {}
                content.append(
                    {
                        "type": "tool_use",
                        "id": str(tool_call.get("id") or ""),
                        "name": str(function.get("name") or ""),
                        "input": tool_input,
                    }
                )
            converted.append({"role": "assistant", "content": content})

    if pending_tool_results:
        converted.append({"role": "user", "content": pending_tool_results})

    return system, converted


class AnthropicMessagesClient:
    def __init__(self, config: AIConfig) -> None:
        self.url = _anthropic_url(config.base_url)
        self.api_key = config.api_key
        self.model = config.model

    def _build_payload(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: bool | list[dict[str, Any]] = True,
        max_tokens: int = 4096,
        temperature: float | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        system, converted_messages = _anthropic_messages(messages)
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": converted_messages,
            "max_tokens": max_tokens,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = _anthropic_tools(tools if isinstance(tools, list) else None)
        if temperature is not None:
            payload["temperature"] = temperature
        payload["thinking"] = _anthropic_default_thinking(self.model)
        if stream:
            payload["stream"] = True
        return payload

    def create(self, messages: list[dict[str, Any]], *, tools: bool | list[dict[str, Any]] = True, max_tokens: int = 4096, temperature: float | None = None) -> dict[str, Any]:
        payload = self._build_payload(messages, tools=tools, max_tokens=max_tokens, temperature=temperature)

        request = Request(
            self.url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Anthropic 请求失败：HTTP {exc.code} {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Anthropic 请求失败：{exc.reason}") from exc

    def stream(self, messages: list[dict[str, Any]], *, tools: bool | list[dict[str, Any]] = True, max_tokens: int = 4096, temperature: float | None = None) -> Iterator[dict[str, Any]]:
        payload = self._build_payload(messages, tools=tools, max_tokens=max_tokens, temperature=temperature, stream=True)
        request = Request(
            self.url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "accept": "text/event-stream",
                "x-api-key": self.api_key,
                "anthropic-version": ANTHROPIC_VERSION,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=120) as response:
                event_name = "message"
                data_lines: list[str] = []
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="ignore").rstrip("\r\n")
                    if not line:
                        if data_lines:
                            yield {
                                "event": event_name,
                                "data": json.loads("\n".join(data_lines)),
                            }
                            event_name = "message"
                            data_lines = []
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event:"):
                        event_name = line[len("event:"):].strip() or "message"
                        continue
                    if line.startswith("data:"):
                        data_lines.append(line[len("data:"):].lstrip())

                if data_lines:
                    yield {
                        "event": event_name,
                        "data": json.loads("\n".join(data_lines)),
                    }
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Anthropic request failed: HTTP {exc.code} {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Anthropic request failed: {exc.reason}") from exc


def _anthropic_text(response: dict[str, Any]) -> str:
    return "".join(block.get("text", "") for block in response.get("content", []) if block.get("type") == "text")


def _anthropic_thinking(response: dict[str, Any]) -> str:
    return "".join(block.get("thinking", "") for block in response.get("content", []) if block.get("type") == "thinking")


def _anthropic_default_thinking(model: str) -> dict[str, Any]:
    normalized = model.lower()
    if any(token in normalized for token in ("fable-5", "mythos-5", "mythos-preview", "opus-4-7", "opus-4-8", "opus-4.7", "opus-4.8")):
        return {"type": "adaptive", "display": "summarized"}
    return {"type": "enabled", "budget_tokens": 4096, "display": "summarized"}


def _anthropic_tool_uses(response: dict[str, Any]) -> list[dict[str, Any]]:
    return [block for block in response.get("content", []) if block.get("type") == "tool_use"]


def _anthropic_assistant_message(response: dict[str, Any]) -> dict[str, Any]:
    return {"role": "assistant", "content": response.get("content", [])}


def _summarize_query_response(response: QueryResponse, requested_limit: int | None = None) -> dict[str, Any]:
    rows = response.rows[:MAX_ROWS_IN_TOOL_RESULT]
    visible_limit = requested_limit if requested_limit is not None else len(response.rows)
    truncated = response.limited or len(response.rows) > len(rows)
    return {
        "columns": response.columns,
        "row_count": response.row_count,
        "returned_row_count": len(rows),
        "requested_limit": visible_limit,
        "truncated": truncated,
        "sample_rows": [_truncate_value(row) for row in rows],
        "budget": {
            "max_rows_returned_to_agent": MAX_ROWS_IN_TOOL_RESULT,
            "max_cell_chars": MAX_CELL_CHARS_IN_TOOL_RESULT,
        },
        "next_step_hint": "结果已截断。需要更完整分析时，请使用聚合 SQL、过滤条件、分页或更小范围的查询。" if truncated else None,
    }


class DatabaseAgent:
    def __init__(
        self,
        engine: Engine | MongoClient | None,
        config: AIConfig,
        connection_id: str = "",
        database: str | None = None,
        pg_database: str | None = None,
        workspace: AgentWorkspaceContext | None = None,
    ) -> None:
        self.engine = engine
        self.connection_id = connection_id
        self.database = database
        self.pg_database = pg_database
        self.workspace = workspace
        self.provider = config.provider
        self.client = AnthropicMessagesClient(config) if config.provider == "anthropic" else OpenAI(base_url=config.base_url, api_key=config.api_key)
        self.model = config.model

    def _tools(self) -> list[dict[str, Any]]:
        return TOOLS if self.engine is not None else WORKSPACE_TOOLS

    def chat(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        if self.provider == "anthropic":
            return self._chat_anthropic(messages)

        conversation = [*messages]

        for _ in range(MAX_AGENT_TURNS):
            response = self.client.chat.completions.create(
                model=self.model,
                messages=conversation,
                tools=self._tools(),
                tool_choice="auto",
            )
            choice = response.choices[0]
            message = choice.message
            assistant_message = message.model_dump(exclude_none=True)
            reasoning_content = _reasoning_value(message)
            if reasoning_content:
                assistant_message["reasoning_content"] = reasoning_content
            conversation.append(assistant_message)

            if choice.finish_reason != "tool_calls":
                return response.model_dump()

            for tool_call in message.tool_calls or []:
                arguments, argument_error = _parse_tool_arguments(tool_call.function.arguments)
                if argument_error:
                    for call in assistant_message.get("tool_calls") or []:
                        if str(call.get("id") or "") == str(tool_call.id):
                            (call.get("function") or {})["arguments"] = "{}"
                            break
                result = (
                    {"error": argument_error}
                    if argument_error
                    else self.call_tool(tool_call.function.name, arguments)
                )
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
                )

        raise RuntimeError("Agent 执行轮次超过上限，请缩小任务范围后重试")

    def stream_chat(self, messages: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        if self.provider == "anthropic":
            yield from self._stream_chat_anthropic(messages)
            return

        conversation = [*messages]

        for _ in range(MAX_AGENT_TURNS):
            assistant_message, finish_reason = yield from self._stream_openai_turn(conversation)
            conversation.append(assistant_message)

            tool_calls = assistant_message.get("tool_calls") or []
            if tool_calls and finish_reason == "tool_calls":
                for tool_call in tool_calls:
                    tool_call_id = str(tool_call.get("id") or f"tool_call_{uuid4().hex}")
                    function_payload = tool_call.get("function") or {}
                    name = str(function_payload.get("name") or "")
                    arguments_json = str(function_payload.get("arguments") or "{}")
                    args, argument_error = _parse_tool_arguments(arguments_json)
                    if argument_error:
                        # Some OpenAI-compatible providers validate historical tool calls before
                        # generating the next turn. Never feed their malformed arguments back.
                        function_payload["arguments"] = "{}"
                        result = {"error": argument_error}
                        yield {"type": "tool_start", "tool_call_id": tool_call_id, "name": name, "arguments": args}
                        yield {"type": "tool_result", "tool_call_id": tool_call_id, "name": name, "result": result}
                        conversation.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": json.dumps(result, ensure_ascii=False, default=str),
                            }
                        )
                        continue
                    step_id = f"step_{tool_call_id}"
                    yield {"type": "step_start", "step_id": step_id}
                    yield {"type": "tool_start", "tool_call_id": tool_call_id, "name": name, "arguments": args}
                    result = self.call_tool(name, args)
                    yield {"type": "tool_result", "tool_call_id": tool_call_id, "name": name, "result": result}
                    if result.get("type") == "workspace_action":
                        yield {"type": "workspace_action", "action": result["action"]}
                    if result.get("type") == "plan":
                        yield {"type": "plan", "plan": result["plan"]}
                    if result.get("type") == "confirmation_required":
                        yield {"type": "confirmation_required", "confirmation": result["confirmation"]}
                        return
                    yield {"type": "step_result", "step_id": step_id, "result": result}
                    conversation.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": json.dumps(result, ensure_ascii=False, default=str),
                        }
                    )
                yield {"type": "tool_done"}
                continue

            yield {"type": "done", "finish_reason": finish_reason or "stop"}
            return

        yield {"type": "error", "message": "Agent 执行轮次超过上限，请缩小任务范围后重试"}

    def _chat_anthropic(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        conversation = [*messages]

        for _ in range(MAX_AGENT_TURNS):
            response = self.client.create(conversation, tools=self._tools())
            conversation.append(_anthropic_assistant_message(response))
            tool_uses = _anthropic_tool_uses(response)

            if not tool_uses:
                return {
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": _anthropic_text(response)},
                            "finish_reason": response.get("stop_reason") or "stop",
                        }
                    ],
                    "usage": response.get("usage", {}),
                }

            for tool_use in tool_uses:
                result = self.call_tool(str(tool_use["name"]), tool_use.get("input") or {})
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_use["id"],
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
                )

        raise RuntimeError("Agent 执行轮次超过上限，请缩小任务范围后重试")

    def _stream_chat_anthropic(self, messages: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        conversation = [*messages]

        for _ in range(MAX_AGENT_TURNS):
            assistant_message, tool_uses, finish_reason = yield from self._stream_anthropic_turn(conversation)
            conversation.append(assistant_message)
            if not tool_uses:
                yield {"type": "done", "finish_reason": finish_reason}
                return

            for tool_use in tool_uses:
                tool_call_id = str(tool_use["id"])
                name = str(tool_use["name"])
                args = tool_use.get("input") or {}
                step_id = f"step_{tool_call_id}"
                yield {"type": "step_start", "step_id": step_id}
                yield {"type": "tool_start", "tool_call_id": tool_call_id, "name": name, "arguments": args}
                result = self.call_tool(name, args)
                yield {"type": "tool_result", "tool_call_id": tool_call_id, "name": name, "result": result}
                if result.get("type") == "workspace_action":
                    yield {"type": "workspace_action", "action": result["action"]}
                if result.get("type") == "plan":
                    yield {"type": "plan", "plan": result["plan"]}
                if result.get("type") == "confirmation_required":
                    yield {"type": "confirmation_required", "confirmation": result["confirmation"]}
                    return
                yield {"type": "step_result", "step_id": step_id, "result": result}
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
                )
            yield {"type": "tool_done"}

        yield {"type": "error", "message": "Agent 执行轮次超过上限，请缩小任务范围后重试"}

    def _stream_openai_turn(self, conversation: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=conversation,
            tools=self._tools(),
            tool_choice="auto",
            stream=True,
        )
        assistant_message: dict[str, Any] = {"role": "assistant", "content": ""}
        tool_call_states: dict[int, dict[str, Any]] = {}
        finish_reason = "stop"

        for chunk in stream:
            for choice in getattr(chunk, "choices", []) or []:
                delta = getattr(choice, "delta", None)
                if delta is not None:
                    reasoning_fragment = _text_from_stream_value(_reasoning_value(delta))
                    if reasoning_fragment:
                        _append_stream_text(assistant_message, "reasoning_content", reasoning_fragment)
                        yield {"type": "reasoning", "content": reasoning_fragment}

                    content_fragment = _text_from_stream_value(_extra_value(delta, "content"))
                    if content_fragment:
                        _append_stream_text(assistant_message, "content", content_fragment)
                        yield {"type": "token", "content": content_fragment}

                    for tool_call in _extra_value(delta, "tool_calls") or []:
                        _update_openai_tool_call_state(tool_call_states, tool_call)

                if getattr(choice, "finish_reason", None):
                    finish_reason = str(choice.finish_reason)

        if tool_call_states:
            assistant_message["tool_calls"] = _finalize_openai_tool_calls(tool_call_states)
        if not assistant_message.get("content"):
            assistant_message["content"] = ""
        return assistant_message, finish_reason

    def _stream_anthropic_turn(self, conversation: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        content_blocks: dict[int, dict[str, Any]] = {}
        finish_reason = "stop"

        for payload in self.client.stream(conversation, tools=self._tools()):
            event_name = str(payload.get("event") or "")
            data = payload.get("data") or {}

            if event_name == "message_delta":
                delta = data.get("delta") or {}
                finish_reason = str(delta.get("stop_reason") or finish_reason)
                continue

            if event_name == "content_block_start":
                index = int(data.get("index") or 0)
                block = data.get("content_block") or {}
                block_type = str(block.get("type") or "")
                if block_type == "thinking":
                    content_blocks[index] = {
                        "type": "thinking",
                        "thinking": str(block.get("thinking") or ""),
                        "signature": str(block.get("signature") or ""),
                    }
                    if content_blocks[index]["thinking"]:
                        yield {"type": "reasoning", "content": content_blocks[index]["thinking"]}
                elif block_type == "tool_use":
                    content_blocks[index] = {
                        "type": "tool_use",
                        "id": str(block.get("id") or ""),
                        "name": str(block.get("name") or ""),
                        "input": block.get("input") if isinstance(block.get("input"), dict) else {},
                        "input_json": "",
                    }
                else:
                    content_blocks[index] = {
                        "type": "text",
                        "text": str(block.get("text") or ""),
                    }
                    if content_blocks[index]["text"]:
                        yield {"type": "token", "content": content_blocks[index]["text"]}
                continue

            if event_name == "content_block_delta":
                index = int(data.get("index") or 0)
                block = content_blocks.setdefault(index, {"type": "text", "text": ""})
                delta = data.get("delta") or {}
                delta_type = str(delta.get("type") or "")
                if delta_type == "thinking_delta":
                    fragment = str(delta.get("thinking") or "")
                    block["thinking"] = f"{block.get('thinking', '')}{fragment}"
                    if fragment:
                        yield {"type": "reasoning", "content": fragment}
                    continue
                if delta_type == "text_delta":
                    fragment = str(delta.get("text") or "")
                    block["text"] = f"{block.get('text', '')}{fragment}"
                    if fragment:
                        yield {"type": "token", "content": fragment}
                    continue
                if delta_type == "input_json_delta":
                    block["input_json"] = f"{block.get('input_json', '')}{str(delta.get('partial_json') or '')}"
                    continue
                if delta_type == "signature_delta":
                    block["signature"] = str(delta.get("signature") or "")
                continue

            if event_name == "content_block_stop":
                index = int(data.get("index") or 0)
                block = content_blocks.get(index)
                if block and block.get("type") == "tool_use":
                    raw_input = str(block.get("input_json") or "").strip()
                    if raw_input:
                        try:
                            block["input"] = json.loads(raw_input)
                        except json.JSONDecodeError:
                            block["input"] = {}
                continue

            if event_name == "message_stop":
                break

        assistant_content: list[dict[str, Any]] = []
        tool_uses: list[dict[str, Any]] = []
        for _, block in sorted(content_blocks.items(), key=lambda item: item[0]):
            block_type = str(block.get("type") or "")
            if block_type == "thinking":
                thinking_block = {"type": "thinking", "thinking": str(block.get("thinking") or "")}
                signature = str(block.get("signature") or "")
                if signature:
                    thinking_block["signature"] = signature
                assistant_content.append(thinking_block)
                continue
            if block_type == "tool_use":
                tool_use = {
                    "type": "tool_use",
                    "id": str(block.get("id") or ""),
                    "name": str(block.get("name") or ""),
                    "input": block.get("input") if isinstance(block.get("input"), dict) else {},
                }
                assistant_content.append(tool_use)
                tool_uses.append(tool_use)
                continue
            assistant_content.append({"type": "text", "text": str(block.get("text") or "")})

        return {"role": "assistant", "content": assistant_content}, tool_uses, finish_reason

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            if name == "create_agent_plan":
                plan = self._create_agent_plan(arguments)
                return {"type": "plan", "plan": plan.model_dump()}

            if name == "validate_sql":
                target_database, target_pg_database = self._resolve_target_context(arguments) if self.engine is not None else (self.database, self.pg_database)
                sql = str(arguments["sql"])
                readonly = bool(arguments.get("readonly", True))
                validation = self._validate_sql(sql, readonly)
                if validation.get("requires_confirmation") and validation.get("statement_type") in WRITE_SQL_TYPES and validation.get("sql"):
                    return self._confirmation_required_result(str(validation["sql"]), validation, target_database, target_pg_database)
                validation["database"] = target_database
                validation["pg_database"] = target_pg_database
                return validation

            if name == "append_query_sql":
                action = AgentWorkspaceAction(type="append_query_sql", sql=str(arguments["sql"]), title=str(arguments["title"]) if arguments.get("title") else None)
                return {"type": "workspace_action", "action": action.model_dump(), "executed": False, "message": "SQL 已发送到查询窗口，尚未执行。"}

            if self.engine is None:
                return {"error": "当前未选择数据库上下文，不能执行数据库工具。可以回答通用问题、总结连接信息，或把生成的 SQL 写入查询窗口。"}

            if name == "list_databases":
                databases = [database.model_dump() for database in list_databases(self.engine)]
                return {
                    "databases": databases,
                    "database_count": len(databases),
                    "current_database": self.database,
                    "current_pg_database": self.pg_database,
                    "message": "当前库是默认目标；同一连接内的其他库或模式可在后续工具调用中显式指定。",
                }

            if name == "list_schemas":
                _, target_pg_database = self._resolve_target_context(arguments)
                schemas = [schema.model_dump() for schema in list_schemas(self.engine, target_pg_database)]
                return {
                    "schemas": schemas,
                    "schema_count": len(schemas),
                    "pg_database": target_pg_database,
                }

            if name == "list_tables":
                target_database, target_pg_database = self._resolve_target_context(arguments)
                tables = [table.model_dump() for table in list_tables(self.engine, target_database, target_pg_database)]
                visible_tables = tables[:MAX_TABLES_IN_TOOL_RESULT]
                large_tables = [table for table in visible_tables if (table.get("size_bytes") or table.get("storage_size_bytes") or 0) >= 1024 * 1024 * 1024]
                return {
                    "database": target_database,
                    "pg_database": target_pg_database,
                    "tables": visible_tables,
                    "table_count": len(tables),
                    "returned_table_count": len(visible_tables),
                    "truncated": len(tables) > len(visible_tables),
                    "large_table_count": len(large_tables),
                    "next_step_hint": "表数量较多或存在大表，查询前应优先 describe_table，并使用聚合、过滤条件和 LIMIT。" if len(tables) > len(visible_tables) or large_tables else None,
                }

            if name == "describe_table":
                target_database, target_pg_database = self._resolve_target_context(arguments)
                table_name = str(arguments["table_name"])
                table_info = next((table for table in list_tables(self.engine, target_database, target_pg_database) if table.name == table_name), None)
                columns = [column.model_dump() for column in list_columns(self.engine, table_name, target_database, target_pg_database)]
                visible_columns = columns[:MAX_COLUMNS_IN_TOOL_RESULT]
                table_size_bytes = table_info.size_bytes if table_info else None
                storage_size_bytes = table_info.storage_size_bytes if table_info else None
                size_for_risk = table_size_bytes or storage_size_bytes or 0
                return {
                    "table_name": table_name,
                    "database": target_database,
                    "pg_database": target_pg_database,
                    "table_size_bytes": table_size_bytes,
                    "table_size_display": table_info.size_display if table_info else None,
                    "storage_size_bytes": storage_size_bytes,
                    "storage_size_display": table_info.storage_size_display if table_info else None,
                    "row_count": table_info.row_count if table_info else None,
                    "is_large_table": size_for_risk >= 1024 * 1024 * 1024,
                    "columns": visible_columns,
                    "column_count": len(columns),
                    "returned_column_count": len(visible_columns),
                    "truncated": len(columns) > len(visible_columns),
                    "next_step_hint": "字段数量较多或表体积较大，避免 SELECT *，优先使用聚合、过滤条件、索引字段和 LIMIT。" if len(columns) > len(visible_columns) or size_for_risk >= 1024 * 1024 * 1024 else None,
                }

            if name == "execute_query":
                target_database, target_pg_database = self._resolve_target_context(arguments)
                sql = str(arguments["sql"])
                readonly = bool(arguments.get("readonly", True))
                fetch_all = bool(arguments.get("fetch_all", False))
                requested_limit = max(1, min(int(arguments.get("limit", DEFAULT_QUERY_ROWS_FOR_AGENT)), MAX_QUERY_ROWS_FOR_AGENT))
                effective_limit = None if fetch_all else requested_limit
                validation = self._validate_sql(sql, readonly)
                if validation["risk_level"] == "dangerous" and validation["statement_type"] not in WRITE_SQL_TYPES:
                    return validation
                if validation["risk_level"] == "dangerous":
                    return self._confirmation_required_result(sql, validation, target_database, target_pg_database)
                result = self._execute_query(sql, readonly, effective_limit, target_database, target_pg_database)
                summarized = _summarize_query_response(result, effective_limit)
                summarized["executed"] = True
                summarized["fetch_all_requested"] = fetch_all
                summarized["query_limit_applied"] = effective_limit
                summarized["database"] = target_database
                summarized["pg_database"] = target_pg_database
                return summarized

            if name == "get_sample_data":
                target_database, target_pg_database = self._resolve_target_context(arguments)
                table_name = str(arguments["table_name"])
                limit = max(1, min(int(arguments.get("limit", 10)), MAX_SAMPLE_ROWS_FOR_AGENT))
                result = preview_table(self.engine, table_name, limit, 0, target_database, target_pg_database)
                return {"table_name": table_name, "database": target_database, "pg_database": target_pg_database, **_summarize_query_response(result, limit)}

            if name == "create_database_backup":
                database = str(arguments["database"]) if arguments.get("database") else self.pg_database or self.database
                record = backup_manager.create_backup(self.connection_id, database)
                return {"executed": True, "backup": record.model_dump(mode="json"), "message": "备份完成"}

            if name == "list_database_backups":
                backups = [backup.model_dump(mode="json") for backup in backup_manager.list_backups(self.connection_id)]
                return {"backups": backups, "backup_count": len(backups)}

            if name == "restore_database_backup":
                return self._restore_backup_confirmation_required(str(arguments["backup_id"]))

            raise ValueError(f"未知工具：{name}")
        except Exception as exc:
            return {"error": str(exc)}

    def _resolve_target_context(self, arguments: dict[str, Any]) -> tuple[str | None, str | None]:
        target_database = str(arguments["database"]) if arguments.get("database") else self.database
        target_pg_database = str(arguments["pg_database"]) if arguments.get("pg_database") else self.pg_database
        dialect_name = str(getattr(getattr(self.engine, "dialect", None), "name", "")).lower()

        if dialect_name == "sqlite":
            sqlite_database = self.database or "main"
            if target_database and target_database != sqlite_database:
                raise ValueError("SQLite 连接只支持当前数据库上下文，不能指定其他数据库")
            target_database = sqlite_database
            target_pg_database = None
        elif dialect_name not in {"postgresql", "gaussdb"}:
            target_pg_database = None

        return target_database, target_pg_database

    def _confirmation_required_result(
        self,
        sql: str,
        validation: dict[str, Any],
        database: str | None = None,
        pg_database: str | None = None,
    ) -> dict[str, Any]:
        confirmation_id = f"confirm_{uuid4().hex}"
        PENDING_CONFIRMATIONS[confirmation_id] = PendingConfirmation(
            id=confirmation_id,
            connection_id=self.connection_id,
            database=database if database is not None else self.database,
            pg_database=pg_database if pg_database is not None else self.pg_database,
            sql=sql,
            sql_hash=sql_hash(sql),
            statement_type=validation["statement_type"],
            risk_level="dangerous",
        )
        confirmation = AgentConfirmation(
            id=confirmation_id,
            title="需要确认数据库写操作",
            risk_level="dangerous",
            sql=sql,
            explanation="该 SQL 不是只读查询。为避免误修改数据，已暂停执行。确认后后端会重新校验 SQL hash 和风险等级，再执行同一条 SQL。",
            estimated_impact={"statement_type": validation["statement_type"], "sql_hash": sql_hash(sql), "executed": False},
        )
        return {"type": "confirmation_required", "confirmation": confirmation.model_dump(), "validation": validation, "executed": False}

    def _restore_backup_confirmation_required(self, backup_id: str) -> dict[str, Any]:
        record = next((backup for backup in backup_manager.list_backups(self.connection_id) if backup.id == backup_id), None)
        if record is None:
            raise ValueError("备份记录不存在或不属于当前连接")

        confirmation_id = f"confirm_{uuid4().hex}"
        PENDING_CONFIRMATIONS[confirmation_id] = PendingConfirmation(
            id=confirmation_id,
            connection_id=self.connection_id,
            database=record.database,
            pg_database=self.pg_database,
            statement_type="RESTORE_BACKUP",
            risk_level="dangerous",
            action="restore_backup",
            backup_id=backup_id,
        )
        confirmation = AgentConfirmation(
            id=confirmation_id,
            title="需要确认恢复备份",
            risk_level="dangerous",
            sql=None,
            explanation=f"恢复备份会用备份 {backup_id} 回滚/覆盖数据库 {record.database} 的当前数据。确认前请确保当前操作可以回退。",
            estimated_impact={"action": "restore_backup", "backup_id": backup_id, "database": record.database, "file_path": record.file_path, "executed": False},
        )
        return {"type": "confirmation_required", "confirmation": confirmation.model_dump(), "executed": False}

    def _create_agent_plan(self, arguments: dict[str, Any]) -> AgentPlan:
        raw_steps = arguments.get("steps") or []
        steps = [
            AgentTaskStep(
                id=f"plan_step_{index + 1}",
                title=str(step.get("title", f"步骤 {index + 1}")),
                description=str(step["description"]) if step.get("description") else None,
                risk_level=step.get("risk_level", "safe") if step.get("risk_level") in {"safe", "review", "dangerous"} else "safe",
            )
            for index, step in enumerate(raw_steps)
            if isinstance(step, dict)
        ]
        return AgentPlan(
            goal=str(arguments["goal"]),
            summary=str(arguments["summary"]),
            steps=steps,
            requires_confirmation=bool(arguments.get("requires_confirmation", False)),
            risk_level=arguments.get("risk_level", "safe") if arguments.get("risk_level") in {"safe", "review", "dangerous"} else "safe",
        )

    def _validate_sql(self, sql: str, readonly: bool) -> dict[str, Any]:
        if is_mongo_client(self.engine):
            statements = [statement.strip() for statement in sql.strip().split(";") if statement.strip()]
            valid_statements = [statement for statement in statements if statement.startswith("db.") and (".find" in statement or statement.startswith("db.createCollection") or ".insertOne" in statement or ".insertMany" in statement)]
            valid = bool(statements) and len(valid_statements) == len(statements)
            statement_type = "MONGO_MULTI" if len(statements) > 1 else "MONGO_FIND" if valid and ".find" in statements[0] else "MONGO_CREATE_COLLECTION" if valid and statements[0].startswith("db.createCollection") else "MONGO_INSERT_ONE" if valid and ".insertOne" in statements[0] else "MONGO_INSERT_MANY" if valid and ".insertMany" in statements[0] else "UNKNOWN"
            return {
                "valid": valid,
                "readonly": readonly,
                "statement_type": statement_type,
                "risk_level": "safe" if valid else "dangerous",
                "executed": False,
                "requires_confirmation": False,
                "message": "MongoDB 语句校验通过，但 validate_sql 只校验不执行" if valid else "MongoDB 当前支持 db.<collection>.find({...}) 查询、db.createCollection(\"collection\") 创建集合、insertOne/insertMany 插入文档",
                "sql": sql.strip().rstrip(";"),
                "has_limit": True,
            }

        if is_redis_client(self.engine):
            parts = sql.strip().rstrip(";").split()
            command = parts[0].upper() if parts else "UNKNOWN"
            supported = {"SCAN", "KEYS", "GET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL", "SET", "HSET", "LPUSH", "RPUSH", "SADD", "ZADD", "DEL", "EXPIRE"}
            valid = command in supported
            return {
                "valid": valid,
                "readonly": readonly,
                "statement_type": f"REDIS_{command}",
                "risk_level": "safe" if valid else "dangerous",
                "executed": False,
                "requires_confirmation": False,
                "message": "Redis 命令校验通过，但 validate_sql 只校验不执行" if valid else "Redis 当前支持 SCAN/KEYS/GET/HGETALL/LRANGE/SMEMBERS/ZRANGE/XRANGE/TYPE/TTL 以及 SET/HSET/LPUSH/RPUSH/SADD/ZADD/DEL/EXPIRE",
                "sql": sql.strip().rstrip(";"),
                "has_limit": True,
            }

        statements = [statement for statement in sqlparse.parse(sql) if str(statement).strip()]
        if len(statements) != 1:
            return {
                "valid": False,
                "readonly": readonly,
                "statement_type": "UNKNOWN",
                "risk_level": "dangerous",
                "executed": False,
                "requires_confirmation": True,
                "message": "只允许单条 SQL。多个建表或写操作必须拆成单条 SQL，逐条请求用户确认。",
            }

        statement = statements[0]
        statement_type = statement.get_type().upper()
        normalized_sql = str(statement).strip().rstrip(";")
        has_limit = any(token.normalized == "LIMIT" for token in statement.flatten())

        if readonly and statement_type not in READONLY_SQL_TYPES:
            return {
                "valid": False,
                "readonly": readonly,
                "statement_type": statement_type,
                "risk_level": "dangerous",
                "executed": False,
                "requires_confirmation": True,
                "message": "只读模式下禁止执行写操作或 DDL。该 SQL 尚未执行，必须通过 execute_query(readonly=false) 触发用户确认后才可能执行。",
                "sql": normalized_sql,
            }

        if statement_type in WRITE_SQL_TYPES:
            return {
                "valid": not readonly,
                "readonly": readonly,
                "statement_type": statement_type,
                "risk_level": "dangerous",
                "executed": False,
                "requires_confirmation": True,
                "message": "该 SQL 会修改数据库，当前仅完成校验，尚未执行；必须通过 execute_query(readonly=false) 触发用户确认后才可能执行。",
                "sql": normalized_sql,
            }

        risk_level = "review" if statement_type in READONLY_SQL_TYPES and not has_limit else "safe"
        return {
            "valid": statement_type in READONLY_SQL_TYPES or not readonly,
            "readonly": readonly,
            "statement_type": statement_type,
            "risk_level": risk_level,
            "executed": False,
            "requires_confirmation": False,
            "message": "SQL 校验通过，但 validate_sql 只校验不执行" if risk_level == "safe" else "只读查询未显式 LIMIT，validate_sql 只校验不执行；真正执行时会由后端限制返回行数",
            "sql": normalized_sql,
            "has_limit": has_limit,
        }

    def _execute_query(
        self,
        sql: str,
        readonly: bool,
        limit: int | None = DEFAULT_QUERY_ROWS_FOR_AGENT,
        database: str | None = None,
        pg_database: str | None = None,
    ) -> QueryResponse:
        target_database = database if database is not None else self.database
        target_pg_database = pg_database if pg_database is not None else self.pg_database
        if readonly:
            return execute_readonly_query(self.engine, sql, limit, 0, target_database, target_pg_database)

        if is_mongo_client(self.engine) or is_redis_client(self.engine):
            return execute_readonly_query(self.engine, sql, limit, 0, target_database, target_pg_database)

        return execute_query(self.engine, sql, limit, 0, target_database, target_pg_database)


def build_system_prompt(db_type: str, db_name: str, workspace: AgentWorkspaceContext | None = None) -> str:
    workspace_lines: list[str] = []
    if workspace:
        current_context = {
            "connectionName": workspace.current_connection_name,
            "dbType": workspace.current_db_type or db_type,
            "serverVersion": workspace.current_server_version,
            "database": workspace.current_database,
            "pgDatabase": workspace.current_pg_database,
            "schema": workspace.focused_resource.schema_name if workspace.focused_resource and workspace.focused_resource.schema_name else workspace.current_database,
        }
        workspace_lines.append(f"当前执行上下文：{json.dumps({key: value for key, value in current_context.items() if value}, ensure_ascii=False, default=str)}")
        if workspace.connections:
            workspace_lines.append(f"当前所有连接概要：{json.dumps([connection.model_dump(exclude_none=True) for connection in workspace.connections], ensure_ascii=False, default=str)}")
        if workspace.focused_resource:
            workspace_lines.append(f"当前焦点资源：{json.dumps(workspace.focused_resource.model_dump(exclude_none=True), ensure_ascii=False, default=str)}")
        if workspace.active_tab_kind:
            workspace_lines.append(f"当前工作页类型：{workspace.active_tab_kind}")
        if workspace.selected_table:
            workspace_lines.append(f"当前选中表：{workspace.selected_table}")
        if workspace.active_sql:
            workspace_lines.append(f"当前 SQL 编辑器内容：\n{workspace.active_sql}")
        if workspace.visible_result_columns:
            workspace_lines.append(f"当前结果列：{', '.join(workspace.visible_result_columns)}")
        if workspace.visible_result_sample:
            workspace_lines.append(f"当前结果样本：{json.dumps(workspace.visible_result_sample[:5], ensure_ascii=False, default=str)}")
        if workspace.context_sources:
            workspace_lines.append(f"AI 上下文数据源列表（第一个为当前执行上下文）：{json.dumps([source.model_dump(exclude_none=True) for source in workspace.context_sources], ensure_ascii=False, default=str)}")
        if workspace.recent_queries:
            workspace_lines.append(f"最近查询：{json.dumps(workspace.recent_queries[-5:], ensure_ascii=False)}")

    workspace_context = "\n".join(workspace_lines) if workspace_lines else "暂无额外工作区上下文。"
    context_label = f"当前连接的是 {db_type} 数据库 {db_name}" if db_type != "none" else "当前未选择数据库上下文"
    query_limit_rule = (
        "规则补充：查询数据时默认只读取一部分数据，调用 execute_query 时使用 limit 参数；"
        "只有用户明确说获取全部、所有、全量数据时，才允许设置 fetch_all=true。"
        "即使执行了全量查询，工具返回给 AI 的内容仍可能只展示摘要，看到 truncated=true 时要说明这一点。"
    )
    workspace_context = f"{query_limit_rule}\n{workspace_context}"
    product_knowledge = get_product_knowledge()
    return (
        f"你是 DataDjinn 内置数据库 Agent，{context_label}。\n"
        "你的职责是帮助用户理解数据库结构、生成安全 SQL、分析查询结果、执行可控数据库操作。\n"
        "规则：\n"
        "1. 未选择数据库上下文时，不得执行 list_tables、describe_table、execute_query、get_sample_data 等数据库任务；可直接依据内置产品知识库回答软件功能和用法问题、整理工作区已有连接概要，或调用 append_query_sql 把 SQL 写入查询窗口。\n"
        "2. 复杂分析、排查或包含多步动作时，先调用 create_agent_plan 生成可见计划。\n"
        "3. 执行 SQL 前先调用 validate_sql；validate_sql 只做校验，永远不代表 SQL 已执行。但 MongoDB 上下文中用户明确要求创建集合、插入测试数据、初始化样例数据时，可以直接调用 execute_query 自动执行支持的 MongoDB 语句，不要改为 append_query_sql。\n"
        "4. SELECT/WITH 只读查询可以通过 execute_query(readonly=true) 自动执行，后端会限制返回行数。MongoDB 的 find/createCollection/insertOne/insertMany 和 Redis 支持命令也通过 execute_query(readonly=true) 自动执行。\n"
        "5. UPDATE/DELETE/INSERT/DDL 等 SQL 写操作必须触发工具级 confirmation_required，由界面显示确认/取消按钮；不要只用自然语言要求用户输入确认。MongoDB 当前支持的 createCollection/insertOne/insertMany、Redis 基础写入命令属于用户明确请求时允许自动执行的安全范围。\n"
        "6. 写操作可调用 validate_sql 或 execute_query(readonly=false) 触发 confirmation_required；只有确认接口返回 executed=true 后才能说执行成功。\n"
        "7. 不确定表结构时不要猜字段名，先 describe_table。\n"
        "8. 对大表查询优先使用聚合条件或 LIMIT。\n"
        "9. 工具返回的数据可能是摘要或样本；看到 truncated=true 时，必须说明只分析了样本/摘要，并优先继续使用聚合、过滤或分页查询缩小范围。\n"
        "10. 不要要求工具读取全量大表；需要趋势、分布、异常时，用 COUNT、GROUP BY、MIN/MAX、DISTINCT 等 SQL 在数据库侧聚合。\n"
        "11. list_tables 和 describe_table 会返回 size_bytes/size_display 作为估算数据大小，并可能返回 storage_size_bytes/storage_size_display 作为物理占用；对大库、大模式、大表必须先评估体积，再决定是否只做抽样、聚合或要求用户确认。\n"
        "12. 多个建表、DDL 或写操作必须拆成多条单 SQL，逐条触发 confirmation_required、逐条等待用户点击确认按钮，不允许一次声明全部完成。\n"
        "13. 如果工具结果没有 executed=true，必须明确说明尚未执行，不能说创建、修改、删除、备份或恢复成功。\n"
        "14. 用户要求备份数据库时调用 create_database_backup；用户要求恢复备份时先调用 list_database_backups 找到备份记录，再调用 restore_database_backup 触发确认，确认返回 executed=true 后才能说恢复完成。\n"
        "15. 当前连接是数据库工具的访问边界；当前库或模式只是默认和优先目标。如需同一连接内的其他库或模式，先调用 list_databases（PostgreSQL/高斯再调用 list_schemas），然后在后续工具调用中显式指定 database 或 pg_database；不能猜测目标，也不能跨连接。\n"
        "16. PostgreSQL 和高斯数据库可在同一连接内切换 pg_database；每次切换后先确认 schema，再生成 SQL。SQL 必须在指定 pg_database 内执行，生成 SQL 时优先使用 schema.table，或只使用当前 schema 下的表名，不要生成 database.table 形式。\n"
        "17. 生成 SQL 必须优先匹配当前执行上下文里的 dbType 和 serverVersion；不确定版本是否支持某个语法时，使用该数据库更保守、更通用的写法。\n"
        "18. 用户说“当前连接/当前库/当前模式/当前表”时，优先使用工作区里的当前焦点资源；如果没有焦点资源，再使用 AI 上下文数据源列表的第一个。\n"
        "19. 用户只要说生成 SQL、给出 SQL、帮我写 SQL、生成插入语句、生成建表语句，默认都应调用 append_query_sql 把 SQL 写入查询窗口，不执行；只有用户明确说执行、创建、插入、初始化、运行、落库时，才调用 execute_query。用户后续补充“不要执行，只生成”时，也必须改为 append_query_sql。\n"
        "20. MongoDB 上下文中，创建集合使用 db.createCollection(\"collection\")；插入测试数据优先把多条文档合并为一条 db.<collection>.insertMany([...]) 调用，不要逐条 insertOne 导致轮次耗尽；文档键和值都使用带引号的 Python/JSON 风格字面量。可以把 createCollection 和 insertMany 用分号组成一次 execute_query 调用完成。\n"
        "21. Redis 上下文中，查看 Key 列表优先使用 SCAN；查看字符串用 GET key，查看 hash/list/set/zset/stream 分别用 HGETALL/LRANGE/SMEMBERS/ZRANGE/XRANGE；创建或写入测试数据可使用 SET/HSET/LPUSH/RPUSH/SADD/ZADD，并说明会修改 Redis 数据。\n"
        "22. 用户询问软件功能、操作步骤、快捷键、导入导出、设置、驱动、主题、更新或 AI 用法时，优先直接引用内置产品知识库回答；不要调用数据库工具，也不要把产品操作误解为数据库操作。\n\n"
        f"内置产品知识库：\n{product_knowledge}\n\n"
        f"工作区上下文：\n{workspace_context}"
    )
