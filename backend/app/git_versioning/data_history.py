from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.db.connection_manager import connection_manager
from app.db.readonly_query import preview_table
from app.git_sync.github_oauth import GitHubRepositoryCommit, github_oauth_service

DATA_SNAPSHOT_FORMAT = "datadjinn-data-snapshot"
DATA_SNAPSHOT_VERSION = 1
DATA_SNAPSHOT_PAGE_SIZE = 500
DATA_SNAPSHOT_MAX_ROWS = 5_000
# GitHub Contents API 对单文件有严格限制。保留余量给 Base64 编码和后续元数据。
DATA_SNAPSHOT_MAX_BYTES = 700_000
logger = logging.getLogger("datadjinn.data-versioning")


class TableDataSnapshot(BaseModel):
    format: Literal["datadjinn-data-snapshot"] = DATA_SNAPSHOT_FORMAT
    version: Literal[1] = DATA_SNAPSHOT_VERSION
    connection_id: str
    database_type: str
    table_name: str
    database: str | None = None
    pg_database: str | None = None
    captured_at: str
    fingerprint: str
    columns: list[str] = Field(default_factory=list)
    identity_columns: list[str] = Field(default_factory=list)
    identity_mode: Literal["primary_key", "unique_key", "snapshot_only"] = "snapshot_only"
    rows: list[dict[str, Any]] = Field(default_factory=list)


class DataVersionInfo(BaseModel):
    id: str
    message: str
    committed_at: str | None = None


class DataSnapshotResult(BaseModel):
    snapshot: TableDataSnapshot
    changed: bool
    version_id: str | None = None


class DataRowChange(BaseModel):
    identity: dict[str, Any]
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    changed_columns: list[str] = Field(default_factory=list)


class DataSnapshotDiff(BaseModel):
    version_id: str
    table_name: str
    identity_columns: list[str]
    added: list[DataRowChange] = Field(default_factory=list)
    deleted: list[DataRowChange] = Field(default_factory=list)
    updated: list[DataRowChange] = Field(default_factory=list)


