import logging
import os
from secrets import compare_digest

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.backup import router as backup_router
from app.api.connections import router as connections_router
from app.api.health import router as health_router
from app.api.drivers import router as drivers_router
from app.api.ai_router import router as ai_router
from app.api.metadata import router as metadata_router
from app.api.query import router as query_router
from app.request_context import normalize_query_timeout_seconds, reset_query_timeout_seconds, set_query_timeout_seconds

logger = logging.getLogger("datadjinn.api")
app = FastAPI(title="DataDjinn API", version="0.1.7")


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
        return await call_next(request)
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
app.include_router(ai_router, prefix="/api")
