from __future__ import annotations

import base64
import binascii
import json
import os
import time
from threading import Lock
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from pydantic import BaseModel

from app.db.connection_manager import _decrypt_password, _encrypt_password

GITHUB_OAUTH_CLIENT_ID = os.environ.get("DATADJINN_GITHUB_OAUTH_CLIENT_ID", "Ov23liCscMaFNi1QbeLY")
GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_API_URL = "https://api.github.com"
SYNC_POINTER_DESCRIPTION = "DataDjinn private sync pointer"
SYNC_POINTER_FILE = "datadjinn-sync.json"
GITHUB_REQUEST_ATTEMPTS = 3
GITHUB_REQUEST_RETRY_DELAY_SECONDS = 0.35
_repository_write_lock = Lock()


def _data_dir() -> Path:
    configured_dir = os.environ.get("DATADJINN_DATA_DIR")
    if configured_dir:
        return Path(configured_dir).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "data"


class DeviceAuthorization(BaseModel):
    session_id: str
    device_code: str
    verification_uri: str
    verification_uri_complete: str | None = None
    user_code: str
    expires_at: float
    interval_seconds: int


class GitHubAuthStatus(BaseModel):
    authorized: bool
    login: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    repository_full_name: str | None = None
    repository_url: str | None = None


class GitHubSyncRepository(BaseModel):
    full_name: str
    html_url: str


class GitHubRepositoryFile(BaseModel):
    path: str
    sha: str
    content: str


class GitHubRepositoryWriteResult(BaseModel):
    path: str
    sha: str


class GitHubRepositoryBatchWriteResult(BaseModel):
    commit_sha: str
    paths: list[str]


class GitHubRepositoryCommit(BaseModel):
    sha: str
    message: str
    committed_at: str | None = None


