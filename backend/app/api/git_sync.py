import json
from typing import Any, Literal
from urllib.error import HTTPError

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.connection_manager import connection_manager
from app.git_sync.github_oauth import DeviceAuthorization, GitHubAuthStatus, GitHubSyncRepository, github_oauth_service
from app.git_sync.sync_crypto import decrypt_sync_payload, encrypt_sync_payload
from app.git_sync.sync_payload import (
    DataDjinnSyncPayload,
    SyncConflict,
    SyncMergeResult,
    merge_sync_payloads,
    resolve_sync_conflicts,
)

router = APIRouter(prefix="/git-sync", tags=["git-sync"])
SYNC_PAYLOAD_PATH = "sync/datadjinn-sync-v1.json"


class DeviceAuthorizationPollRequest(BaseModel):
    session_id: str


class DeviceAuthorizationPollResponse(BaseModel):
    status: Literal["pending", "authorized", "expired", "error"]
    interval_seconds: int | None = None
    message: str | None = None
    auth: GitHubAuthStatus | None = None


class SyncFilePullRequest(BaseModel):
    passphrase: str = Field(min_length=8)


class SyncFilePullResponse(BaseModel):
    exists: bool
    sha: str | None = None
    payload: DataDjinnSyncPayload | None = None


class SyncFileStatusResponse(BaseModel):
    repository: GitHubSyncRepository | None = None
    exists: bool
    sha: str | None = None


class SyncFilePushRequest(BaseModel):
    passphrase: str = Field(min_length=8)
    payload: DataDjinnSyncPayload
    remote_sha: str | None = None


class SyncFilePushResponse(BaseModel):
    sha: str


class LocalConnectionsSnapshot(BaseModel):
    connections: dict[str, dict[str, Any]]


class SyncMergeRequest(BaseModel):
    base: DataDjinnSyncPayload
    local: DataDjinnSyncPayload
    remote: DataDjinnSyncPayload


class SyncConflictResolutionRequest(BaseModel):
    payload: DataDjinnSyncPayload
    conflicts: list[SyncConflict]
    choices: dict[str, Literal["local", "remote"]]


@router.get("/auth/status", response_model=GitHubAuthStatus)
def get_auth_status() -> GitHubAuthStatus:
    return github_oauth_service.status()


@router.post("/auth/device", response_model=DeviceAuthorization)
def start_device_authorization() -> DeviceAuthorization:
    try:
        return github_oauth_service.start_device_authorization()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "无法连接 GitHub") from exc


@router.post("/auth/device/poll", response_model=DeviceAuthorizationPollResponse)
def poll_device_authorization(request: DeviceAuthorizationPollRequest) -> DeviceAuthorizationPollResponse:
    try:
        return DeviceAuthorizationPollResponse.model_validate(
            github_oauth_service.poll_device_authorization(request.session_id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/auth")
def sign_out() -> dict[str, bool]:
    github_oauth_service.sign_out()
    return {"success": True}


@router.post("/repository", response_model=GitHubSyncRepository)
def initialize_sync_repository() -> GitHubSyncRepository:
    try:
        return github_oauth_service.ensure_sync_repository()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "无法创建 GitHub 私有同步仓库") from exc


@router.post("/file/pull", response_model=SyncFilePullResponse)
def pull_sync_file(request: SyncFilePullRequest) -> SyncFilePullResponse:
    try:
        repository_file = github_oauth_service.read_repository_file(SYNC_PAYLOAD_PATH)
        if repository_file is None:
            return SyncFilePullResponse(exists=False)
        envelope = json.loads(repository_file.content)
        if not isinstance(envelope, dict):
            raise ValueError("远程同步文件格式无效")
        return SyncFilePullResponse(
            exists=True,
            sha=repository_file.sha,
            payload=DataDjinnSyncPayload.model_validate(
                decrypt_sync_payload(envelope, request.passphrase)
            ),
        )
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "无法读取 GitHub 同步文件") from exc


@router.get("/file/status", response_model=SyncFileStatusResponse)
def get_sync_file_status() -> SyncFileStatusResponse:
    try:
        repository = github_oauth_service.ensure_sync_repository()
        repository_file = github_oauth_service.read_repository_file(SYNC_PAYLOAD_PATH)
        return SyncFileStatusResponse(
            repository=repository,
            exists=repository_file is not None,
            sha=repository_file.sha if repository_file else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "无法检查 GitHub 同步状态") from exc


@router.put("/file", response_model=SyncFilePushResponse)
def push_sync_file(request: SyncFilePushRequest) -> SyncFilePushResponse:
    try:
        envelope = encrypt_sync_payload(
            request.payload.model_dump(mode="json"), request.passphrase
        )
        result = github_oauth_service.write_repository_file(
            SYNC_PAYLOAD_PATH,
            json.dumps(envelope, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            "同步 DataDjinn 设置与连接",
            sha=request.remote_sha,
        )
        return SyncFilePushResponse(sha=result.sha)
    except HTTPError as exc:
        if exc.code in {409, 422}:
            raise HTTPException(
                status_code=409,
                detail="远程同步内容已发生变化，请重新拉取并处理冲突",
            ) from exc
        raise HTTPException(status_code=502, detail=str(exc) or "无法写入 GitHub 同步文件") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "无法写入 GitHub 同步文件") from exc


@router.get("/local/connections", response_model=LocalConnectionsSnapshot)
def export_local_connections() -> LocalConnectionsSnapshot:
    return LocalConnectionsSnapshot(connections=connection_manager.export_sync_connections())


@router.put("/local/connections")
def replace_local_connections(request: LocalConnectionsSnapshot) -> dict[str, int]:
    try:
        connections = connection_manager.replace_sync_connections(request.connections)
        return {"connection_count": len(connections)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/merge", response_model=SyncMergeResult)
def merge_sync_files(request: SyncMergeRequest) -> SyncMergeResult:
    return merge_sync_payloads(request.base, request.local, request.remote)


@router.post("/merge/resolve", response_model=DataDjinnSyncPayload)
def resolve_sync_file_conflicts(request: SyncConflictResolutionRequest) -> DataDjinnSyncPayload:
    try:
        return resolve_sync_conflicts(request.payload, request.conflicts, request.choices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
