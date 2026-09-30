from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.connection_tree_preferences import (
    get_connection_tree_preferences_updated_at,
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
    updated_at = get_connection_tree_preferences_updated_at() if exists else None
    return ConnectionTreePreferencesResponse(
        exists=exists, preferences=preferences, updated_at=updated_at
    )


@router.put("/connection-tree", response_model=ConnectionTreePreferencesResponse)
def update_connection_tree_preferences(
    request: ConnectionTreePreferencesRequest,
) -> ConnectionTreePreferencesResponse:
    preferences = save_connection_tree_preferences(request.preferences, request.updated_at)
    updated_at = get_connection_tree_preferences_updated_at()
    return ConnectionTreePreferencesResponse(
        exists=True, preferences=preferences, updated_at=updated_at
    )
