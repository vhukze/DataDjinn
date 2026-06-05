import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openai import OpenAI

from app.ai.agent import AIChatRequest, AICompactRequest, AICompactResponse, AIConfig, AIMessage, AIPingRequest, AIPingResponse, AgentConfirmRequest, AnthropicMessagesClient, DatabaseAgent, PENDING_CONFIRMATIONS, build_system_prompt, sql_hash
from app.db.backup_manager import backup_manager
from app.db.connection_manager import connection_manager
from app.db.error_utils import friendly_error

router = APIRouter(prefix="/ai", tags=["ai"])


def _ensure_open_engine(connection_id: str):
    engine = connection_manager.get_engine(connection_id)
    if engine is not None:
        return engine
    connection_manager.open_connection(connection_id)
    return connection_manager.get_engine(connection_id)


def _agent_for_request(request: AIChatRequest) -> DatabaseAgent:
    if not request.connection_id:
        return DatabaseAgent(None, request.config, workspace=request.workspace)

    engine = _ensure_open_engine(request.connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return DatabaseAgent(engine, request.config, request.connection_id, request.database, request.pg_database, request.workspace)


def _messages_with_system(request: AIChatRequest) -> list[dict[str, Any]]:
    connection = connection_manager._connections.get(request.connection_id) if request.connection_id else None
    db_type = connection.database_type if connection else "none"
    db_name = request.pg_database or request.database or (connection.database if connection else "未选择上下文")
    messages = [AIMessage(role="system", content=build_system_prompt(db_type, db_name, request.workspace)).model_dump(exclude_none=True)]
    messages.extend(message.model_dump(exclude_none=True) for message in request.messages if message.role != "system")
    return messages


@router.post("/chat")
def chat(request: AIChatRequest) -> dict[str, Any]:
    try:
        return _agent_for_request(request).chat(_messages_with_system(request))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/chat/stream")
def stream_chat(request: AIChatRequest) -> StreamingResponse:
    def events() -> Iterator[str]:
        try:
            agent = _agent_for_request(request)
            for event in agent.stream_chat(_messages_with_system(request)):
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': friendly_error(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


@router.post("/compact", response_model=AICompactResponse)
def compact_context(request: AICompactRequest) -> AICompactResponse:
    try:
        workspace_context = json.dumps(request.workspace.model_dump(exclude_none=True) if request.workspace else {}, ensure_ascii=False, default=str)
        history = "\n".join(
            f"{message.role}: {message.content or ''}"
            for message in request.messages
            if message.role in {"user", "assistant"} and message.content
        )
        compact_messages = [
            {
                "role": "system",
                "content": "你是 DataDjinn 的上下文压缩器。请把历史对话压缩成可用于新会话延续工作的中文摘要，保留用户目标、重要决策、数据库上下文、已执行结果、待办事项、未解决问题和必要约束。不要编造信息。",
            },
            {
                "role": "user",
                "content": f"工作区上下文：\n{workspace_context}\n\n需要压缩的历史对话：\n{history}",
            },
        ]

        if request.config.provider == "anthropic":
            response = AnthropicMessagesClient(request.config).create(compact_messages, tools=False, temperature=0.2)
            summary = "".join(block.get("text", "") for block in response.get("content", []) if block.get("type") == "text") or "当前会话暂无可压缩摘要。"
            return AICompactResponse(summary=summary)

        client = OpenAI(base_url=request.config.base_url, api_key=request.config.api_key)
        response = client.chat.completions.create(
            model=request.config.model,
            messages=compact_messages,
            temperature=0.2,
        )
        summary = response.choices[0].message.content or "当前会话暂无可压缩摘要。"
        return AICompactResponse(summary=summary)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/confirm")
def confirm_agent_action(request: AgentConfirmRequest) -> dict[str, Any]:
    pending = PENDING_CONFIRMATIONS.get(request.confirmation_id)
    if pending is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="确认请求不存在或已过期")

    if not request.approved:
        PENDING_CONFIRMATIONS.pop(request.confirmation_id, None)
        return {"approved": False, "message": "已取消执行"}

    if pending.connection_id != request.connection_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="确认请求与当前连接不匹配")

    engine = _ensure_open_engine(request.connection_id)
    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        if pending.action == "restore_backup":
            if not pending.backup_id:
                raise ValueError("恢复备份确认内容缺少备份 ID")
            result = backup_manager.restore_backup(pending.backup_id)
            PENDING_CONFIRMATIONS.pop(request.confirmation_id, None)
            return {"approved": True, "message": "恢复完成", "executed": True, "action": "restore_backup", "backup": result.model_dump(mode="json")}

        if not pending.sql or not pending.sql_hash:
            raise ValueError("确认内容缺少 SQL")
        agent = DatabaseAgent(engine, AIConfig(base_url="http://localhost", api_key="confirm", model="confirm"), request.connection_id, request.database or pending.database, request.pg_database or pending.pg_database)
        validation = agent._validate_sql(pending.sql, readonly=False)
        if validation["risk_level"] != pending.risk_level or sql_hash(pending.sql) != pending.sql_hash:
            raise ValueError("确认内容与待执行 SQL 不一致")
        result = agent._execute_query(pending.sql, readonly=False)
        PENDING_CONFIRMATIONS.pop(request.confirmation_id, None)
        return {"approved": True, "message": "执行完成", "executed": True, "sql": pending.sql, "result": result.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.get("/ping", response_model=AIPingResponse)
def ping_get(
    base_url: str = Query(min_length=1),
    api_key: str = Query(min_length=1),
    model: str = Query(min_length=1),
) -> AIPingResponse:
    return _ping(AIPingRequest(config={"base_url": base_url, "api_key": api_key, "model": model}))


@router.post("/ping", response_model=AIPingResponse)
def ping_post(request: AIPingRequest) -> AIPingResponse:
    return _ping(request)


def _ping(request: AIPingRequest) -> AIPingResponse:
    try:
        if request.config.provider == "anthropic":
            response = AnthropicMessagesClient(request.config).create([{"role": "user", "content": "ping"}], tools=False, max_tokens=8)
            content = "".join(block.get("text", "") for block in response.get("content", []) if block.get("type") == "text") or "配置可用"
            return AIPingResponse(success=True, message=content)

        client = OpenAI(base_url=request.config.base_url, api_key=request.config.api_key)
        response = client.chat.completions.create(
            model=request.config.model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=8,
        )
        content = response.choices[0].message.content or "配置可用"
        return AIPingResponse(success=True, message=content)
    except Exception as exc:
        return AIPingResponse(success=False, message=friendly_error(exc))
