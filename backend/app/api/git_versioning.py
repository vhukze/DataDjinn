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
from app.git_versioning.database_history import (
    DatabaseSnapshotResult,
    DatabaseSnapshotTask,
    database_versioning_service,
    task_to_model,
)
from app.git_versioning.task_progress import git_task_registry
from app.git_sync.github_oauth import github_oauth_service

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


class RestoreTableVersionRequest(BaseModel):
    confirm: bool = False


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


@router.post("/connections/{connection_id}/database-snapshots", response_model=DatabaseSnapshotResult, status_code=status.HTTP_202_ACCEPTED)
def create_database_snapshot(connection_id: str, request: CreateSchemaSnapshotRequest) -> DatabaseSnapshotResult:
    try:
        return database_versioning_service.create_snapshot_async(connection_id, request.reason)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/tasks/{task_id}", response_model=DatabaseSnapshotTask)
def get_git_task(task_id: str) -> DatabaseSnapshotTask:
    task = git_task_registry.get(task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Git 后台任务不存在")
    return task_to_model(task)


@router.post("/tasks/{task_id}/cancel", response_model=DatabaseSnapshotTask)
def cancel_git_task(task_id: str) -> DatabaseSnapshotTask:
    task = git_task_registry.cancel(task_id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Git 后台任务不存在")
    return task_to_model(task)


@router.get("/connections/{connection_id}/tasks", response_model=list[DatabaseSnapshotTask])
def list_git_tasks(connection_id: str) -> list[DatabaseSnapshotTask]:
    return [task_to_model(task) for task in git_task_registry.list(connection_id)]


@router.get("/connections/{connection_id}/tables/{table_name}/versions")
def list_table_git_versions(connection_id: str, table_name: str, scope: str | None = None, limit: int = 30) -> list[dict[str, Any]]:
    try:
        return database_versioning_service.list_table_versions(connection_id, scope, table_name, limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/tables/{table_name}/versions/{version_id}")
def get_table_git_version(connection_id: str, table_name: str, version_id: str, scope: str | None = None) -> Any:
    try:
        return database_versioning_service.get_table_snapshot(connection_id, scope, table_name, version_id).model_dump()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/tables/{table_name}/versions/{version_id}/details")
def get_table_git_version_details(connection_id: str, table_name: str, version_id: str, scope: str | None = None) -> Any:
    try:
        return database_versioning_service.get_table_version_details(connection_id, scope, table_name, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/tables/{table_name}/versions/{version_id}/diff")
def diff_table_git_version(connection_id: str, table_name: str, version_id: str, scope: str | None = None) -> Any:
    try:
        return database_versioning_service.diff_table_version(connection_id, scope, table_name, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.post("/connections/{connection_id}/tables/{table_name}/versions/{version_id}/restore")
def restore_table_git_version(
    connection_id: str,
    table_name: str,
    version_id: str,
    request: RestoreTableVersionRequest,
    scope: str | None = None,
) -> Any:
    try:
        if not request.confirm:
            raise ValueError("恢复历史数据前必须明确确认 confirm=true")
        return database_versioning_service.restore_table_version(connection_id, scope, table_name, version_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.post("/connections/{connection_id}/tables/{table_name}/versions/{version_id}/structure-restore")
def restore_table_structure(
    connection_id: str,
    table_name: str,
    version_id: str,
    request: RestoreTableVersionRequest,
    scope: str | None = None,
) -> Any:
    try:
        if not request.confirm:
            raise ValueError("恢复历史结构前必须明确确认 confirm=true")
        return database_versioning_service.restore_table_structure(connection_id, scope, table_name, version_id)
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


@router.get("/connections/{connection_id}/database-versions", response_model=list[SchemaVersionInfo])
def list_database_versions(connection_id: str, limit: int = 30) -> list[SchemaVersionInfo]:
    """返回库级数据库快照提交，作为新 Git 表数据管理流程的唯一基线来源。"""
    try:
        return [
            SchemaVersionInfo(id=item["id"], message=item["message"], committed_at=item.get("committed_at"))
            for item in database_versioning_service.list_versions(connection_id, limit)
        ]
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=friendly_error(exc)) from exc


@router.get("/connections/{connection_id}/database-baseline")
def get_database_baseline(connection_id: str) -> dict[str, bool]:
    """检查数据库快照 manifest 是否存在，避免把提交列表短暂为空误判为未建立基线。"""
    try:
        database_versioning_service._ensure_enabled(connection_id)
        return {
            "exists": github_oauth_service.read_repository_file(
                database_versioning_service.manifest_path(connection_id)
            )
            is not None
        }
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
