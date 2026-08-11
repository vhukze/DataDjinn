import unittest
from typing import Any
from unittest.mock import patch

from app.ai.agent import AIConfig, DatabaseAgent, build_system_prompt
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
        self.chat = FakeObject(completions=FakeObject(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
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
        self.assertIn("修改入口：点击应用右上角“设置”，在左侧选择“快捷键”", prompt)
        self.assertIn("右键该连接并选择“停止连接”", prompt)
        self.assertIn("整次测试最多等待 10 秒", prompt)
        self.assertIn("搜索框显示“当前项/总数”", prompt)
        self.assertIn("先显示表名", prompt)
        self.assertIn("后台计算并回填大小", prompt)
        self.assertIn("只有一个数据列", prompt)
        self.assertIn("自动填满行号右侧的可用空间", prompt)
        self.assertIn("未进入编辑时按 Delete 会批量清空选区", prompt)
        self.assertIn("导出连接", prompt)
        self.assertIn("保存前可在连接弹框选择已有分组，也可直接新建分组", prompt)
        self.assertIn("所有分组固定显示在所有根连接之前", prompt)
        self.assertIn("分组不显示展开按钮，只能双击展开或收起", prompt)
        self.assertIn("达梦表结构编辑支持修改表名、字段名、字段类型和空值约束，也支持修改表注释和字段注释", prompt)
        self.assertIn("根连接和分组的右键菜单均可置顶或取消置顶", prompt)
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
        self.assertIn("DDL 会自动保证末尾带分号", prompt)
        self.assertIn("软件功能和用法问题", prompt)
        self.assertIn("PostgreSQL 和高斯数据库的 SQL 必须在当前 pg_database 内执行", prompt)
        self.assertIn("写操作会显示确认按钮，未确认前不会执行，并会继承当前选中的连接、数据库和模式", prompt)

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
