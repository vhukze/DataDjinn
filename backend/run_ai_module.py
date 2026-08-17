from __future__ import annotations

import os
import sys
from secrets import compare_digest
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.ai_router import router as ai_router

BACKEND_DIR = Path(__file__).resolve().parent
VENDORED_JPYPE_PATH = BACKEND_DIR / "vendor" / "jpype15"

if VENDORED_JPYPE_PATH.exists():
    sys.path.insert(0, str(VENDORED_JPYPE_PATH))

app = FastAPI(title="DataDjinn AI Module", version="1.0.0")


@app.middleware("http")
async def protect_local_ai_api(request: Request, call_next):
    expected_token = os.environ.get("DATADJINN_API_TOKEN")
    if request.url.path != "/api/health" and expected_token:
        supplied_token = request.headers.get("X-DataDjinn-Api-Token", "")
        if not compare_digest(supplied_token, expected_token):
            return JSONResponse(status_code=401, content={"detail": "未授权的本地 AI API 请求"})
    return await call_next(request)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


app.include_router(ai_router, prefix="/api")


if __name__ == "__main__":
    port = int(os.environ.get("DATADJINN_AI_MODULE_PORT", "8010"))
    uvicorn.run(app, host="127.0.0.1", port=port)
