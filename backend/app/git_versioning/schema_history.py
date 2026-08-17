from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from app.db.connection_manager import connection_manager
from app.git_sync.github_oauth import GitHubRepositoryCommit, github_oauth_service

SNAPSHOT_FORMAT = "datadjinn-schema-snapshot"
SNAPSHOT_VERSION = 1
SYSTEM_DATABASES = {"information_schema", "mysql", "performance_schema", "sys", "postgres", "template0", "template1"}
SYSTEM_VERSIONING_SCOPES = SYSTEM_DATABASES | {
    "SYS",
    "SYSDBA",
    "SYSAUDITOR",
    "SYSSSO",
    "CTISYS",
    "SYSTEM",
    "XDB",
}
SCHEMA_SCOPED_DATABASE_TYPES = {"postgresql", "gaussdb", "dm", "oracle"}
DATABASE_SCOPED_DATABASE_TYPES = {"mysql", "clickhouse"}
SNAPSHOTTED_OBJECT_TYPES = {"table", "view", "trigger", "procedure", "function", "sequence", "index"}
logger = logging.getLogger("datadjinn.schema-versioning")
SCHEMA_MUTATION_PATTERN = re.compile(r"^(?:CREATE|ALTER|DROP|RENAME|TRUNCATE)\b", re.IGNORECASE)


def contains_schema_mutation(sql: str) -> bool:
    from app.db.readonly_query import _split_sql_statements

    for statement in _split_sql_statements(sql):
        normalized = re.sub(r"^(?:\s|--[^\n]*\n|/\*.*?\*/)*", "", statement, flags=re.DOTALL)
        if SCHEMA_MUTATION_PATTERN.match(normalized):
            return True
    return False


class SchemaSnapshotObject(BaseModel):
    scope: str | None = None
    name: str
    type: str
    ddl: str


class SchemaSnapshot(BaseModel):
    format: Literal["datadjinn-schema-snapshot"] = SNAPSHOT_FORMAT
    version: Literal[1] = SNAPSHOT_VERSION
    connection_id: str
    database_type: str
    captured_at: str
    fingerprint: str
    objects: list[SchemaSnapshotObject] = Field(default_factory=list)
    skipped_objects: list[str] = Field(default_factory=list)


class SchemaVersionInfo(BaseModel):
    id: str
    message: str
    committed_at: str | None = None


class SchemaSnapshotResult(BaseModel):
    snapshot: SchemaSnapshot
    changed: bool
    version_id: str | None = None


class VersioningScopeConfig(BaseModel):
    scope_kind: Literal["database", "schema", "single"]
    available_scopes: list[str] = Field(default_factory=list)
    selected_scopes: list[str] = Field(default_factory=list)


