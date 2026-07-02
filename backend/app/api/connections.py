import logging

from fastapi import APIRouter, HTTPException, status

from app.db.connection_manager import connection_manager
from app.db.error_utils import friendly_error
from app.schemas.connection import (
    ConnectionCreateResponse,
    ConnectionListResponse,
    ConnectionPasswordResponse,
    ConnectionRequest,
    ConnectionTestResponse,
)

router = APIRouter(prefix="/connections", tags=["connections"])
logger = logging.getLogger("datadjinn.connections")


@router.post("/test", response_model=ConnectionTestResponse)
def test_connection(request: ConnectionRequest) -> ConnectionTestResponse:
    try:
        connection_manager.test_connection(request)
    except Exception as exc:
        logger.exception(
            "测试连接失败：type=%s host=%s port=%s database=%s username=%s password_len=%s",
            request.database_type,
            request.host,
            request.port,
            request.database,
            request.username,
            len(request.password or ""),
        )
        return ConnectionTestResponse(success=False, message=friendly_error(exc))

    return ConnectionTestResponse(success=True, message="连接成功")


@router.post("/test-ssh", response_model=ConnectionTestResponse)
def test_ssh_tunnel(request: ConnectionRequest) -> ConnectionTestResponse:
    try:
        connection_manager.test_ssh_tunnel(request)
    except Exception as exc:
        logger.exception(
            "测试 SSH 隧道失败：type=%s host=%s port=%s ssh_host=%s ssh_port=%s ssh_username=%s",
            request.database_type,
            request.host,
            request.port,
            request.ssh_host,
            request.ssh_port,
            request.ssh_username,
        )
        return ConnectionTestResponse(success=False, message=friendly_error(exc))

    return ConnectionTestResponse(success=True, message="SSH 隧道连接成功")


@router.post("", response_model=ConnectionCreateResponse)
def create_connection(request: ConnectionRequest) -> ConnectionCreateResponse:
    try:
        return connection_manager.create_connection(request)
    except Exception as exc:
        logger.exception(
            "创建连接失败：type=%s host=%s port=%s database=%s username=%s password_len=%s",
            request.database_type,
            request.host,
            request.port,
            request.database,
            request.username,
            len(request.password or ""),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.get("", response_model=ConnectionListResponse)
def list_connections() -> ConnectionListResponse:
    return ConnectionListResponse(connections=connection_manager.list_connections())


@router.get("/{connection_id}", response_model=ConnectionRequest)
def get_connection(connection_id: str) -> ConnectionRequest:
    try:
        return connection_manager.get_connection_request(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=friendly_error(exc)) from exc


@router.put("/{connection_id}", response_model=ConnectionCreateResponse)
def update_connection(connection_id: str, request: ConnectionRequest) -> ConnectionCreateResponse:
    try:
        return connection_manager.update_connection(connection_id, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=friendly_error(exc)) from exc
    except Exception as exc:
        logger.exception("更新连接失败：id=%s type=%s host=%s port=%s database=%s", connection_id, request.database_type, request.host, request.port, request.database)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.get("/{connection_id}/password", response_model=ConnectionPasswordResponse)
def get_connection_password(connection_id: str) -> ConnectionPasswordResponse:
    try:
        return ConnectionPasswordResponse(password=connection_manager.get_password(connection_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=friendly_error(exc)) from exc


@router.post("/{connection_id}/open", response_model=ConnectionCreateResponse)
def open_connection(connection_id: str) -> ConnectionCreateResponse:
    try:
        return connection_manager.open_connection(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=friendly_error(exc)) from exc
    except Exception as exc:
        logger.exception("打开连接失败：id=%s", connection_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc) or str(exc)) from exc


@router.post("/{connection_id}/close", response_model=ConnectionCreateResponse)
def close_connection(connection_id: str) -> ConnectionCreateResponse:
    try:
        return connection_manager.close_connection(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=friendly_error(exc)) from exc


@router.delete("/{connection_id}")
def delete_connection_endpoint(connection_id: str) -> dict[str, bool]:
    deleted = connection_manager.delete_connection(connection_id)

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接不存在")

    return {"success": True}
