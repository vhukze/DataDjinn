from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.connections import router as connections_router
from app.api.health import router as health_router
from app.api.ai_router import router as ai_router
from app.api.metadata import router as metadata_router
from app.api.query import router as query_router

app = FastAPI(title="DataDjinn API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(connections_router, prefix="/api")
app.include_router(metadata_router, prefix="/api")
app.include_router(query_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
