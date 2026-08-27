import unittest
from typing import Any
from unittest.mock import patch

from app.ai.agent import AIConfig, AgentConfirmRequest, DatabaseAgent, PENDING_CONFIRMATIONS, PendingConfirmation, build_system_prompt, sql_hash
from app.api.ai_router import confirm_agent_action
from app.schemas.query import QueryResponse


class FakeObject:
    def __init__(self, **kwargs: Any) -> None:
        for key, value in kwargs.items():
            setattr(self, key, value)

    def model_dump(self, exclude_none: bool = True) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in self.__dict__.items():
            if exclude_none and value is None:
                continue
            result[key] = value
        return result


class FakeOpenAIClient:
    def __init__(self, streams: list[list[Any]]) -> None:
        self._streams = streams
        self._call_index = 0
        self.calls: list[dict[str, Any]] = []
        self.chat = FakeObject(completions=FakeObject(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            if self._call_index >= len(self._streams):
                raise AssertionError("流式调用次数超出测试预期")
            stream = self._streams[self._call_index]
            self._call_index += 1
            return iter(stream)
        raise AssertionError("这个测试只应该走流式接口")


class FakeAnthropicClient:
    def __init__(self, events: list[dict[str, Any]]) -> None:
        self._events = events

    def stream(self, messages: list[dict[str, Any]], **kwargs: Any) -> Any:
        return iter(self._events)


class DatabaseAgentStreamingTests(unittest.TestCase):
    def tearDown(self) -> None:
        PENDING_CONFIRMATIONS.clear()

    def test_list_tables_uses_explicit_database_on_current_connection(self) -> None:
        agent = DatabaseAgent(object(), AIConfig(base_url="https://example.com/v1", api_key="test", model="demo"), database="primary")
        table = FakeObject(name="orders", size_bytes=0, storage_size_bytes=0)

        with patch("app.ai.agent.list_tables", return_value=[table]) as list_tables_mock:
            result = agent.call_tool("list_tables", {"database": "analytics"})

        list_tables_mock.assert_called_once_with(agent.engine, "analytics", None)
        self.assertEqual(result["database"], "analytics")
        self.assertEqual(result["table_count"], 1)

    def test_list_databases_exposes_current_connection_scope(self) -> None:
        agent = DatabaseAgent(object(), AIConfig(base_url="https://example.com/v1", api_key="test", model="demo"), database="primary")

        with patch("app.ai.agent.list_databases", return_value=[FakeObject(name="primary"), FakeObject(name="analytics")]):
            result = agent.call_tool("list_databases", {})

        self.assertEqual(result["database_count"], 2)
        self.assertEqual(result["current_database"], "primary")
        self.assertEqual([item["name"] for item in result["databases"]], ["primary", "analytics"])

    def test_cross_database_write_confirmation_locks_tool_target(self) -> None:
        agent = DatabaseAgent(object(), AIConfig(base_url="https://example.com/v1", api_key="test", model="demo"), connection_id="connection_1", database="primary")

        result = agent.call_tool("execute_query", {"sql": "DELETE FROM audit_log", "readonly": False, "database": "analytics"})

        self.assertEqual(result["type"], "confirmation_required")
        pending = PENDING_CONFIRMATIONS[result["confirmation"]["id"]]
        self.assertEqual(pending.connection_id, "connection_1")
        self.assertEqual(pending.database, "analytics")
        self.assertIsNone(pending.pg_database)

    def test_sqlite_rejects_cross_database_target(self) -> None:
        engine = FakeObject(dialect=FakeObject(name="sqlite"))
        agent = DatabaseAgent(engine, AIConfig(base_url="https://example.com/v1", api_key="test", model="demo"), database="main")

        result = agent.call_tool("list_tables", {"database": "other"})

        self.assertEqual(result["error"], "SQLite 连接只支持当前数据库上下文，不能指定其他数据库")

    def test_confirmation_executes_the_database_locked_by_the_tool_call(self) -> None:
        confirmation_id = "confirm_cross_database"
        PENDING_CONFIRMATIONS[confirmation_id] = PendingConfirmation(
            id=confirmation_id,
            connection_id="connection_1",
            database="analytics",
            sql="DELETE FROM audit_log",
            sql_hash=sql_hash("DELETE FROM audit_log"),
            statement_type="DELETE",
            risk_level="dangerous",
        )
        captured: dict[str, str | None] = {}

        def fake_execute(agent: DatabaseAgent, sql: str, readonly: bool, limit: int | None = 200) -> QueryResponse:
            captured["database"] = agent.database
            captured["pg_database"] = agent.pg_database
            return QueryResponse(columns=[], rows=[], row_count=0, limited=False)

        with patch("app.api.ai_router._ensure_open_engine", return_value=object()), patch.object(DatabaseAgent, "_execute_query", new=fake_execute):
            result = confirm_agent_action(
                AgentConfirmRequest(
                    connection_id="connection_1",
                    confirmation_id=confirmation_id,
                    approved=True,
                    database="primary",
                )
            )

        self.assertTrue(result["executed"])
        self.assertEqual(captured, {"database": "analytics", "pg_database": None})

    def test_gaussdb_write_execution_uses_selected_database_and_schema(self) -> None:
        engine = object()
        agent = DatabaseAgent(
            engine,
            AIConfig(base_url="https://example.com/v1", api_key="test", model="demo"),
            database="test",
            pg_database="vhukze",
        )
        response = QueryResponse(columns=["message"], rows=[{"message": "SQL 执行成功"}], row_count=1, limited=False)

        with patch("app.ai.agent.execute_query", return_value=response) as execute:
            actual = agent._execute_query("CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)", readonly=False)

        self.assertIs(actual, response)
        execute.assert_called_once_with(
            engine,
            "CREATE TABLE test.test_department (dept_id INTEGER PRIMARY KEY)",
            200,
            0,
            "test",
            "vhukze",
        )

    def test_system_prompt_includes_product_knowledge_for_global_help(self) -> None:
        prompt = build_system_prompt("none", "未选择上下文")

        self.assertIn("内置产品知识库", prompt)
        self.assertIn("每个连接的提交历史独立保存", prompt)
        self.assertIn("右键该连接选择“版本管理”", prompt)
        self.assertIn("首次点击“创建初始快照”会把所选范围下全部表的 DDL 和数据压缩后作为一个 Git 提交上传", prompt)
        self.assertIn("提交说明包含变更 SQL", prompt)
        self.assertIn("先显示版本管理窗口并在后台静默打开连接", prompt)
        self.assertIn("上传使用 gzip 压缩并按变化表增量写入 Git", prompt)
        self.assertIn("也可在二次确认后恢复该表的历史结构或数据", prompt)
        self.assertNotIn("受控回退", prompt)
        self.assertIn("MySQL、ClickHouse、达梦和 Oracle 选择要纳管的数据库", prompt)
        self.assertIn("系统范围不会显示", prompt)
        self.assertIn("连接树排序作为整棵树的一个整体冲突处理", prompt)
        self.assertIn("左右树形差异对比展示", prompt)
        self.assertIn("默认保留本机配置，可直接确认同步", prompt)
        self.assertIn("独立新增的连接和分组仍会保留在原父分组中", prompt)
        self.assertIn("后续结构变更和表预览保存数据会在后台自动提交", prompt)
        self.assertIn("验证码会在 DataDjinn 设置页持续显示并支持复制", prompt)
        self.assertIn("每 15 分钟在后台同步一次", prompt)
        self.assertIn("修改同步口令", prompt)
        self.assertIn("应用设置、AI 配置/API Key、连接参数、数据库密码、SSH 密码", prompt)
        self.assertIn("JDBC 驱动路径、Java 路径和 SSH 私钥文件路径属于设备配置，不会同步", prompt)
        self.assertIn("修改入口：点击应用右上角“设置”，在左侧选择“快捷键”", prompt)
        self.assertIn("右键该连接并选择“停止连接”", prompt)
        self.assertIn("保存并重新连接", prompt)
        self.assertIn("自动展开父路径并滚动到该节点", prompt)
        self.assertIn("添加子分组", prompt)
        self.assertIn("保留当前横向和纵向滚动位置", prompt)
        self.assertIn("整次测试最多等待 10 秒", prompt)
        self.assertIn("搜索框显示“当前项/总数”", prompt)
        self.assertIn("先显示表名", prompt)
        self.assertIn("后台计算并回填大小", prompt)
        self.assertIn("只有一个数据列", prompt)
        self.assertIn("自动填满行号右侧的可用空间", prompt)
        self.assertIn("未进入编辑时按 Delete 会批量清空选区", prompt)
        self.assertIn("导出连接", prompt)
        self.assertIn("保存前可在连接弹框选择已有分组，也可直接新建分组", prompt)
        self.assertIn("所有顶级分组固定显示在所有根连接之前", prompt)
        self.assertIn("分组不显示展开按钮，只能双击展开或收起", prompt)
        self.assertIn("达梦表结构编辑支持修改表名、字段名、字段类型和空值约束，也支持修改表注释和字段注释", prompt)
        self.assertIn("根连接和顶级分组的右键菜单均可置顶或取消置顶", prompt)
        self.assertIn("复制为 JDBC URL", prompt)
        self.assertIn("所有受支持的 SQL 数据库都支持一致的 `--` 行注释处理", prompt)
        self.assertIn("只含注释的区域不会显示执行按钮", prompt)
        self.assertIn("分号后的尾注释也不会被识别成独立语句", prompt)
        self.assertIn("第一个可用的手动上下文会作为临时主上下文", prompt)
        self.assertIn("只能添加数据库或模式，重复项会自动去重", prompt)
        self.assertIn("模式可向上合并为所属数据库", prompt)
        self.assertIn("数据库也可下钻切换为某个模式", prompt)
        self.assertIn("查询结果支持 CSV、JSON、Markdown", prompt)
        self.assertIn("查询结果会为简单 SELECT 中可直接溯源的字段启用同样的单元格编辑和选择能力", prompt)
        self.assertIn("失焦后，尚未提交的修改会以橙色单元格和对应行号标记", prompt)
        self.assertIn("数据库因空闲而断开后，再执行树、表或查询操作时会自动静默重连并重试", prompt)
        self.assertIn("达梦表结构编辑支持修改表名、字段名、字段类型和空值约束", prompt)
        self.assertIn("SQL 导出始终保留完整表结构", prompt)
        self.assertIn("存储过程右键菜单在“导入”项下方提供“执行存储过程”", prompt)
        self.assertIn("输入留空默认传入 NULL", prompt)
        self.assertIn("达梦使用 JDBC 驱动时支持带输入参数的过程调用", prompt)
        self.assertIn("DDL 会自动保证末尾带分号", prompt)
        self.assertIn("输入 CALL 后会优先提示当前库或模式内的存储过程", prompt)
        self.assertIn("选中多条 SQL 后执行时会按顺序逐条运行", prompt)
        self.assertIn("DML 只显示执行状态和影响行数，不会再额外显示空结果表", prompt)
        self.assertIn("软件功能和用法问题", prompt)
        self.assertIn("当前连接是 AI 数据库工具的访问边界", prompt)
        self.assertIn("不能跨连接访问", prompt)
        self.assertIn("确认请求会锁定 AI 工具实际选择的连接、数据库和模式", prompt)
        self.assertIn("仅本机的 STDIO MCP 服务", prompt)
        self.assertIn("模块统一在“设置 -> 扩展”中查看、安装和卸载", prompt)
        self.assertIn("下载、校验和解压期间会显示“安装中”状态", prompt)
        self.assertIn("扩展卡片会独立显示版本和安装时间", prompt)
        self.assertIn("JDBC 数据库支持在“设置 -> 扩展”中作为一个模块安装", prompt)
        self.assertIn("自动检测本机可用的 64 位 Java 8 或更高版本", prompt)
        self.assertIn("会显示可复制的 STDIO 启动命令，命令参数为空", prompt)
        self.assertIn("MCP 更新始终保持 `modules\\mcp\\current` 启动路径", prompt)
        self.assertIn("confirm_write=true", prompt)
        self.assertIn("设置 -> AI", prompt)
        self.assertIn("右上角更新图标显示红点", prompt)

    def test_openai_stream_chat_emits_incremental_reasoning_and_tokens(self) -> None:
        config = AIConfig(provider="openai-compatible", base_url="https://example.com/v1", api_key="test", model="demo", max_context_tokens=200_000)
        agent = DatabaseAgent(None, config)
        agent.client = FakeOpenAIClient(
            [
                [
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(reasoning_content="先", content="你"),
                                finish_reason=None,
                            )
                        ]
                    ),
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(reasoning_content="想", content="好"),
                                finish_reason="stop",
                            )
                        ]
                    ),
                ]
            ]
        )

        events = list(agent.stream_chat([{"role": "user", "content": "你好"}]))

        self.assertEqual(
            events,
            [
                {"type": "reasoning", "content": "先"},
                {"type": "token", "content": "你"},
                {"type": "reasoning", "content": "想"},
                {"type": "token", "content": "好"},
                {"type": "done", "finish_reason": "stop"},
            ],
        )

    def test_openai_stream_chat_assembles_tool_calls_from_deltas(self) -> None:
        config = AIConfig(provider="openai-compatible", base_url="https://example.com/v1", api_key="test", model="demo", max_context_tokens=200_000)
        agent = DatabaseAgent(None, config)
        agent.client = FakeOpenAIClient(
            [
                [
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(
                                    tool_calls=[
                                        FakeObject(
                                            index=0,
                                            id="call_1",
                                            type="function",
                                            function=FakeObject(name="append_query_sql", arguments='{"sql":"SEL'),
                                        )
                                    ]
                                ),
                                finish_reason=None,
                            )
                        ]
                    ),
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(
                                    tool_calls=[
                                        FakeObject(
                                            index=0,
                                            function=FakeObject(arguments='ECT 1"}'),
                                        )
                                    ]
                                ),
                                finish_reason="tool_calls",
                            )
                        ]
                    ),
                ],
                [
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(content="已"),
                                finish_reason=None,
                            )
                        ]
                    ),
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(content="完成"),
                                finish_reason="stop",
                            )
                        ]
                    ),
                ],
            ]
        )

        tool_calls: list[tuple[str, dict[str, Any]]] = []

        def fake_call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
            tool_calls.append((name, arguments))
            return {"type": "workspace_action", "action": {"type": "append_query_sql", "sql": arguments["sql"]}}

        agent.call_tool = fake_call_tool  # type: ignore[method-assign]

        events = list(agent.stream_chat([{"role": "user", "content": "生成 SQL"}]))

        self.assertEqual(tool_calls, [("append_query_sql", {"sql": "SELECT 1"})])
        self.assertEqual(
            events,
            [
                {"type": "step_start", "step_id": "step_call_1"},
                {"type": "tool_start", "tool_call_id": "call_1", "name": "append_query_sql", "arguments": {"sql": "SELECT 1"}},
                {"type": "tool_result", "tool_call_id": "call_1", "name": "append_query_sql", "result": {"type": "workspace_action", "action": {"type": "append_query_sql", "sql": "SELECT 1"}}},
                {"type": "workspace_action", "action": {"type": "append_query_sql", "sql": "SELECT 1"}},
                {"type": "step_result", "step_id": "step_call_1", "result": {"type": "workspace_action", "action": {"type": "append_query_sql", "sql": "SELECT 1"}}},
                {"type": "tool_done"},
                {"type": "token", "content": "已"},
                {"type": "token", "content": "完成"},
                {"type": "done", "finish_reason": "stop"},
            ],
        )

    def test_openai_stream_chat_supports_mapping_tool_call_deltas(self) -> None:
        config = AIConfig(provider="openai-compatible", base_url="https://example.com/v1", api_key="test", model="demo", max_context_tokens=200_000)
        agent = DatabaseAgent(None, config)
        agent.client = FakeOpenAIClient(
            [
                [
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(
                                    tool_calls=[
                                        {
                                            "index": 0,
                                            "id": "call_mapping",
                                            "type": "function",
                                            "function": {
                                                "name": "append_query_sql",
                                                "arguments": '{"sql":"SELECT 1"}',
                                            },
                                        }
                                    ]
                                ),
                                finish_reason="tool_calls",
                            )
                        ]
                    )
                ],
                [FakeObject(choices=[FakeObject(delta=FakeObject(content="done"), finish_reason="stop")])],
            ]
        )

        tool_calls: list[tuple[str, dict[str, Any]]] = []

        def fake_call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
            tool_calls.append((name, arguments))
            return {"ok": True}

        agent.call_tool = fake_call_tool  # type: ignore[method-assign]

        events = list(agent.stream_chat([{"role": "user", "content": "use a tool"}]))

        self.assertEqual(tool_calls, [("append_query_sql", {"sql": "SELECT 1"})])
        self.assertIn(
            {"type": "tool_start", "tool_call_id": "call_mapping", "name": "append_query_sql", "arguments": {"sql": "SELECT 1"}},
            events,
        )

    def test_openai_stream_chat_sanitizes_invalid_tool_arguments_before_next_turn(self) -> None:
        config = AIConfig(provider="openai-compatible", base_url="https://example.com/v1", api_key="test", model="demo")
        agent = DatabaseAgent(None, config)
        client = FakeOpenAIClient(
            [
                [
                    FakeObject(
                        choices=[
                            FakeObject(
                                delta=FakeObject(
                                    tool_calls=[
                                        FakeObject(
                                            index=0,
                                            id="invalid_tool_call",
                                            type="function",
                                            function=FakeObject(
                                                name="create_agent_plan",
                                                arguments='{"goal":"检查表","summary":"包含未转义的 "引号""}',
                                            ),
                                        )
                                    ]
                                ),
                                finish_reason="tool_calls",
                            )
                        ]
                    )
                ],
                [FakeObject(choices=[FakeObject(delta=FakeObject(content="已改用合法参数继续处理"), finish_reason="stop")])],
            ]
        )
        agent.client = client

        events = list(agent.stream_chat([{"role": "user", "content": "检查"}]))

        self.assertIn(
            {
                "type": "tool_result",
                "tool_call_id": "invalid_tool_call",
                "name": "create_agent_plan",
                "result": {
                    "error": "工具参数不是合法 JSON，未执行该操作。请使用合法 JSON 参数重新调用工具。"
                },
            },
            events,
        )
        self.assertIn({"type": "token", "content": "已改用合法参数继续处理"}, events)
        sanitized_tool_call = next(
            message for message in client.calls[1]["messages"] if message.get("tool_calls")
        )
        self.assertEqual(sanitized_tool_call["tool_calls"][0]["function"]["arguments"], "{}")

    def test_anthropic_stream_chat_emits_incremental_reasoning_and_tokens(self) -> None:
        config = AIConfig(provider="anthropic", base_url="https://example.com", api_key="test", model="demo", max_context_tokens=200_000)
        agent = DatabaseAgent(None, config)
        agent.client = FakeAnthropicClient(
            [
                {"event": "content_block_start", "data": {"index": 0, "content_block": {"type": "thinking", "thinking": "思"}}},
                {"event": "content_block_delta", "data": {"index": 0, "delta": {"type": "thinking_delta", "thinking": "考"}}},
                {"event": "content_block_start", "data": {"index": 1, "content_block": {"type": "text", "text": "回"}}},
                {"event": "content_block_delta", "data": {"index": 1, "delta": {"type": "text_delta", "text": "答"}}},
                {"event": "message_delta", "data": {"delta": {"stop_reason": "end_turn"}}},
                {"event": "message_stop", "data": {}},
            ]
        )

        events = list(agent.stream_chat([{"role": "user", "content": "你好"}]))

        self.assertEqual(
            events,
            [
                {"type": "reasoning", "content": "思"},
                {"type": "reasoning", "content": "考"},
                {"type": "token", "content": "回"},
                {"type": "token", "content": "答"},
                {"type": "done", "finish_reason": "end_turn"},
            ],
        )


if __name__ == "__main__":
    unittest.main()