class SchemaVersioningService:
    def snapshot_path(self, connection_id: str) -> str:
        return f"versioning/schema/{connection_id}/snapshot.json"

    def create_snapshot(self, connection_id: str, reason: str = "手动创建结构快照") -> SchemaSnapshotResult:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("请先在连接设置中开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持结构版本管理")
        if not github_oauth_service.status().authorized:
            raise ValueError("请先在设置的“同步与版本”中登录 GitHub")

        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法创建结构快照")

        snapshot = self._capture_snapshot(
            connection_id,
            request.database_type,
            engine,
            getattr(request, "git_versioning_scopes", []),
        )
        path = self.snapshot_path(connection_id)
        previous = github_oauth_service.read_repository_file(path)
        if previous is not None:
            previous_snapshot = self._parse_snapshot(previous.content)
            if previous_snapshot.fingerprint == snapshot.fingerprint:
                commits = github_oauth_service.list_repository_commits(path, per_page=1)
                return SchemaSnapshotResult(
                    snapshot=snapshot,
                    changed=False,
                    version_id=commits[0].sha if commits else None,
                )

        result = github_oauth_service.write_repository_file(
            path,
            snapshot.model_dump_json(indent=2),
            self._commit_message(reason, snapshot),
            sha=previous.sha if previous else None,
        )
        commits = github_oauth_service.list_repository_commits(path, per_page=1)
        return SchemaSnapshotResult(
            snapshot=snapshot,
            changed=True,
            version_id=commits[0].sha if commits else result.sha,
        )

    def schedule_snapshot(self, background_tasks: object, connection_id: str, reason: str) -> None:
        try:
            request = connection_manager.get_connection_request(connection_id)
        except ValueError:
            return
        if (
            not request.git_versioning_enabled
            or request.database_type in {"mongodb", "redis"}
            or not self._has_selected_scopes(
                request.database_type, getattr(request, "git_versioning_scopes", [])
            )
            or not github_oauth_service.status().authorized
        ):
            return
        add_task = getattr(background_tasks, "add_task", None)
        if callable(add_task):
            add_task(self._create_snapshot_safely, connection_id, reason)

    def _create_snapshot_safely(self, connection_id: str, reason: str) -> None:
        try:
            self.create_snapshot(connection_id, reason)
        except Exception:
            logger.exception("自动创建结构版本失败：connection_id=%s", connection_id)

    def list_versions(self, connection_id: str, limit: int = 30) -> list[SchemaVersionInfo]:
        self._ensure_versioning_enabled(connection_id)
        return [self._version_info(commit) for commit in github_oauth_service.list_repository_commits(self.snapshot_path(connection_id), per_page=limit)]

    def get_scope_config(self, connection_id: str) -> VersioningScopeConfig:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("请先在连接设置中开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持结构版本管理")
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法读取可纳管范围")

        scope_kind = self._scope_kind(request.database_type)
        if scope_kind == "single":
            return VersioningScopeConfig(
                scope_kind=scope_kind,
                available_scopes=["main"],
                selected_scopes=["main"],
            )
        available_scopes = self._list_available_scopes(engine, request.database_type)
        available_by_key = {scope.casefold(): scope for scope in available_scopes}
        selected_scopes = [
            available_by_key[scope.casefold()]
            for scope in request.git_versioning_scopes
            if scope.casefold() in available_by_key
        ]
        return VersioningScopeConfig(
            scope_kind=scope_kind,
            available_scopes=available_scopes,
            selected_scopes=list(dict.fromkeys(selected_scopes)),
        )

    def update_scope_config(
        self, connection_id: str, selected_scopes: list[str]
    ) -> VersioningScopeConfig:
        config = self.get_scope_config(connection_id)
        if config.scope_kind == "single":
            return config
        available_by_key = {scope.casefold(): scope for scope in config.available_scopes}
        normalized_scopes: list[str] = []
        for scope in selected_scopes:
            normalized_scope = scope.strip() if isinstance(scope, str) else ""
            available_scope = available_by_key.get(normalized_scope.casefold())
            if available_scope is None:
                raise ValueError(f"不能纳管不存在或系统范围：{normalized_scope or '空值'}")
            if available_scope not in normalized_scopes:
                normalized_scopes.append(available_scope)
        connection_manager.update_git_versioning_scopes(connection_id, normalized_scopes)
        return config.model_copy(update={"selected_scopes": normalized_scopes})

    def get_version(self, connection_id: str, version_id: str) -> SchemaSnapshot:
        self._ensure_versioning_enabled(connection_id)
        snapshot_file = github_oauth_service.read_repository_file(self.snapshot_path(connection_id), ref=version_id)
        if snapshot_file is None:
            raise ValueError("找不到指定的结构版本")
        return self._parse_snapshot(snapshot_file.content)

    def _ensure_versioning_enabled(self, connection_id: str) -> None:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("该连接未开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持结构版本管理")
        if not github_oauth_service.status().authorized:
            raise ValueError("请先在设置的“同步与版本”中登录 GitHub")

    def _capture_snapshot(
        self,
        connection_id: str,
        database_type: str,
        engine: Engine,
        selected_scopes: list[str] | None = None,
    ) -> SchemaSnapshot:
        from app.db.metadata import get_object_ddl, list_db_objects

        objects: list[SchemaSnapshotObject] = []
        skipped: list[str] = []
        for scope in self._selected_scopes(engine, database_type, selected_scopes or []):
            for db_object in list_db_objects(engine, scope, include_stats=False):
                if db_object.type not in SNAPSHOTTED_OBJECT_TYPES:
                    continue
                try:
                    ddl = get_object_ddl(engine, db_object.name, db_object.type, scope).strip()
                except (ValueError, NotImplementedError) as exc:
                    skipped.append(f"{scope or '默认'}:{db_object.type}:{db_object.name}（{exc}）")
                    continue
                if ddl:
                    objects.append(
                        SchemaSnapshotObject(scope=scope, name=db_object.name, type=db_object.type, ddl=ddl)
                    )

        objects.sort(key=lambda item: ((item.scope or ""), item.type, item.name))
        fingerprint = hashlib.sha256(
            json.dumps([item.model_dump() for item in objects], ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        return SchemaSnapshot(
            connection_id=connection_id,
            database_type=database_type,
            captured_at=datetime.now(timezone.utc).isoformat(),
            fingerprint=fingerprint,
            objects=objects,
            skipped_objects=skipped,
        )

    @staticmethod
    def _scope_kind(database_type: str) -> Literal["database", "schema", "single"]:
        if database_type in DATABASE_SCOPED_DATABASE_TYPES:
            return "database"
        if database_type in SCHEMA_SCOPED_DATABASE_TYPES:
            return "schema"
        return "single"

    @classmethod
    def _has_selected_scopes(cls, database_type: str, selected_scopes: list[str]) -> bool:
        return cls._scope_kind(database_type) == "single" or bool(selected_scopes)

    @classmethod
    def _selected_scopes(
        cls, engine: Engine, database_type: str, selected_scopes: list[str]
    ) -> list[str | None]:
        if cls._scope_kind(database_type) == "single":
            return [None]
        if not selected_scopes:
            raise ValueError("请先在版本管理中选择需要纳管的库或模式")
        available_by_key = {
            scope.casefold(): scope for scope in cls._list_available_scopes(engine, database_type)
        }
        resolved_scopes = [
            available_by_key[scope.casefold()]
            for scope in selected_scopes
            if scope.casefold() in available_by_key
        ]
        if not resolved_scopes:
            raise ValueError("已选择的纳管范围已不存在，请重新选择后再创建结构快照")
        return resolved_scopes

    @staticmethod
    def _list_available_scopes(engine: Engine, database_type: str) -> list[str]:
        from app.db.metadata import list_databases, list_schemas

        if database_type in {"postgresql", "gaussdb"}:
            return [item.name for item in list_schemas(engine)]
        if database_type in {"mysql", "clickhouse", "dm", "oracle"}:
            system_scopes = {name.casefold() for name in SYSTEM_VERSIONING_SCOPES}
            return [
                item.name for item in list_databases(engine) if item.name.casefold() not in system_scopes
            ]
        return []

    @staticmethod
    def _parse_snapshot(content: str) -> SchemaSnapshot:
        try:
            return SchemaSnapshot.model_validate_json(content)
        except ValueError as exc:
            raise ValueError("GitHub 中的结构快照格式无效") from exc

    @staticmethod
    def _commit_message(reason: str, snapshot: SchemaSnapshot) -> str:
        normalized_reason = reason.strip() or "更新结构快照"
        return f"DataDjinn: {normalized_reason}（{len(snapshot.objects)} 个对象）"

    @staticmethod
    def _version_info(commit: GitHubRepositoryCommit) -> SchemaVersionInfo:
        return SchemaVersionInfo(id=commit.sha, message=commit.message, committed_at=commit.committed_at)


schema_versioning_service = SchemaVersioningService()