class DataVersioningService:
    def snapshot_path(
        self,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
    ) -> str:
        source = "\n".join([database or "", pg_database or "", table_name])
        table_key = hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]
        return f"versioning/data/{connection_id}/{table_key}/snapshot.json"

    def create_snapshot(
        self,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
        reason: str = "手动创建数据快照",
    ) -> DataSnapshotResult:
        request = self._ensure_versioning_enabled(connection_id)
        engine = self._get_active_engine(connection_id, "创建数据快照")

        snapshot = self._capture_snapshot(
            connection_id,
            request.database_type,
            engine,
            table_name,
            database,
            pg_database,
        )
        path = self.snapshot_path(connection_id, table_name, database, pg_database)
        previous = github_oauth_service.read_repository_file(path)
        if previous is not None:
            previous_snapshot = self._parse_snapshot(previous.content)
            if previous_snapshot.fingerprint == snapshot.fingerprint:
                commits = github_oauth_service.list_repository_commits(path, per_page=1)
                return DataSnapshotResult(
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
        return DataSnapshotResult(
            snapshot=snapshot,
            changed=True,
            version_id=commits[0].sha if commits else result.sha,
        )

    def schedule_snapshot(
        self,
        background_tasks: object,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
        reason: str = "保存表格数据",
    ) -> None:
        """仅对已手动创建过首个快照的数据表开启自动跟踪。"""
        try:
            request = connection_manager.get_connection_request(connection_id)
        except ValueError:
            return
        if (
            not request.git_versioning_enabled
            or request.database_type in {"mongodb", "redis"}
            or not github_oauth_service.status().authorized
        ):
            return
        add_task = getattr(background_tasks, "add_task", None)
        if callable(add_task):
            add_task(
                self._create_snapshot_if_managed_safely,
                connection_id,
                table_name,
                database,
                pg_database,
                reason,
            )

    def _create_snapshot_if_managed_safely(
        self,
        connection_id: str,
        table_name: str,
        database: str | None,
        pg_database: str | None,
        reason: str,
    ) -> None:
        try:
            path = self.snapshot_path(connection_id, table_name, database, pg_database)
            if github_oauth_service.read_repository_file(path) is None:
                return
            self.create_snapshot(connection_id, table_name, database, pg_database, reason)
        except Exception:
            logger.exception(
                "自动创建表数据版本失败：connection_id=%s, table=%s",
                connection_id,
                table_name,
            )

    def list_versions(
        self,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
        limit: int = 30,
    ) -> list[DataVersionInfo]:
        self._ensure_versioning_enabled(connection_id)
        path = self.snapshot_path(connection_id, table_name, database, pg_database)
        return [self._version_info(commit) for commit in github_oauth_service.list_repository_commits(path, per_page=limit)]

    def get_version(
        self,
        connection_id: str,
        table_name: str,
        version_id: str,
        database: str | None = None,
        pg_database: str | None = None,
    ) -> TableDataSnapshot:
        self._ensure_versioning_enabled(connection_id)
        path = self.snapshot_path(connection_id, table_name, database, pg_database)
        snapshot_file = github_oauth_service.read_repository_file(path, ref=version_id)
        if snapshot_file is None:
            raise ValueError("找不到指定的数据版本")
        return self._parse_snapshot(snapshot_file.content)

    def diff_version(
        self,
        connection_id: str,
        table_name: str,
        version_id: str,
        database: str | None = None,
        pg_database: str | None = None,
    ) -> DataSnapshotDiff:
        historical = self.get_version(
            connection_id, table_name, version_id, database, pg_database
        )
        if historical.identity_mode == "snapshot_only" or not historical.identity_columns:
            raise ValueError("该历史快照没有主键或唯一键标识，只能查看完整快照，不能生成行级差异")

        request = self._ensure_versioning_enabled(connection_id)
        engine = self._get_active_engine(connection_id, "比对数据版本")
        current = self._capture_snapshot(
            connection_id,
            request.database_type,
            engine,
            table_name,
            database,
            pg_database,
        )
        if current.identity_columns != historical.identity_columns:
            raise ValueError("当前表的主键或唯一键已变化，无法安全生成行级差异")

        historical_rows = self._rows_by_identity(historical.rows, historical.identity_columns)
        current_rows = self._rows_by_identity(current.rows, historical.identity_columns)
        added: list[DataRowChange] = []
        deleted: list[DataRowChange] = []
        updated: list[DataRowChange] = []
        all_columns = list(dict.fromkeys([*historical.columns, *current.columns]))
        for row_key, current_row in current_rows.items():
            historical_row = historical_rows.get(row_key)
            identity = self._identity_values(current_row, historical.identity_columns)
            if historical_row is None:
                added.append(DataRowChange(identity=identity, after=current_row))
                continue
            changed_columns = [
                column
                for column in all_columns
                if column not in historical.identity_columns
                and historical_row.get(column) != current_row.get(column)
            ]
            if changed_columns:
                updated.append(
                    DataRowChange(
                        identity=identity,
                        before=historical_row,
                        after=current_row,
                        changed_columns=changed_columns,
                    )
                )
        for row_key, historical_row in historical_rows.items():
            if row_key not in current_rows:
                deleted.append(
                    DataRowChange(
                        identity=self._identity_values(historical_row, historical.identity_columns),
                        before=historical_row,
                    )
                )
        return DataSnapshotDiff(
            version_id=version_id,
            table_name=historical.table_name,
            identity_columns=historical.identity_columns,
            added=added,
            deleted=deleted,
            updated=updated,
        )

    def _ensure_versioning_enabled(self, connection_id: str) -> Any:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("该连接未开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持关系型表数据版本管理")
        if not github_oauth_service.status().authorized:
            raise ValueError("请先在设置的“同步与版本”中登录 GitHub")
        return request

    def _get_active_engine(self, connection_id: str, operation: str) -> Any:
        if not connection_manager.ensure_connection_available(connection_id):
            raise ValueError(f"连接暂时不可用，无法{operation}")
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError(f"连接暂时不可用，无法{operation}")
        return engine

    def _capture_snapshot(
        self,
        connection_id: str,
        database_type: str,
        engine: Any,
        table_name: str,
        database: str | None,
        pg_database: str | None,
    ) -> TableDataSnapshot:
        from app.db.metadata import list_columns

        normalized_table_name = table_name.strip()
        if not normalized_table_name:
            raise ValueError("请选择需要纳管的数据表")
        columns = list_columns(engine, normalized_table_name, database, pg_database)
        if not columns:
            raise ValueError("未找到数据表字段，无法创建快照")

        primary_key_columns = [column.name for column in columns if column.primary_key]
        unique_columns = [column.name for column in columns if column.unique]
        identity_columns = primary_key_columns or unique_columns[:1]
        identity_mode: Literal["primary_key", "unique_key", "snapshot_only"]
        if primary_key_columns:
            identity_mode = "primary_key"
        elif identity_columns:
            identity_mode = "unique_key"
        else:
            identity_mode = "snapshot_only"

        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = preview_table(
                engine,
                normalized_table_name,
                DATA_SNAPSHOT_PAGE_SIZE,
                offset,
                database,
                pg_database,
                sort_column=identity_columns[0] if identity_columns else None,
                sort_direction="ascend" if identity_columns else None,
            )
            rows.extend(page.rows)
            if len(rows) > DATA_SNAPSHOT_MAX_ROWS:
                raise ValueError(
                    f"表数据超过 {DATA_SNAPSHOT_MAX_ROWS} 行，当前版本仅支持小表 Git 快照；请配置数据版本扩展的大文件存储后再纳管"
                )
            if not page.limited:
                break
            offset += len(page.rows)
            if not page.rows:
                break

        fingerprint_source = {
            "table_name": normalized_table_name,
            "database": database,
            "pg_database": pg_database,
            "columns": [column.name for column in columns],
            "identity_columns": identity_columns,
            "rows": rows,
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_source, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        snapshot = TableDataSnapshot(
            connection_id=connection_id,
            database_type=database_type,
            table_name=normalized_table_name,
            database=database,
            pg_database=pg_database,
            captured_at=datetime.now(timezone.utc).isoformat(),
            fingerprint=fingerprint,
            columns=[column.name for column in columns],
            identity_columns=identity_columns,
            identity_mode=identity_mode,
            rows=rows,
        )
        size_bytes = len(snapshot.model_dump_json().encode("utf-8"))
        if size_bytes > DATA_SNAPSHOT_MAX_BYTES:
            raise ValueError(
                "数据快照超过 GitHub 单文件安全大小，当前版本仅支持小表 Git 快照；请配置数据版本扩展的大文件存储后再纳管"
            )
        return snapshot

    @staticmethod
    def _parse_snapshot(content: str) -> TableDataSnapshot:
        try:
            return TableDataSnapshot.model_validate_json(content)
        except ValueError as exc:
            raise ValueError("GitHub 中的数据快照格式无效") from exc

    @staticmethod
    def _identity_values(row: dict[str, Any], identity_columns: list[str]) -> dict[str, Any]:
        missing = [column for column in identity_columns if column not in row]
        if missing:
            raise ValueError(f"数据快照缺少行级标识字段：{', '.join(missing)}")
        return {column: row[column] for column in identity_columns}

    @classmethod
    def _rows_by_identity(
        cls, rows: list[dict[str, Any]], identity_columns: list[str]
    ) -> dict[str, dict[str, Any]]:
        indexed: dict[str, dict[str, Any]] = {}
        for row in rows:
            identity = cls._identity_values(row, identity_columns)
            row_key = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if row_key in indexed:
                raise ValueError("数据快照中存在重复的主键或唯一键，无法安全生成行级差异")
            indexed[row_key] = row
        return indexed

    @staticmethod
    def _commit_message(reason: str, snapshot: TableDataSnapshot) -> str:
        normalized_reason = reason.strip() or "更新数据快照"
        return f"DataDjinn: {normalized_reason}（{snapshot.table_name}，{len(snapshot.rows)} 行）"

    @staticmethod
    def _version_info(commit: GitHubRepositoryCommit) -> DataVersionInfo:
        return DataVersionInfo(id=commit.sha, message=commit.message, committed_at=commit.committed_at)


data_versioning_service = DataVersioningService()
