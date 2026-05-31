import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.backup import router as backup_router
from app.api.connections import router as connections_router
from app.api.health import router as health_router
from app.api.drivers import router as drivers_router
from app.api.ai_router import router as ai_router
from app.api.metadata import router as metadata_router
from app.api.query import router as query_router

logger = logging.getLogger("datadjinn.api")
app = FastAPI(title="DataDjinn API", version="0.1.5")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("未处理的后端异常：%s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": str(exc) or "Internal Server Error"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(connections_router, prefix="/api")
app.include_router(drivers_router, prefix="/api")
app.include_router(metadata_router, prefix="/api")
app.include_router(query_router, prefix="/api")
app.include_router(backup_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
