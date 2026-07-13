import unittest
from typing import Any

from app.ai.agent import AIConfig, DatabaseAgent, build_system_prompt


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
    def test_system_prompt_includes_product_knowledge_for_global_help(self) -> None:
        prompt = build_system_prompt("none", "未选择上下文")

        self.assertIn("内置产品知识库", prompt)
        self.assertIn("修改入口：点击应用右上角“设置”，在左侧选择“快捷键”", prompt)
        self.assertIn("导出连接", prompt)
        self.assertIn("软件功能和用法问题", prompt)

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
