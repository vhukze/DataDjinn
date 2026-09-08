from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.connection_tree_preferences import (
    _preferences_path,
    load_connection_tree_preferences,
    save_connection_tree_preferences,
)


router = APIRouter(prefix="/preferences", tags=["preferences"])


class ConnectionTreePreferencesResponse(BaseModel):
    exists: bool
    preferences: dict[str, Any] = Field(default_factory=dict)
    updated_at: int | None = None


class ConnectionTreePreferencesRequest(BaseModel):
    preferences: dict[str, Any] = Field(default_factory=dict)
    updated_at: int | None = None


@router.get("/connection-tree", response_model=ConnectionTreePreferencesResponse)
def get_connection_tree_preferences() -> ConnectionTreePreferencesResponse:
    exists, preferences = load_connection_tree_preferences()
    updated_at: int | None = None
    if exists:
        try:
            updated_at = _preferences_path().stat().st_mtime_ns // 1_000_000
        except OSError:
            updated_at = None
    return ConnectionTreePreferencesResponse(
        exists=exists, preferences=preferences, updated_at=updated_at
    )


@router.put("/connection-tree", response_model=ConnectionTreePreferencesResponse)
def update_connection_tree_preferences(
    request: ConnectionTreePreferencesRequest,
) -> ConnectionTreePreferencesResponse:
    preferences = save_connection_tree_preferences(request.preferences, request.updated_at)

    try:
        updated_at = _preferences_path().stat().st_mtime_ns // 1_000_000
    except OSError:
        updated_at = None
    return ConnectionTreePreferencesResponse(
        exists=True, preferences=preferences, updated_at=updated_at
    )
