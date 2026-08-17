from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.db.error_utils import friendly_error
from typing import Any

from app.data_versioning_runtime import get_data_versioning_service
from app.git_versioning.schema_history import (
    SchemaSnapshot,
    SchemaSnapshotResult,
    SchemaVersionInfo,
    VersioningScopeConfig,
    schema_versioning_service,
)

router = APIRouter(prefix="/git-versioning", tags=["git-versioning"])


class CreateSchemaSnapshotRequest(BaseModel):
    reason: str = Field(default="手动创建结构快照", max_length=120)


class CreateDataSnapshotRequest(BaseModel):
    table_name: str = Field(min_length=1, max_length=256)
    database: str | None = Field(default=None, max_length=256)
    pg_database: str | None = Field(default=None, max_length=256)
    reason: str = Field(default="手动创建数据快照", max_length=120)


class UpdateVersioningScopesRequest(BaseModel):
    selected_scopes: list[str] = Field(default_factory=list, max_length=200)


@router.get("/connections/{connection_id}/scopes", response_model=VersioningScopeConfig)
def get_versioning_scopes(connection_id: str) -> VersioningScopeConfig:
    try:
        return schema_versioning_service.get_scope_config(connection_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.put("/connections/{connection_id}/scopes", response_model=VersioningScopeConfig)
def update_versioning_scopes(
    connection_id: str, request: UpdateVersioningScopesRequest
) -> VersioningScopeConfig:
    try:
        return schema_versioning_service.update_scope_config(connection_id, request.selected_scopes)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.post("/connections/{connection_id}/snapshots", response_model=SchemaSnapshotResult)
def create_schema_snapshot(connection_id: str, request: CreateSchemaSnapshotRequest) -> SchemaSnapshotResult:
    try:
        return schema_versioning_service.create_snapshot(connection_id, request.reason)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/versions", response_model=list[SchemaVersionInfo])
def list_schema_versions(connection_id: str, limit: int = 30) -> list[SchemaVersionInfo]:
    try:
        return schema_versioning_service.list_versions(connection_id, limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/versions/{version_id}", response_model=SchemaSnapshot)
def get_schema_version(connection_id: str, version_id: str) -> SchemaSnapshot:
    try:
        return schema_versioning_service.get_version(connection_id, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.post("/connections/{connection_id}/data-snapshots")
def create_data_snapshot(connection_id: str, request: CreateDataSnapshotRequest) -> Any:
    try:
        return get_data_versioning_service().create_snapshot(
            connection_id,
            request.table_name,
            request.database,
            request.pg_database,
            request.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/data-snapshots/versions")
def list_data_versions(
    connection_id: str,
    table_name: str,
    database: str | None = None,
    pg_database: str | None = None,
    limit: int = 30,
) -> list[Any]:
    try:
        return get_data_versioning_service().list_versions(
            connection_id,
            table_name,
            database,
            pg_database,
            limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get(
    "/connections/{connection_id}/data-snapshots/versions/{version_id}",
)
def get_data_version(
    connection_id: str,
    version_id: str,
    table_name: str,
    database: str | None = None,
    pg_database: str | None = None,
) -> Any:
    try:
        return get_data_versioning_service().get_version(
            connection_id,
            table_name,
            version_id,
            database,
            pg_database,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get(
    "/connections/{connection_id}/data-snapshots/versions/{version_id}/diff",
)
def diff_data_version(
    connection_id: str,
    version_id: str,
    table_name: str,
    database: str | None = None,
    pg_database: str | None = None,
) -> Any:
    try:
        return get_data_versioning_service().diff_version(
            connection_id,
            table_name,
            version_id,
            database,
            pg_database,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc
