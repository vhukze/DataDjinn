from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.connection_tree_preferences import (
    load_connection_tree_preferences,
    save_connection_tree_preferences,
)


router = APIRouter(prefix="/preferences", tags=["preferences"])


class ConnectionTreePreferencesResponse(BaseModel):
    exists: bool
    preferences: dict[str, Any] = Field(default_factory=dict)


class ConnectionTreePreferencesRequest(BaseModel):
    preferences: dict[str, Any] = Field(default_factory=dict)


@router.get("/connection-tree", response_model=ConnectionTreePreferencesResponse)
def get_connection_tree_preferences() -> ConnectionTreePreferencesResponse:
    exists, preferences = load_connection_tree_preferences()
    return ConnectionTreePreferencesResponse(exists=exists, preferences=preferences)


@router.put("/connection-tree", response_model=ConnectionTreePreferencesResponse)
def update_connection_tree_preferences(
    request: ConnectionTreePreferencesRequest,
) -> ConnectionTreePreferencesResponse:
    preferences = save_connection_tree_preferences(request.preferences)
    return ConnectionTreePreferencesResponse(exists=True, preferences=preferences)
