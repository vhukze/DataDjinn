import logging
import os
import json
from secrets import compare_digest

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.backup import router as backup_router
from app.api.connections import router as connections_router
from app.api.health import router as health_router
from app.api.drivers import router as drivers_router
from app.api.metadata import router as metadata_router
from app.api.query import router as query_router
from app.api.git_sync import router as git_sync_router
from app.api.git_versioning import router as git_versioning_router
from app.db.connection_manager import connection_manager
from app.request_context import normalize_query_timeout_seconds, reset_query_timeout_seconds, set_query_timeout_seconds

logger = logging.getLogger("datadjinn.api")
app = FastAPI(title="DataDjinn API", version="0.1.7")
CONNECTION_UNAVAILABLE_ERROR_CODE = "CONNECTION_UNAVAILABLE"


async def _request_connection_id(request: Request) -> str | None:
    segments = [segment for segment in request.url.path.split("/") if segment]
    if segments[:2] == ["api", "connections"] and len(segments) >= 4:
        connection_id, action = segments[2], segments[3]
        if action not in {"open", "close", "password"}:
            return connection_id

    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None

    try:
        payload = json.loads((await request.body()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None

    connection_id = payload.get("connection_id") if isinstance(payload, dict) else None
    return connection_id if isinstance(connection_id, str) and connection_id else None


def _connection_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": "数据库连接暂时不可用",
            "error_code": CONNECTION_UNAVAILABLE_ERROR_CODE,
        },
    )


@app.middleware("http")
async def protect_local_api(request: Request, call_next):
    timeout_token = set_query_timeout_seconds(
        normalize_query_timeout_seconds(request.headers.get("X-DataDjinn-Query-Timeout-Seconds"))
    )
    try:
        expected_token = os.environ.get("DATADJINN_API_TOKEN")
        if request.url.path != "/api/health" and expected_token:
            supplied_token = request.headers.get("X-DataDjinn-Api-Token", "")
            if not compare_digest(supplied_token, expected_token):
                return JSONResponse(status_code=401, content={"detail": "未授权的本地 API 请求"})

        connection_id = await _request_connection_id(request)
        if connection_id and not connection_manager.ensure_connection_healthy(connection_id):
            return _connection_unavailable_response()

        response = await call_next(request)
        if (
            connection_id
            and response.status_code >= 500
            and not connection_manager.ensure_connection_healthy(connection_id, force=True)
        ):
            return _connection_unavailable_response()
        return response
    finally:
        reset_query_timeout_seconds(timeout_token)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("未处理的后端异常：%s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": str(exc) or "Internal Server Error"})


app.include_router(health_router, prefix="/api")
app.include_router(connections_router, prefix="/api")
app.include_router(drivers_router, prefix="/api")
app.include_router(metadata_router, prefix="/api")
app.include_router(query_router, prefix="/api")
app.include_router(backup_router, prefix="/api")
app.include_router(git_sync_router, prefix="/api")
app.include_router(git_versioning_router, prefix="/api")