class GitHubOAuthService:
    def __init__(self) -> None:
        self._pending_authorizations: dict[str, DeviceAuthorization] = {}

    @property
    def _store_path(self) -> Path:
        return _data_dir() / "github-sync.json"

    def status(self) -> GitHubAuthStatus:
        stored = self._read_store()
        token = self._decrypt_token(stored.get("encrypted_access_token"))
        if not token:
            return GitHubAuthStatus(authorized=False)
        return GitHubAuthStatus(
            authorized=True,
            login=self._string_or_none(stored.get("login")),
            name=self._string_or_none(stored.get("name")),
            avatar_url=self._string_or_none(stored.get("avatar_url")),
            repository_full_name=self._string_or_none(stored.get("repository_full_name")),
            repository_url=self._string_or_none(stored.get("repository_url")),
        )

    def ensure_sync_repository(self) -> GitHubSyncRepository:
        token = self._access_token()
        stored = self._read_store()
        existing_name = self._string_or_none(stored.get("repository_full_name"))
        if existing_name:
            try:
                repository = self._github_request("GET", f"/repos/{existing_name}", token)
                return self._remember_repository(repository)
            except HTTPError:
                pass

        for gist in self._github_request("GET", "/gists?per_page=100", token):
            if not isinstance(gist, dict) or gist.get("description") != SYNC_POINTER_DESCRIPTION:
                continue
            gist_id = self._string_or_none(gist.get("id"))
            if not gist_id:
                continue
            try:
                pointer = self._github_request("GET", f"/gists/{gist_id}", token)
            except HTTPError:
                continue
            content = ((pointer.get("files") or {}).get(SYNC_POINTER_FILE) or {}).get("content")
            try:
                repository_name = json.loads(content).get("repository") if isinstance(content, str) else None
            except json.JSONDecodeError:
                repository_name = None
            if isinstance(repository_name, str) and repository_name:
                try:
                    return self._remember_repository(self._github_request("GET", f"/repos/{repository_name}", token))
                except HTTPError:
                    continue

        repository = self._github_request(
            "POST",
            "/user/repos",
            token,
            {"name": f"datadjinn-sync-{uuid4().hex[:8]}", "private": True, "auto_init": True},
        )
        result = self._remember_repository(repository)
        self._github_request(
            "POST",
            "/gists",
            token,
            {
                "description": SYNC_POINTER_DESCRIPTION,
                "public": False,
                "files": {SYNC_POINTER_FILE: {"content": json.dumps({"repository": result.full_name})}},
            },
        )
        return result

    def read_repository_file(self, path: str, *, ref: str | None = None) -> GitHubRepositoryFile | None:
        try:
            repository_file = self._read_repository_file_content(path, ref=ref)
            if repository_file is None:
                return None
            normalized_path, sha, content_bytes = repository_file
            content = content_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("GitHub 同步文件不是有效的 UTF-8 内容") from exc
        return GitHubRepositoryFile(
            path=normalized_path,
            sha=sha,
            content=content,
        )

    def read_repository_file_bytes(self, path: str, *, ref: str | None = None) -> bytes | None:
        """读取 GitHub Contents API 文件原始字节，支持 gzip 等二进制快照。"""
        repository_file = self._read_repository_file_content(path, ref=ref)
        return repository_file[2] if repository_file is not None else None

    def _read_repository_file_content(
        self, path: str, *, ref: str | None = None
    ) -> tuple[str, str, bytes] | None:
        """读取仓库文件；超过 Contents API 内嵌内容阈值时改用 Git Blob API。"""
        normalized_path = self._normalize_repository_path(path)
        repository = self.ensure_sync_repository()
        token = self._access_token()
        query = f"?ref={quote(ref, safe='')}" if ref else ""
        try:
            payload = self._github_request(
                "GET",
                f"/repos/{repository.full_name}/contents/{quote(normalized_path, safe='/')}{query}",
                token,
            )
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise
        sha = self._required_string(payload, "sha")
        encoded_content = payload.get("content") if isinstance(payload, dict) else None
        if not isinstance(encoded_content, str):
            payload = self._github_request(
                "GET", f"/repos/{repository.full_name}/git/blobs/{sha}", token
            )
            encoded_content = self._required_string(payload, "content")
        try:
            return normalized_path, sha, base64.b64decode(encoded_content.replace("\n", ""), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("GitHub 同步文件不是有效的 Base64 内容") from exc

    def write_repository_files(
        self,
        files: dict[str, bytes | str],
        message: str,
    ) -> GitHubRepositoryBatchWriteResult:
        """通过 Git Data API 一次提交多个文件，避免 Contents API 为每张表生成独立提交。"""
        normalized_message = message.strip()
        if not normalized_message:
            raise ValueError("GitHub 同步提交说明不能为空")
        if not files:
            raise ValueError("GitHub 同步提交至少需要一个文件")

        with _repository_write_lock:
            for attempt in range(3):
                try:
                    return self._write_repository_files_once(files, normalized_message)
                except HTTPError as exc:
                    if exc.code != 422:
                        raise
                    if attempt >= 2:
                        raise ValueError("远端仓库刚刚发生了更新，自动重试后仍未成功，请稍后重试") from exc
                    time.sleep(GITHUB_REQUEST_RETRY_DELAY_SECONDS * (attempt + 1))
        raise RuntimeError("GitHub 同步提交失败")

    def _write_repository_files_once(
        self, files: dict[str, bytes | str], normalized_message: str
    ) -> GitHubRepositoryBatchWriteResult:
        repository = self.ensure_sync_repository()
        token = self._access_token()
        repository_info = self._github_request("GET", f"/repos/{repository.full_name}", token)
        branch = self._required_string(repository_info, "default_branch")
        ref_payload = self._github_request(
            "GET", f"/repos/{repository.full_name}/git/ref/heads/{quote(branch, safe='')}", token
        )
        current_commit_sha = self._required_string(self._required_dict(ref_payload, "object"), "sha")
        commit_payload = self._github_request(
            "GET", f"/repos/{repository.full_name}/git/commits/{current_commit_sha}", token
        )
        base_tree_sha = self._required_string(self._required_dict(commit_payload, "tree"), "sha")
        tree_items: list[dict[str, str]] = []
        for path, content in files.items():
            normalized_path = self._normalize_repository_path(path)
            raw = content.encode("utf-8") if isinstance(content, str) else bytes(content)
            blob = self._github_request(
                "POST", f"/repos/{repository.full_name}/git/blobs", token,
                {"encoding": "base64", "content": base64.b64encode(raw).decode("ascii")},
            )
            tree_items.append({"path": normalized_path, "mode": "100644", "type": "blob", "sha": self._required_string(blob, "sha")})
        tree = self._github_request(
            "POST", f"/repos/{repository.full_name}/git/trees", token,
            {"base_tree": base_tree_sha, "tree": tree_items},
        )
        tree_sha = self._required_string(tree, "sha")
        commit = self._github_request(
            "POST", f"/repos/{repository.full_name}/git/commits", token,
            {"message": normalized_message, "tree": tree_sha, "parents": [current_commit_sha]},
        )
        commit_sha = self._required_string(commit, "sha")
        self._github_request(
            "PATCH", f"/repos/{repository.full_name}/git/refs/heads/{quote(branch, safe='')}", token,
            {"sha": commit_sha, "force": False},
        )
        return GitHubRepositoryBatchWriteResult(commit_sha=commit_sha, paths=[self._normalize_repository_path(path) for path in files])

    def list_repository_commits(self, path: str, *, per_page: int = 30) -> list[GitHubRepositoryCommit]:
        normalized_path = self._normalize_repository_path(path)
        repository = self.ensure_sync_repository()
        limit = min(max(per_page, 1), 100)
        payload = self._github_request(
            "GET",
            f"/repos/{repository.full_name}/commits?path={quote(normalized_path, safe='/')}&per_page={limit}",
            self._access_token(),
        )
        if not isinstance(payload, list):
            raise ValueError("GitHub 未返回有效的版本提交记录")

        commits: list[GitHubRepositoryCommit] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            commit = item.get("commit")
            if not isinstance(commit, dict):
                continue
            committer = commit.get("committer")
            committed_at = committer.get("date") if isinstance(committer, dict) else None
            commits.append(
                GitHubRepositoryCommit(
                    sha=self._required_string(item, "sha"),
                    message=self._required_string(commit, "message"),
                    committed_at=self._string_or_none(committed_at),
                )
            )
        return commits

    def write_repository_file(
        self,
        path: str,
        content: str,
        message: str,
        *,
        sha: str | None = None,
    ) -> GitHubRepositoryWriteResult:
        normalized_path = self._normalize_repository_path(path)
        normalized_message = message.strip()
        if not normalized_message:
            raise ValueError("GitHub 同步提交说明不能为空")
        repository = self.ensure_sync_repository()
        request_payload = {
            "message": normalized_message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        }
        if sha:
            request_payload["sha"] = sha
        response = self._github_request(
            "PUT",
            f"/repos/{repository.full_name}/contents/{quote(normalized_path, safe='/')}",
            self._access_token(),
            request_payload,
        )
        response_content = response.get("content") if isinstance(response, dict) else None
        if not isinstance(response_content, dict):
            raise ValueError("GitHub 未返回同步文件信息")
        return GitHubRepositoryWriteResult(
            path=normalized_path,
            sha=self._required_string(response_content, "sha"),
        )

    def start_device_authorization(self) -> DeviceAuthorization:
        payload = self._post_form(
            GITHUB_DEVICE_CODE_URL,
            {"client_id": GITHUB_OAUTH_CLIENT_ID, "scope": "repo gist"},
        )
        expires_in = self._positive_int(payload.get("expires_in"), 900)
        authorization = DeviceAuthorization(
            session_id=uuid4().hex,
            device_code=self._required_string(payload, "device_code"),
            verification_uri=self._required_string(payload, "verification_uri"),
            verification_uri_complete=self._string_or_none(payload.get("verification_uri_complete")),
            user_code=self._required_string(payload, "user_code"),
            expires_at=time.time() + expires_in,
            interval_seconds=self._positive_int(payload.get("interval"), 5),
        )
        self._pending_authorizations[authorization.session_id] = authorization
        return authorization

    def poll_device_authorization(self, session_id: str) -> dict[str, Any]:
        authorization = self._pending_authorizations.get(session_id)
        if authorization is None:
            raise ValueError("授权会话不存在或已结束，请重新登录 GitHub")
        if time.time() >= authorization.expires_at:
            self._pending_authorizations.pop(session_id, None)
            return {"status": "expired", "message": "授权码已过期，请重新登录 GitHub"}

        try:
            payload = self._post_form(
                GITHUB_ACCESS_TOKEN_URL,
                {
                    "client_id": GITHUB_OAUTH_CLIENT_ID,
                    "device_code": authorization.device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
            )
        except HTTPError as exc:
            payload = self._read_http_error(exc)
            return self._handle_device_token_response(authorization, session_id, payload)

        token_response = self._handle_device_token_response(authorization, session_id, payload)
        if token_response is not None:
            return token_response

        access_token = self._required_string(payload, "access_token")
        user = self._get_user(access_token)
        self._save_token(access_token, user)
        self._pending_authorizations.pop(session_id, None)
        return {"status": "authorized", "auth": self.status().model_dump()}

    def _handle_device_token_response(
        self,
        authorization: DeviceAuthorization,
        session_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        error_code = self._string_or_none(payload.get("error"))
        if not error_code:
            return None
        if error_code == "authorization_pending":
            return {"status": "pending", "interval_seconds": authorization.interval_seconds}
        if error_code == "slow_down":
            authorization.interval_seconds += 5
            return {"status": "pending", "interval_seconds": authorization.interval_seconds}

        self._pending_authorizations.pop(session_id, None)
        return {
            "status": "error",
            "message": self._string_or_none(payload.get("error_description"))
            or f"GitHub 授权失败（{error_code}）",
        }

    def sign_out(self) -> None:
        self._pending_authorizations.clear()
        self._store_path.unlink(missing_ok=True)

    def _get_user(self, access_token: str) -> dict[str, Any]:
        request = Request(
            GITHUB_USER_URL,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "DataDjinn",
            },
        )
        with self._open_url(request, timeout=15) as response:
            return self._decode_json(response.read())

    def _post_form(self, url: str, values: dict[str, str]) -> dict[str, Any]:
        request = Request(
            url,
            data=urlencode(values).encode("utf-8"),
            headers={"Accept": "application/json", "User-Agent": "DataDjinn"},
            method="POST",
        )
        with self._open_url(request, timeout=15) as response:
            return self._decode_json(response.read())

    def _save_token(self, access_token: str, user: dict[str, Any]) -> None:
        self._write_store({"encrypted_access_token": _encrypt_password(access_token), "login": self._string_or_none(user.get("login")), "name": self._string_or_none(user.get("name")), "avatar_url": self._string_or_none(user.get("avatar_url"))})

    def _remember_repository(self, repository: dict[str, Any]) -> GitHubSyncRepository:
        result = GitHubSyncRepository(full_name=self._required_string(repository, "full_name"), html_url=self._required_string(repository, "html_url"))
        self._write_store({"repository_full_name": result.full_name, "repository_url": result.html_url})
        return result

    def _access_token(self) -> str:
        token = self._decrypt_token(self._read_store().get("encrypted_access_token"))
        if not token:
            raise ValueError("请先登录 GitHub")
        return token

    def _github_request(self, method: str, path: str, token: str, payload: dict[str, Any] | None = None) -> Any:
        request = Request(f"{GITHUB_API_URL}{path}", data=json.dumps(payload).encode("utf-8") if payload is not None else None, headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "User-Agent": "DataDjinn", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"}, method=method)
        try:
            with self._open_url(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                error_payload = json.loads(exc.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError, OSError):
                error_payload = None
            if isinstance(error_payload, dict):
                message = error_payload.get("message")
                errors = error_payload.get("errors")
                detail_text = "; ".join(
                    item.get("message", "")
                    for item in errors
                    if isinstance(item, dict) and isinstance(item.get("message"), str)
                ) if isinstance(errors, list) else ""
                if isinstance(message, str) and message:
                    exc.msg = f"{message}: {detail_text}" if detail_text else message
            raise

    @staticmethod
    def _open_url(request: Request, *, timeout: int):
        last_error: URLError | None = None
        for attempt in range(GITHUB_REQUEST_ATTEMPTS):
            try:
                return urlopen(request, timeout=timeout)
            except HTTPError:
                raise
            except URLError as exc:
                last_error = exc
                if attempt + 1 < GITHUB_REQUEST_ATTEMPTS:
                    time.sleep(GITHUB_REQUEST_RETRY_DELAY_SECONDS * (attempt + 1))

        if last_error is not None:
            raise last_error
        raise RuntimeError("GitHub 请求失败")

    def _write_store(self, patch: dict[str, Any]) -> None:
        self._store_path.parent.mkdir(parents=True, exist_ok=True)
        self._store_path.write_text(json.dumps({**self._read_store(), **patch}, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read_store(self) -> dict[str, Any]:
        if not self._store_path.exists():
            return {}
        try:
            content = json.loads(self._store_path.read_text(encoding="utf-8"))
            return content if isinstance(content, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    @staticmethod
    def _decrypt_token(encrypted_token: Any) -> str | None:
        if not isinstance(encrypted_token, str) or not encrypted_token:
            return None
        try:
            return _decrypt_password(encrypted_token)
        except (UnicodeDecodeError, ValueError):
            return None

    @staticmethod
    def _decode_json(raw: bytes) -> dict[str, Any]:
        decoded = json.loads(raw.decode("utf-8"))
        if not isinstance(decoded, dict):
            raise ValueError("GitHub 返回了无效的授权响应")
        return decoded

    @staticmethod
    def _read_http_error(error: HTTPError) -> dict[str, Any]:
        return GitHubOAuthService._decode_json(error.read())

    @staticmethod
    def _required_dict(payload: Any, key: str) -> dict[str, Any]:
        value = payload.get(key) if isinstance(payload, dict) else None
        if not isinstance(value, dict):
            raise ValueError(f"GitHub 返回内容缺少必要字段：{key}")
        return value

    @staticmethod
    def _required_string(payload: dict[str, Any], key: str) -> str:
        value = GitHubOAuthService._string_or_none(payload.get(key))
        if not value:
            raise ValueError(f"GitHub 授权响应缺少必要字段：{key}")
        return value

    @staticmethod
    def _string_or_none(value: Any) -> str | None:
        return value.strip() if isinstance(value, str) and value.strip() else None

    @staticmethod
    def _positive_int(value: Any, default: int) -> int:
        return value if isinstance(value, int) and value > 0 else default

    @staticmethod
    def _normalize_repository_path(path: str) -> str:
        normalized = path.strip().replace("\\", "/")
        parsed = PurePosixPath(normalized)
        if not normalized or parsed.is_absolute() or ".." in parsed.parts:
            raise ValueError("GitHub 同步文件路径无效")
        return parsed.as_posix()


github_oauth_service = GitHubOAuthService()
