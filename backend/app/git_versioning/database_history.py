from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
from decimal import Decimal, InvalidOperation
from threading import Event, Lock, Thread
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Literal

import sqlparse
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text

from app.db.connection_manager import connection_manager
from app.db.metadata import get_object_ddl, list_columns, list_db_objects, list_tables
from app.db.readonly_query import preview_table
from app.git_sync.github_oauth import github_oauth_service
from app.git_versioning.schema_history import SchemaSnapshot, SchemaSnapshotObject, schema_versioning_service
from app.git_versioning.local_history import local_snapshot_history
from app.git_versioning.task_progress import GitTask, git_task_registry


DATABASE_SNAPSHOT_FORMAT = "datadjinn-database-snapshot"
DATABASE_SNAPSHOT_VERSION = 1
MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS = 4
MAX_TABLE_SNAPSHOT_ROWS = 100_000
MAX_TABLE_SNAPSHOT_BYTES = 50_000_000
MAX_DATABASE_SNAPSHOT_UNCOMPRESSED_BYTES = 50_000_000
SNAPSHOT_VALUE_TYPE_KEY = "__datadjinn_snapshot_value_type__"
logger = logging.getLogger("datadjinn.database-versioning")


def _encode_snapshot_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return {SNAPSHOT_VALUE_TYPE_KEY: "decimal", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            SNAPSHOT_VALUE_TYPE_KEY: "bytes",
            "value": base64.b64encode(bytes(value)).decode("ascii"),
        }
    if isinstance(value, dict):
        encoded = {str(key): _encode_snapshot_value(item) for key, item in value.items()}
        if SNAPSHOT_VALUE_TYPE_KEY in encoded:
            return {SNAPSHOT_VALUE_TYPE_KEY: "object", "value": encoded}
        return encoded
    if isinstance(value, (list, tuple)):
        return [_encode_snapshot_value(item) for item in value]
    return value


def _decode_snapshot_value(value: Any) -> Any:
    if isinstance(value, dict):
        value_type = value.get(SNAPSHOT_VALUE_TYPE_KEY)
        if value_type == "decimal":
            try:
                return Decimal(value["value"])
            except (InvalidOperation, KeyError, TypeError) as exc:
                raise ValueError("快照中的 Decimal 值格式无效") from exc
        if value_type == "bytes":
            try:
                return base64.b64decode(value["value"], validate=True)
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError("快照中的二进制值格式无效") from exc
        if value_type == "object":
            return _decode_snapshot_value(value.get("value", {}))
        return {key: _decode_snapshot_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode_snapshot_value(item) for item in value]
    return value


def _snapshot_bind_value(value: Any) -> Any:
    decoded = _decode_snapshot_value(value)
    if isinstance(decoded, (dict, list)):
        return json.dumps(decoded, ensure_ascii=False, default=str)
    return decoded


def _snapshot_display_value(value: Any) -> Any:
    decoded = _decode_snapshot_value(value)
    if isinstance(decoded, Decimal):
        return str(decoded)
    if isinstance(decoded, bytes):
        return decoded.hex()
    if isinstance(decoded, dict):
        return {key: _snapshot_display_value(item) for key, item in decoded.items()}
    if isinstance(decoded, list):
        return [_snapshot_display_value(item) for item in decoded]
    return decoded


def _snapshot_display_row(row: dict[str, Any]) -> dict[str, Any]:
    return {column: _snapshot_display_value(value) for column, value in row.items()}


class DatabaseSnapshotResult(BaseModel):
    id: str
    task_id: str
    status: str
    percent: int = 0
    detail: str = "准备开始"


class DatabaseSnapshotTablePreview(BaseModel):
    scope: str
    table_name: str
    estimated_row_count: int | None = None
    estimated_storage_size_bytes: int | None = None


class DatabaseSnapshotPreview(BaseModel):
    scopes: list[str] = Field(default_factory=list)
    tables: list[DatabaseSnapshotTablePreview] = Field(default_factory=list)
    estimated_row_count: int | None = None
    estimated_storage_size_bytes: int | None = None
    max_rows_per_table: int = MAX_TABLE_SNAPSHOT_ROWS
    max_table_snapshot_bytes: int = MAX_TABLE_SNAPSHOT_BYTES
    max_database_snapshot_bytes: int = MAX_DATABASE_SNAPSHOT_UNCOMPRESSED_BYTES


class DatabaseSnapshotTask(BaseModel):
    id: str
    connection_id: str
    title: str
    status: str
    current: int
    total: int
    percent: int
    detail: str
    error: str | None = None
    started_at: str
    finished_at: str | None = None
    result: dict[str, object] | None = None


class TableSnapshot(BaseModel):
    table_name: str
    scope: str | None = None
    database: str | None = None
    pg_database: str | None = None
    captured_at: str
    columns: list[str] = Field(default_factory=list)
    identity_columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    fingerprint: str


class DatabaseSnapshotManifest(BaseModel):
    model_config = {"populate_by_name": True}
    format: str = DATABASE_SNAPSHOT_FORMAT
    version: int = DATABASE_SNAPSHOT_VERSION
    connection_id: str
    database_type: str
    captured_at: str
    snapshot_kind: Literal["checkpoint"] = "checkpoint"
    fingerprint: str
    schema_snapshot: SchemaSnapshot = Field(alias="schema")
    tables: list[dict[str, Any]] = Field(default_factory=list)
    skipped_tables: list[dict[str, Any]] = Field(default_factory=list)


class LocalDatabaseSnapshot(BaseModel):
    connection_id: str
    reason: str
    captured_at: str
    snapshot_kind: Literal["checkpoint", "table_change"] = "checkpoint"
    schema_snapshot: SchemaSnapshot | None = None
    tables: list[TableSnapshot] = Field(default_factory=list)
    skipped_tables: list[dict[str, Any]] = Field(default_factory=list)


class DatabaseVersioningService:
    def __init__(self) -> None:
        self._sync_worker_locks: dict[str, Lock] = {}
        self._sync_worker_locks_guard = Lock()
        self._schedule_worker_guard = Lock()
        self._schedule_worker_stop = Event()
        self._schedule_worker: Thread | None = None
        self._scheduled_snapshot_connections: set[str] = set()
        self._scheduled_snapshot_guard = Lock()

    def manifest_path(self, connection_id: str) -> str:
        return f"versioning/database/{connection_id}/manifest.json"

    def table_path(self, connection_id: str, scope: str | None, table_name: str) -> str:
        key = hashlib.sha256(json.dumps([scope or "", table_name], ensure_ascii=False).encode("utf-8")).hexdigest()[:24]
        return f"versioning/database/{connection_id}/tables/{key}.json.gz"

    def changes_path(self, connection_id: str) -> str:
        return f"versioning/database/{connection_id}/changes.sql.gz"

    def prepare_write_snapshot(
        self,
        connection_id: str,
        reason: str,
        affected_tables: list[tuple[str | None, str, str | None, str | None]] | None = None,
        capture_schema: bool = False,
    ) -> str | None:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled or request.database_type in {"mongodb", "redis"}:
            return None
        if request.database_type in {"mysql", "postgresql", "gaussdb", "dm", "oracle", "clickhouse"} and not getattr(
            request, "git_versioning_scopes", []
        ):
            return None
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法保护本次数据库写入")
        scopes = (
            schema_versioning_service._selected_scopes(
                engine,
                request.database_type,
                getattr(request, "git_versioning_scopes", []),
            )
            if affected_tables is None
            else []
        )
        schema = None
        if affected_tables is None or capture_schema:
            schema = schema_versioning_service._capture_snapshot(
                connection_id,
                request.database_type,
                engine,
                getattr(request, "git_versioning_scopes", []),
            )
        table_targets = affected_tables
        snapshot_kind: Literal["checkpoint", "table_change"] = "table_change"
        if table_targets is None:
            snapshot_kind = "checkpoint"
            table_targets = [
                (scope, table.name, None, None)
                for scope in scopes
                for table in list_tables(engine, scope, None, include_stats=False)
            ]
        else:
            table_targets = list(dict.fromkeys(table_targets))
        tables: list[TableSnapshot] = []
        total_size = 0
        for scope, table_name, database, pg_database in table_targets:
            columns = list_columns(engine, table_name, scope, pg_database)
            snapshot = self._capture_table(
                engine,
                request.database_type,
                scope,
                table_name,
                database,
                pg_database,
                columns=columns,
            )
            total_size += len(snapshot.model_dump_json(ensure_ascii=False).encode("utf-8"))
            if total_size > MAX_DATABASE_SNAPSHOT_UNCOMPRESSED_BYTES:
                raise ValueError("本次写入前快照超过 50 MB 本机保护上限，尚未执行写入")
            tables.append(snapshot)
        archive = LocalDatabaseSnapshot(
            connection_id=connection_id,
            reason=reason,
            captured_at=datetime.now(timezone.utc).isoformat(),
            snapshot_kind=snapshot_kind,
            schema_snapshot=schema,
            tables=tables,
        )
        payload = gzip.compress(
            archive.model_dump_json(ensure_ascii=False).encode("utf-8"),
            compresslevel=6,
            mtime=0,
        )
        return local_snapshot_history.save_prepared(
            connection_id, reason, payload, snapshot_kind=snapshot_kind
        )

    def complete_write_snapshot(self, connection_id: str, snapshot_id: str | None, succeeded: bool) -> None:
        if snapshot_id is None:
            return
        try:
            if not succeeded:
                local_snapshot_history.update_status(
                    snapshot_id,
                    "local_only",
                    error="本次写入未成功，快照仅保存在本机；如确认发生了部分变更，可手动重试同步",
                )
                return
            local_snapshot_history.update_status(snapshot_id, "pending")
            self._start_local_snapshot_sync(connection_id)
        except Exception:
            logger.exception("更新本机数据库快照状态失败：snapshot_id=%s", snapshot_id)
            return

    def _start_local_snapshot_sync(self, connection_id: str) -> None:
        with self._sync_worker_locks_guard:
            lock = self._sync_worker_locks.setdefault(connection_id, Lock())
        Thread(
            target=self._sync_pending_local_snapshots,
            args=(connection_id, lock),
            daemon=True,
            name=f"datadjinn-snapshot-sync-{connection_id[:8]}",
        ).start()

    def resume_pending_local_syncs(self) -> None:
        try:
            if not github_oauth_service.status().authorized:
                return
            connection_ids = local_snapshot_history.pending_connection_ids()
        except Exception:
            return
        for connection_id in connection_ids:
            self._start_local_snapshot_sync(connection_id)

    def start_snapshot_scheduler(self) -> None:
        with self._schedule_worker_guard:
            if self._schedule_worker and self._schedule_worker.is_alive():
                return
            self._schedule_worker_stop.clear()
            self._schedule_worker = Thread(
                target=self._snapshot_scheduler_loop,
                daemon=True,
                name="datadjinn-database-snapshot-scheduler",
            )
            self._schedule_worker.start()

    def _snapshot_scheduler_loop(self) -> None:
        while not self._schedule_worker_stop.wait(60):
            try:
                self.run_due_scheduled_snapshots()
            except Exception:
                logger.exception("检查定时数据库快照失败")

    def run_due_scheduled_snapshots(self, now: datetime | None = None) -> None:
        current_time = now or datetime.now(timezone.utc)
        try:
            connections = connection_manager.list_connections()
        except Exception:
            logger.exception("读取连接列表以执行定时数据库快照失败")
            return

        for connection in connections:
            if not connection.is_open:
                continue
            connection_id = connection.connection_id
            try:
                request = connection_manager.get_connection_request(connection_id)
                interval_hours = getattr(request, "git_versioning_snapshot_interval_hours", 24)
                if (
                    not request.git_versioning_enabled
                    or interval_hours <= 0
                    or request.database_type in {"mongodb", "redis"}
                    or not schema_versioning_service._has_selected_scopes(
                        request.database_type,
                        getattr(request, "git_versioning_scopes", []),
                    )
                ):
                    continue
                with self._scheduled_snapshot_guard:
                    if connection_id in self._scheduled_snapshot_connections:
                        continue

                last_captured_at = local_snapshot_history.get_last_scheduled_snapshot(connection_id)
                if last_captured_at is None:
                    baseline = github_oauth_service.read_repository_file(self.manifest_path(connection_id))
                    if baseline is None:
                        continue
                    baseline_manifest = self._parse_manifest(baseline.content)
                    last_captured_at = baseline_manifest.captured_at
                    local_snapshot_history.set_last_scheduled_snapshot(connection_id, last_captured_at)

                last_captured_time = datetime.fromisoformat(last_captured_at)
                if last_captured_time.tzinfo is None:
                    last_captured_time = last_captured_time.replace(tzinfo=timezone.utc)
                if (current_time - last_captured_time).total_seconds() < interval_hours * 3600:
                    continue
                if github_oauth_service.read_repository_file(self.manifest_path(connection_id)) is None:
                    continue

                with self._scheduled_snapshot_guard:
                    if connection_id in self._scheduled_snapshot_connections:
                        continue
                    self._scheduled_snapshot_connections.add(connection_id)
                git_task_registry.start(
                    connection_id,
                    "定时全库检查点",
                    lambda task, item=connection_id: self._run_scheduled_snapshot(item, task, current_time),
                )
            except Exception:
                with self._scheduled_snapshot_guard:
                    self._scheduled_snapshot_connections.discard(connection_id)
                logger.exception("启动定时数据库快照失败：connection_id=%s", connection_id)

    def _run_scheduled_snapshot(
        self, connection_id: str, task: GitTask, scheduled_at: datetime
    ) -> dict[str, object]:
        try:
            result = self._create_snapshot(connection_id, "定时全库快照", task)
            if not result.get("cancelled"):
                local_snapshot_history.set_last_scheduled_snapshot(
                    connection_id, datetime.now(timezone.utc).isoformat()
                )
            return result
        finally:
            with self._scheduled_snapshot_guard:
                self._scheduled_snapshot_connections.discard(connection_id)

    def _sync_pending_local_snapshots(self, connection_id: str, lock: Lock) -> None:
        with lock:
            while True:
                record = local_snapshot_history.oldest_pending(connection_id)
                if record is None:
                    return
                if record["status"] == "error":
                    if not local_snapshot_history.retry_failed(record["id"]):
                        return
                    continue
                if record["payload"] is None:
                    local_snapshot_history.update_status(
                        record["id"], "error", error="本机待同步快照无法读取"
                    )
                    return
                try:
                    baseline = github_oauth_service.read_repository_file(self.manifest_path(connection_id))
                    if baseline is None:
                        local_snapshot_history.update_status(record["id"], "local_only")
                        continue
                    archive = LocalDatabaseSnapshot.model_validate_json(
                        gzip.decompress(record["payload"]).decode("utf-8")
                    )
                    result = self._upload_local_snapshot(connection_id, archive)
                    local_snapshot_history.update_status(
                        record["id"],
                        "synced",
                        remote_commit_id=result.commit_sha,
                        remove_payload=True,
                    )
                except Exception as exc:
                    local_snapshot_history.update_status(record["id"], "error", error=str(exc))
                    return

    def _upload_local_snapshot(self, connection_id: str, archive: LocalDatabaseSnapshot) -> Any:
        if archive.snapshot_kind == "table_change":
            return self._upload_local_table_snapshot(connection_id, archive)
        if archive.schema_snapshot is None:
            raise ValueError("全库检查点缺少数据库结构快照")
        previous_file = github_oauth_service.read_repository_file(self.manifest_path(connection_id))
        if previous_file is None:
            raise ValueError("Git 数据库基线已不存在，自动快照保留在本机")
        previous_manifest = self._parse_manifest(previous_file.content)
        previous_entries = {item.get("path"): item for item in previous_manifest.tables}
        files: dict[str, bytes | str] = {}
        table_entries: list[dict[str, Any]] = []
        sql_sections: list[str] = []
        schema_sql = self._schema_changes(previous_manifest.schema_snapshot, archive.schema_snapshot)
        if schema_sql:
            sql_sections.append("-- DDL\n" + schema_sql)
            files[schema_versioning_service.snapshot_path(connection_id)] = (
                archive.schema_snapshot.model_dump_json(indent=2, ensure_ascii=False)
            )
        changed_table_count = 0
        engine = connection_manager.get_engine(connection_id)
        for table in archive.tables:
            path = self.table_path(connection_id, table.scope, table.table_name)
            table_entries.append({
                "scope": table.scope,
                "table_name": table.table_name,
                "path": path,
                "fingerprint": table.fingerprint,
                "row_count": len(table.rows),
            })
            previous_entry = previous_entries.get(path)
            if previous_entry and previous_entry.get("fingerprint") == table.fingerprint:
                continue
            changed_table_count += 1
            files[path] = gzip.compress(
                table.model_dump_json(ensure_ascii=False).encode("utf-8"),
                compresslevel=9,
                mtime=0,
            )
            previous_table = self._read_table_from_path(path)
            changes = (
                self._table_changes(previous_table, table, engine, table.scope)
                if engine is not None
                else "-- 本机写入前快照；数据库未打开，未生成 SQL 摘要"
            )
            if changes:
                sql_sections.append(f"-- {table.scope + '.' if table.scope else ''}{table.table_name}\n{changes}")
        manifest = DatabaseSnapshotManifest(
            connection_id=archive.connection_id,
            database_type=archive.schema_snapshot.database_type,
            captured_at=archive.captured_at,
            fingerprint=hashlib.sha256(
                json.dumps(
                    {
                        "schema": archive.schema_snapshot.fingerprint,
                        "tables": table_entries,
                        "skipped_tables": archive.skipped_tables,
                        "event": archive.captured_at,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest(),
            schema=archive.schema_snapshot,
            tables=table_entries,
            skipped_tables=archive.skipped_tables,
        )
        files[self.manifest_path(connection_id)] = manifest.model_dump_json(
            indent=2, ensure_ascii=False, by_alias=True
        )
        files[self.changes_path(connection_id)] = gzip.compress(
            ("\n\n".join(sql_sections) or "-- 本次操作前快照").encode("utf-8"),
            compresslevel=9,
            mtime=0,
        )
        message = self._commit_message(archive.reason, manifest, len(sqlparse.parse(schema_sql)), changed_table_count)
        return github_oauth_service.write_repository_files(files, message)

    def _upload_local_table_snapshot(
        self, connection_id: str, archive: LocalDatabaseSnapshot
    ) -> Any:
        files: dict[str, bytes | str] = {}
        sql_sections: list[str] = []
        engine = connection_manager.get_engine(connection_id)
        changed_tables: list[TableSnapshot] = []
        if archive.schema_snapshot is not None:
            schema_path = schema_versioning_service.snapshot_path(connection_id)
            previous_schema_file = github_oauth_service.read_repository_file(schema_path)
            previous_schema = (
                schema_versioning_service._parse_snapshot(previous_schema_file.content)
                if previous_schema_file is not None
                else None
            )
            schema_sql = self._schema_changes(previous_schema, archive.schema_snapshot)
            files[schema_path] = archive.schema_snapshot.model_dump_json(
                indent=2, ensure_ascii=False
            )
            if schema_sql:
                sql_sections.append("-- DDL\n" + schema_sql)
        for table in archive.tables:
            path = self.table_path(connection_id, table.scope, table.table_name)
            previous_table = self._read_table_from_path(path)
            if (
                previous_table
                and previous_table.fingerprint == table.fingerprint
                and archive.schema_snapshot is None
            ):
                continue
            changed_tables.append(table)
            files[path] = gzip.compress(
                table.model_dump_json(ensure_ascii=False).encode("utf-8"),
                compresslevel=9,
                mtime=0,
            )
            changes = (
                self._table_changes(previous_table, table, engine, table.scope)
                if engine is not None
                else "-- 本机写入前快照；数据库未打开，未生成 SQL 摘要"
            )
            if changes:
                sql_sections.append(
                    f"-- {table.scope + '.' if table.scope else ''}{table.table_name}\n{changes}"
                )
        if not files:
            return SimpleNamespace(commit_sha=None)
        files[self.changes_path(connection_id)] = gzip.compress(
            ("\n\n".join(sql_sections) or "-- 表数据未发生变化").encode("utf-8"),
            compresslevel=9,
            mtime=0,
        )
        table_names = ", ".join(table.table_name for table in changed_tables) or "结构"
        message = self._table_commit_message(archive.reason, table_names)
        return github_oauth_service.write_repository_files(files, message)

    def list_local_versions(self, connection_id: str, limit: int = 100) -> list[dict[str, Any]]:
        return local_snapshot_history.list(connection_id, limit, snapshot_kind="checkpoint")

    def list_local_table_versions(
        self, connection_id: str, scope: str | None, table_name: str, limit: int = 30
    ) -> list[dict[str, Any]]:
        self._ensure_enabled(connection_id, require_authorization=False)
        versions: list[dict[str, Any]] = []
        for record in local_snapshot_history.list(
            connection_id, 500, snapshot_kind="table_change"
        ):
            if record["status"] == "synced":
                continue
            payload = local_snapshot_history.get_payload(record["id"])
            if payload is None:
                continue
            try:
                archive = LocalDatabaseSnapshot.model_validate_json(
                    gzip.decompress(payload).decode("utf-8")
                )
            except (OSError, UnicodeDecodeError, ValueError):
                continue
            if not any(
                table.scope == scope and table.table_name == table_name
                for table in archive.tables
            ):
                continue
            versions.append(
                {
                    "id": record["id"],
                    "message": record["message"],
                    "committed_at": record["captured_at"],
                    "status": record["status"],
                    "remote_commit_id": record["remote_commit_id"],
                    "error": record["error"],
                }
            )
            if len(versions) >= max(1, min(limit, 100)):
                break
        return versions

    def retry_local_snapshot_sync(self, connection_id: str, snapshot_id: str) -> bool:
        record = local_snapshot_history.get_record(snapshot_id)
        if record is None or record["connection_id"] != connection_id:
            raise ValueError("找不到当前连接对应的本机快照")
        if local_snapshot_history.has_newer_snapshot(
            connection_id, snapshot_id, record["captured_at"]
        ):
            raise ValueError("已有较新的数据库快照，不能重试旧快照，以免远端最新版本倒退")
        if not github_oauth_service.status().authorized:
            raise ValueError("请先重新连接 GitHub，再重试同步")
        if not local_snapshot_history.retry_failed(snapshot_id):
            raise ValueError("该快照没有可重试的同步任务")
        self._start_local_snapshot_sync(connection_id)
        return True

    def restore_database_version(self, connection_id: str, version_id: str) -> dict[str, Any]:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("请先在连接设置中开启 Git 版本管理")
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法恢复历史数据")
        if engine.dialect.name in {"clickhouse", "clickhousedb"}:
            raise ValueError("ClickHouse 当前不支持数据库级事务恢复，请改用逐表恢复")

        current_snapshot_id = self.prepare_write_snapshot(connection_id, "恢复数据库版本前快照")
        try:
            archive, selected_commit = self._load_database_archive(connection_id, version_id)
            if archive.snapshot_kind != "checkpoint":
                raise ValueError("该版本是表级变更记录，不能用于整库恢复")
            if archive.schema_snapshot is None:
                raise ValueError("历史全库检查点缺少数据库结构快照")
            current_schema = schema_versioning_service._capture_snapshot(
                connection_id,
                request.database_type,
                engine,
                getattr(request, "git_versioning_scopes", []),
            )
            if current_schema.fingerprint != archive.schema_snapshot.fingerprint:
                raise ValueError("历史版本的表结构与当前结构不同，请先恢复对应结构后再恢复数据库数据")

            scopes = schema_versioning_service._selected_scopes(
                engine,
                request.database_type,
                getattr(request, "git_versioning_scopes", []),
            )
            current_targets = {
                (scope, table.name)
                for scope in scopes
                for table in list_tables(engine, scope, None, include_stats=False)
            }
            historical_targets = {(table.scope, table.table_name) for table in archive.tables}
            skipped_targets = {
                (item.get("scope"), item["table_name"])
                for item in archive.skipped_tables
                if item.get("table_name")
            }
            if current_targets != historical_targets | skipped_targets:
                raise ValueError("当前表清单与历史版本不同，请先恢复对应结构后再恢复数据库数据")

            current_tables = {
                (scope, table.name): self._capture_table(
                    engine, request.database_type, scope, table.name, None, None
                )
                for scope in scopes
                for table in list_tables(engine, scope, None, include_stats=False)
            }
            historical_tables = {(table.scope, table.table_name): table for table in archive.tables}
            changes_by_table: dict[tuple[str | None, str], list[str]] = {}
            for key, historical in historical_tables.items():
                current = current_tables[key]
                deletes, upserts = self._table_restore_statements(
                    current, historical, engine, historical.scope
                )
                changes_by_table[key] = deletes + upserts

            ordered_keys = self._restore_table_order(engine, list(historical_tables))
            deletes = [
                statement
                for key in reversed(ordered_keys)
                for statement in changes_by_table[key]
                if statement.lstrip().upper().startswith("DELETE")
            ]
            upserts = [
                statement
                for key in ordered_keys
                for statement in changes_by_table[key]
                if statement.lstrip().upper().startswith(("INSERT", "UPDATE"))
            ]
            with engine.begin() as connection:
                for statement in deletes + upserts:
                    connection.execute(text(statement))
            self.complete_write_snapshot(connection_id, current_snapshot_id, True)
            return {
                "version_id": version_id,
                "remote_commit_id": selected_commit,
                "restored_table_count": len(archive.tables),
                "skipped_table_count": len(skipped_targets),
                "skipped_tables": list(archive.skipped_tables),
                "executed_count": len(deletes) + len(upserts),
            }
        except Exception:
            self.complete_write_snapshot(connection_id, current_snapshot_id, False)
            raise

    def _load_database_archive(
        self, connection_id: str, version_id: str
    ) -> tuple[LocalDatabaseSnapshot, str | None]:
        record = local_snapshot_history.get_record(version_id)
        if record is not None:
            if record["connection_id"] != connection_id:
                raise ValueError("快照不属于当前连接")
            payload = local_snapshot_history.get_payload(version_id)
            if payload is not None:
                try:
                    return (
                        LocalDatabaseSnapshot.model_validate_json(gzip.decompress(payload).decode("utf-8")),
                        record["remote_commit_id"],
                    )
                except (OSError, UnicodeDecodeError, ValueError) as exc:
                    raise ValueError("本机数据库快照格式无效") from exc
            version_id = record["remote_commit_id"] or ""
            if not version_id:
                raise ValueError("该本机快照尚未成功同步，且本机快照数据不可用")

        manifest_file = github_oauth_service.read_repository_file(
            self.manifest_path(connection_id), ref=version_id
        )
        if manifest_file is None:
            raise ValueError("找不到指定的数据库版本")
        manifest = self._parse_manifest(manifest_file.content)
        tables: list[TableSnapshot] = []
        for entry in manifest.tables:
            content = github_oauth_service.read_repository_file_bytes(entry["path"], ref=version_id)
            if content is None:
                raise ValueError(f"历史版本缺少表快照：{entry.get('table_name', entry['path'])}")
            try:
                tables.append(TableSnapshot.model_validate_json(gzip.decompress(content).decode("utf-8")))
            except (OSError, UnicodeDecodeError, ValueError) as exc:
                raise ValueError("GitHub 中的数据库快照格式无效") from exc
        return (
            LocalDatabaseSnapshot(
                connection_id=connection_id,
                reason="Git 数据库版本",
                captured_at=manifest.captured_at,
                schema_snapshot=manifest.schema_snapshot,
                tables=tables,
                skipped_tables=manifest.skipped_tables,
            ),
            version_id,
        )

    @staticmethod
    def _restore_table_order(
        engine: Any, table_keys: list[tuple[str | None, str]]
    ) -> list[tuple[str | None, str]]:
        key_by_name = {
            ((scope or "").casefold(), name.casefold()): (scope, name)
            for scope, name in table_keys
        }
        dependencies: dict[tuple[str | None, str], set[tuple[str | None, str]]] = {
            key: set() for key in table_keys
        }
        inspector = inspect(engine)
        for scope, table_name in table_keys:
            try:
                foreign_keys = inspector.get_foreign_keys(table_name, schema=scope)
            except Exception:
                continue
            for foreign_key in foreign_keys:
                referred_table = foreign_key.get("referred_table")
                if not referred_table:
                    continue
                referred_scope = foreign_key.get("referred_schema") or scope
                dependency = key_by_name.get(((referred_scope or "").casefold(), referred_table.casefold()))
                if dependency and dependency != (scope, table_name):
                    dependencies[(scope, table_name)].add(dependency)

        ordered: list[tuple[str | None, str]] = []
        remaining = {key: set(values) for key, values in dependencies.items()}
        while remaining:
            ready = sorted(
                (key for key, values in remaining.items() if not values),
                key=lambda item: ((item[0] or "").casefold(), item[1].casefold()),
            )
            if not ready:
                ordered.extend(sorted(remaining, key=lambda item: ((item[0] or "").casefold(), item[1].casefold())))
                break
            ordered.extend(ready)
            for key in ready:
                remaining.pop(key)
            for values in remaining.values():
                values.difference_update(ready)
        return ordered

    def preview_snapshot(self, connection_id: str) -> DatabaseSnapshotPreview:
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法预览数据库 Git 快照")
        scopes = schema_versioning_service._selected_scopes(
            engine,
            request.database_type,
            getattr(request, "git_versioning_scopes", []),
        )
        tables: list[DatabaseSnapshotTablePreview] = []
        for scope in scopes:
            for table in list_tables(engine, scope, None, include_stats=True):
                tables.append(
                    DatabaseSnapshotTablePreview(
                        scope=scope or "默认库",
                        table_name=table.name,
                        estimated_row_count=table.row_count,
                        estimated_storage_size_bytes=table.storage_size_bytes or table.size_bytes,
                    )
                )
        estimated_row_count = (
            sum(table.estimated_row_count or 0 for table in tables)
            if all(table.estimated_row_count is not None for table in tables)
            else None
        )
        estimated_storage_size_bytes = (
            sum(table.estimated_storage_size_bytes or 0 for table in tables)
            if all(table.estimated_storage_size_bytes is not None for table in tables)
            else None
        )
        return DatabaseSnapshotPreview(
            scopes=[scope or "默认库" for scope in scopes],
            tables=tables,
            estimated_row_count=estimated_row_count,
            estimated_storage_size_bytes=estimated_storage_size_bytes,
        )

    def create_snapshot_async(self, connection_id: str, reason: str = "初始化数据库 Git 快照") -> DatabaseSnapshotResult:
        task = git_task_registry.start(connection_id, "数据库 Git 快照", lambda item: self._create_snapshot(connection_id, reason, item))
        return DatabaseSnapshotResult(
            id=task.id,
            task_id=task.id,
            status=task.status,
            percent=task.percent,
            detail=task.detail,
        )

    def create_table_snapshot_async(
        self,
        connection_id: str,
        scope: str | None,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
        reason: str = "保存表格数据",
        capture_schema: bool = False,
    ) -> DatabaseSnapshotResult:
        task = git_task_registry.start(
            connection_id,
            f"表 Git 快照 · {table_name}",
            lambda item: self._create_table_snapshot(
                connection_id, scope, table_name, database, pg_database, reason, item, capture_schema
            ),
        )
        return DatabaseSnapshotResult(
            id=task.id,
            task_id=task.id,
            status=task.status,
            percent=task.percent,
            detail=task.detail,
        )

    def schedule_snapshot(self, connection_id: str, reason: str) -> None:
        """仅在用户已经建立过基线后响应结构或数据变更。"""
        try:
            self._ensure_enabled(connection_id)
            if github_oauth_service.read_repository_file(self.manifest_path(connection_id)) is None:
                return
            self.create_snapshot_async(connection_id, reason)
        except Exception:
            # 自动提交不能影响用户刚刚完成的数据库操作，失败信息由后台任务或日志记录。
            return

    def schedule_table_snapshot(
        self,
        background_tasks: object,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
        reason: str = "保存表格数据",
        capture_schema: bool = False,
    ) -> None:
        """表级变更只提交目标表，需要时附带结构快照。"""
        try:
            request = self._ensure_enabled(connection_id)
            if github_oauth_service.read_repository_file(self.manifest_path(connection_id)) is None:
                return
            add_task = getattr(background_tasks, "add_task", None)
            if callable(add_task):
                add_task(
                    self.create_table_snapshot_async,
                    connection_id,
                    self._table_scope(request.database_type, database),
                    table_name,
                    database,
                    pg_database,
                    reason,
                    capture_schema,
                )
        except Exception:
            return

    def _create_table_snapshot(
        self,
        connection_id: str,
        scope: str | None,
        table_name: str,
        database: str | None,
        pg_database: str | None,
        reason: str,
        task: GitTask,
        capture_schema: bool = False,
    ) -> dict[str, object]:
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法创建 Git 快照")
        task.total = 100
        task.current = 10
        task.detail = f"正在读取并压缩表 {table_name}"
        path = self.table_path(connection_id, scope, table_name)
        previous_manifest_file = github_oauth_service.read_repository_file(self.manifest_path(connection_id))
        if previous_manifest_file is None:
            return {"changed": False}
        previous_table = self._read_table_from_path(path)
        current_table = self._capture_table(engine, request.database_type, scope, table_name, database, pg_database)
        schema_snapshot = (
            schema_versioning_service._capture_snapshot(
                connection_id,
                request.database_type,
                engine,
                getattr(request, "git_versioning_scopes", []),
            )
            if capture_schema
            else None
        )
        schema_sql = ""
        if schema_snapshot is not None:
            schema_path = schema_versioning_service.snapshot_path(connection_id)
            previous_schema_file = github_oauth_service.read_repository_file(schema_path)
            previous_schema = (
                schema_versioning_service._parse_snapshot(previous_schema_file.content)
                if previous_schema_file is not None
                else self._parse_manifest(previous_manifest_file.content).schema_snapshot
            )
            schema_sql = self._schema_changes(previous_schema, schema_snapshot)
        schema_changed = bool(schema_sql)
        if (
            previous_table is not None
            and previous_table.fingerprint == current_table.fingerprint
            and not schema_changed
        ):
            task.current = 99
            task.detail = "远端已是最新快照，无需上传"
            return {"commit_sha": previous_manifest_file.sha, "changed": False, "table_name": table_name}

        sql = self._table_changes(previous_table, current_table, engine, scope) or "-- 数据没有变化"
        task.current = 70
        task.detail = "正在生成变更 SQL"
        files: dict[str, bytes | str] = {
            path: gzip.compress(current_table.model_dump_json(ensure_ascii=False).encode("utf-8"), compresslevel=9, mtime=0),
            self.changes_path(connection_id): gzip.compress(f"-- {scope + '.' if scope else ''}{table_name}\n{sql}".encode("utf-8"), compresslevel=9, mtime=0),
        }
        if schema_snapshot is not None:
            files[schema_versioning_service.snapshot_path(connection_id)] = schema_snapshot.model_dump_json(
                indent=2, ensure_ascii=False
            )
            if schema_sql:
                files[self.changes_path(connection_id)] = gzip.compress(
                    f"-- DDL\n{schema_sql}\n\n-- {scope + '.' if scope else ''}{table_name}\n{sql}".encode("utf-8"),
                    compresslevel=9,
                    mtime=0,
                )
        task.current = 90
        task.detail = f"正在上传表 {table_name} 的快照"
        result = github_oauth_service.write_repository_files(files, self._table_commit_message(reason, table_name))
        task.current = 99
        task.detail = f"远端提交完成：表 {table_name}"
        return {"commit_sha": result.commit_sha, "changed": True, "table_name": table_name}

    def list_versions(self, connection_id: str, limit: int = 30) -> list[dict[str, Any]]:
        self._ensure_enabled(connection_id)
        return [
            {"id": commit.sha, "message": self._history_message(commit.message), "committed_at": commit.committed_at}
            for commit in github_oauth_service.list_repository_commits(self.manifest_path(connection_id), per_page=limit)
        ]

    def list_table_versions(self, connection_id: str, scope: str | None, table_name: str, limit: int = 30) -> list[dict[str, Any]]:
        self._ensure_enabled(connection_id)
        path = self.table_path(connection_id, scope, table_name)
        return [
            {"id": commit.sha, "message": self._history_message(commit.message), "committed_at": commit.committed_at}
            for commit in github_oauth_service.list_repository_commits(path, per_page=limit)
        ]

    def get_table_snapshot(self, connection_id: str, scope: str | None, table_name: str, version_id: str | None = None) -> TableSnapshot:
        local_record = local_snapshot_history.get_record(version_id) if version_id else None
        if local_record is not None:
            if local_record["connection_id"] != connection_id:
                raise ValueError("本机快照不属于当前连接")
            if local_record["snapshot_kind"] == "table_change":
                self._ensure_enabled(connection_id, require_authorization=False)
                payload = local_snapshot_history.get_payload(version_id)
                if payload is None:
                    raise ValueError("本机表快照数据不可用")
                try:
                    archive = LocalDatabaseSnapshot.model_validate_json(
                        gzip.decompress(payload).decode("utf-8")
                    )
                except (OSError, UnicodeDecodeError, ValueError) as exc:
                    raise ValueError("本机表快照格式无效") from exc
                snapshot = next(
                    (
                        item
                        for item in archive.tables
                        if item.scope == scope and item.table_name == table_name
                    ),
                    None,
                )
                if snapshot is None:
                    raise ValueError("本机快照中找不到指定表")
                return snapshot
        self._ensure_enabled(connection_id)
        content = github_oauth_service.read_repository_file_bytes(self.table_path(connection_id, scope, table_name), ref=version_id)
        if content is None:
            raise ValueError("找不到指定的数据版本")
        try:
            return TableSnapshot.model_validate_json(gzip.decompress(content).decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            raise ValueError("GitHub 中的数据快照格式无效") from exc

    def get_table_version_details(
        self, connection_id: str, scope: str | None, table_name: str, version_id: str
    ) -> dict[str, Any]:
        snapshot = self.get_table_snapshot(connection_id, scope, table_name, version_id)
        changes = self._extract_table_changes(
            self._read_changes(connection_id, version_id), scope, table_name
        )
        snapshot_payload = snapshot.model_dump()
        snapshot_payload["rows"] = [_snapshot_display_row(row) for row in snapshot.rows]
        return {"version_id": version_id, "snapshot": snapshot_payload, "changes_sql": changes}

    def diff_table_version(
        self, connection_id: str, scope: str | None, table_name: str, version_id: str
    ) -> dict[str, Any]:
        historical = self.get_table_snapshot(connection_id, scope, table_name, version_id)
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法比对历史数据")
        current = self._capture_table(engine, request.database_type, scope, table_name, None, None)
        return self._row_diff(historical, current, version_id)

    def restore_table_version(
        self, connection_id: str, scope: str | None, table_name: str, version_id: str, pg_database: str | None = None
    ) -> dict[str, Any]:
        historical = self.get_table_snapshot(connection_id, scope, table_name, version_id)
        local_record = local_snapshot_history.get_record(version_id)
        is_local_snapshot = bool(
            local_record
            and local_record["connection_id"] == connection_id
            and local_record["snapshot_kind"] == "table_change"
        )
        request = self._ensure_enabled(
            connection_id, require_authorization=not is_local_snapshot
        )
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法恢复历史数据")
        snapshot_id = self.prepare_write_snapshot(
            connection_id,
            "恢复历史数据前快照",
            affected_tables=[(scope, table_name, scope, pg_database)],
        )
        if snapshot_id is None:
            raise ValueError("无法创建恢复前保护快照，未执行数据恢复")
        try:
            current = self._capture_table(engine, request.database_type, scope, table_name, scope, pg_database)
            with engine.begin() as connection:
                qualified = self._qualified_table(historical, engine, scope)
                connection.execute(text(f"DELETE FROM {qualified}"))
                self._insert_snapshot_rows(connection, historical, engine, scope)
            self.complete_write_snapshot(connection_id, snapshot_id, True)
        except Exception:
            self.complete_write_snapshot(connection_id, snapshot_id, False)
            raise
        task_id: str | None = None
        try:
            if github_oauth_service.read_repository_file(self.manifest_path(connection_id)) is not None:
                task_id = self.create_table_snapshot_async(
                    connection_id,
                    scope,
                    table_name,
                    scope,
                    pg_database,
                    "恢复历史数据",
                ).task_id
        except Exception:
            task_id = None
        return {
            "version_id": version_id,
            "table_name": table_name,
            "executed_count": len(current.rows) + len(historical.rows),
            "task_id": task_id,
        }

    def restore_table_structure(
        self, connection_id: str, scope: str | None, table_name: str, version_id: str
    ) -> dict[str, Any]:
        target_schema = self._schema_at_version(connection_id, version_id)
        target = next(
            (item for item in target_schema.objects if item.name == table_name and item.scope == scope and item.type == "table"),
            None,
        )
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法恢复历史结构")
        current_schema = schema_versioning_service._capture_snapshot(
            connection_id, request.database_type, engine, getattr(request, "git_versioning_scopes", [])
        )
        current = next(
            (item for item in current_schema.objects if item.name == table_name and item.scope == scope and item.type == "table"),
            None,
        )
        if target is None and current is None:
            return {"version_id": version_id, "table_name": table_name, "changed": False, "action": "unchanged"}
        changed = current is None or target is None or current.ddl != target.ddl
        if not changed:
            return {"version_id": version_id, "table_name": table_name, "changed": False, "action": "unchanged"}

        current_data = (
            self._capture_table(engine, request.database_type, scope, table_name, scope, None)
            if current is not None
            else None
        )
        snapshot_id = self.prepare_write_snapshot(
            connection_id,
            "恢复历史结构前快照",
            affected_tables=[(scope, table_name, scope, None)] if current is not None else [],
            capture_schema=True,
        )
        if snapshot_id is None:
            raise ValueError("无法创建恢复前保护快照，未执行结构恢复")
        preparer = engine.dialect.identifier_preparer
        qualified = f"{preparer.quote(scope)}.{preparer.quote(table_name)}" if scope else preparer.quote(table_name)
        try:
            with engine.begin() as connection:
                if current is not None:
                    connection.execute(text(f"DROP TABLE {qualified}"))
                if target is not None:
                    statements = [str(statement).strip() for statement in sqlparse.parse(target.ddl) if str(statement).strip()]
                    for statement in statements:
                        connection.execute(text(statement))
                    if current_data is not None:
                        target_columns = inspect(connection).get_columns(table_name, schema=scope)
                        writable_columns = [
                            column["name"]
                            for column in target_columns
                            if not column.get("computed") and not column.get("identity")
                        ]
                        retained_columns = [
                            column for column in writable_columns if column in current_data.columns
                        ]
                        self._insert_snapshot_rows(
                            connection, current_data, engine, scope, retained_columns
                        )
            self.complete_write_snapshot(connection_id, snapshot_id, True)
        except Exception:
            self.complete_write_snapshot(connection_id, snapshot_id, False)
            raise
        return {
            "version_id": version_id,
            "table_name": table_name,
            "changed": changed,
            "action": "created" if current is None and target is not None else "dropped" if target is None else "recreated",
        }

    def _schema_at_version(self, connection_id: str, version_id: str) -> SchemaSnapshot:
        snapshot = github_oauth_service.read_repository_file(
            schema_versioning_service.snapshot_path(connection_id), ref=version_id
        )
        if snapshot is not None:
            return schema_versioning_service._parse_snapshot(snapshot.content)
        manifest = github_oauth_service.read_repository_file(self.manifest_path(connection_id), ref=version_id)
        if manifest is not None:
            return self._parse_manifest(manifest.content).schema_snapshot
        raise ValueError("找不到指定的结构版本")

    def _read_changes(self, connection_id: str, version_id: str) -> str:
        content = github_oauth_service.read_repository_file_bytes(self.changes_path(connection_id), ref=version_id)
        if content is None:
            return ""
        try:
            return gzip.decompress(content).decode("utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise ValueError("GitHub 中的变更 SQL 格式无效") from exc

    @staticmethod
    def _extract_table_changes(changes: str, scope: str | None, table_name: str) -> str:
        marker = f"-- {scope + '.' if scope else ''}{table_name}"
        lines = changes.splitlines()
        for index, line in enumerate(lines):
            if line.strip() == marker:
                next_marker = next(
                    (position for position in range(index + 1, len(lines)) if lines[position].startswith("-- ")),
                    len(lines),
                )
                return "\n".join(lines[index + 1 : next_marker]).strip()
        return ""

    @classmethod
    def _row_diff(cls, historical: TableSnapshot, current: TableSnapshot, version_id: str) -> dict[str, Any]:
        if not historical.identity_columns or historical.identity_columns != current.identity_columns:
            raise ValueError("该历史快照没有稳定的主键或唯一键，无法生成行级差异")
        old = cls._rows_by_identity(historical.rows, historical.identity_columns)
        new = cls._rows_by_identity(current.rows, current.identity_columns)
        added = [
            {
                "identity": _snapshot_display_row(cls._identity_values(row, historical.identity_columns)),
                "after": _snapshot_display_row(row),
                "changed_columns": [],
            }
            for key, row in new.items()
            if key not in old
        ]
        deleted = [
            {
                "identity": _snapshot_display_row(cls._identity_values(row, historical.identity_columns)),
                "before": _snapshot_display_row(row),
                "changed_columns": [],
            }
            for key, row in old.items()
            if key not in new
        ]
        updated = [
            {
                "identity": _snapshot_display_row(cls._identity_values(row, historical.identity_columns)),
                "before": _snapshot_display_row(old[key]),
                "after": _snapshot_display_row(row),
                "changed_columns": [
                    column
                    for column in current.columns
                    if column not in historical.identity_columns and old[key].get(column) != row.get(column)
                ],
            }
            for key, row in new.items()
            if key in old and old[key] != row
        ]
        return {
            "version_id": version_id,
            "table_name": current.table_name,
            "identity_columns": historical.identity_columns,
            "added": added,
            "deleted": deleted,
            "updated": updated,
            "added_count": len(added),
            "deleted_count": len(deleted),
            "updated_count": len(updated),
        }

    def _create_snapshot(self, connection_id: str, reason: str, task: GitTask) -> dict[str, object]:
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法创建 Git 快照")
        selected_scopes = getattr(request, "git_versioning_scopes", [])
        scopes = schema_versioning_service._selected_scopes(engine, request.database_type, selected_scopes)
        table_targets: list[tuple[str | None, str, str | None, str | None]] = []
        for scope in scopes:
            for table in list_tables(engine, scope, None, include_stats=False):
                table_targets.append((scope, table.name, None, None))
        table_count = len(table_targets)
        task.total = 100
        task.current = 2
        task.detail = f"扫描完成：发现 {table_count} 张表，正在读取结构"
        schema = schema_versioning_service._capture_snapshot(connection_id, request.database_type, engine, selected_scopes)
        task.current = 5
        task.detail = "结构读取完成，准备并行读取数据"
        previous_manifest_file = github_oauth_service.read_repository_file(self.manifest_path(connection_id))
        previous_manifest = self._parse_manifest(previous_manifest_file.content) if previous_manifest_file else None
        previous_tables = {item.get("path"): item for item in (previous_manifest.tables if previous_manifest else [])}
        files: dict[str, bytes | str] = {}
        table_entries: list[dict[str, Any]] = []
        sql_sections: list[str] = []
        schema_sql = self._schema_changes(previous_manifest.schema_snapshot if previous_manifest else None, schema)
        schema_change_count = len([statement for statement in sqlparse.parse(schema_sql) if str(statement).strip()])
        if schema_sql:
            sql_sections.append("-- DDL\n" + schema_sql)
            files[schema_versioning_service.snapshot_path(connection_id)] = schema.model_dump_json(
                indent=2, ensure_ascii=False
            )

        task.detail = f"正在并行读取 {table_count} 张表的数据（并压缩）"
        captured_tables: dict[int, TableSnapshot] = {}
        captured_size_bytes = 0
        with ThreadPoolExecutor(
            max_workers=min(MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS, max(1, len(table_targets))),
            thread_name_prefix="datadjinn-snapshot",
        ) as executor:
            futures = {
                executor.submit(
                    self._capture_table,
                    engine,
                    request.database_type,
                    scope,
                    table_name,
                    database,
                    pg_database,
                ): index
                for index, (scope, table_name, database, pg_database) in enumerate(table_targets, start=1)
            }
            for completed, future in enumerate(as_completed(futures), start=1):
                if task.cancel_requested:
                    for pending in futures:
                        pending.cancel()
                    return {"cancelled": True}
                index = futures[future]
                captured_table = future.result()
                captured_size_bytes += len(
                    captured_table.model_dump_json(ensure_ascii=False).encode("utf-8")
                )
                if captured_size_bytes > MAX_DATABASE_SNAPSHOT_UNCOMPRESSED_BYTES:
                    for pending in futures:
                        pending.cancel()
                    raise ValueError("纳管范围内的数据快照超过 50 MB 上限，请缩小纳管范围后重试")
                captured_tables[index] = captured_table
                task.current = 5 + (completed * 70 // max(1, table_count))
                task.detail = f"正在读取并压缩数据：{completed}/{table_count} 张表"

        task.current = 76
        task.detail = "数据读取完成，正在生成变更 SQL"
        changed_table_count = 0
        for index, (scope, table_name, database, pg_database) in enumerate(table_targets, start=1):
            if task.cancel_requested:
                return {"cancelled": True}
            table_snapshot = captured_tables[index]
            path = self.table_path(connection_id, scope, table_name)
            table_entries.append({"scope": scope, "table_name": table_name, "path": path, "fingerprint": table_snapshot.fingerprint, "row_count": len(table_snapshot.rows)})
            previous_entry = previous_tables.get(path)
            if previous_entry and previous_entry.get("fingerprint") == table_snapshot.fingerprint:
                continue
            changed_table_count += 1
            files[path] = gzip.compress(table_snapshot.model_dump_json(ensure_ascii=False).encode("utf-8"), compresslevel=9, mtime=0)
            previous_snapshot = self._read_table_from_path(path)
            sql = self._table_changes(previous_snapshot, table_snapshot, engine, scope)
            if sql:
                sql_sections.append(f"-- {scope + '.' if scope else ''}{table_name}\n{sql}")
            task.current = 76 + (index * 14 // max(1, table_count))

        captured_at = datetime.now(timezone.utc).isoformat()
        manifest = DatabaseSnapshotManifest(
            connection_id=connection_id,
            database_type=request.database_type,
            captured_at=captured_at,
            fingerprint=hashlib.sha256(json.dumps({"schema": schema.fingerprint, "tables": table_entries}, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
            schema=schema,
            tables=table_entries,
        )
        sql_text = "\n\n".join(sql_sections) or "-- 数据和结构没有变化"
        if previous_manifest and previous_manifest.fingerprint == manifest.fingerprint and previous_manifest_file:
            task.current = 99
            task.detail = "远端已是最新快照，无需上传"
            return {"commit_sha": previous_manifest_file.sha, "table_count": len(table_targets), "changed": False}
        files[self.manifest_path(connection_id)] = manifest.model_dump_json(indent=2, ensure_ascii=False, by_alias=True)
        files[self.changes_path(connection_id)] = gzip.compress(sql_text.encode("utf-8"), compresslevel=9, mtime=0)
        message = self._commit_message(reason, manifest, schema_change_count, changed_table_count)
        task.current = 92
        task.detail = "正在上传快照文件并更新远端分支"
        result = github_oauth_service.write_repository_files(files, message)
        task.current = 99
        task.detail = f"远端提交完成：已提交 {len(table_targets)} 张表"
        return {"commit_sha": result.commit_sha, "table_count": len(table_targets), "manifest_path": self.manifest_path(connection_id)}

    def _capture_table(
        self,
        engine: Any,
        database_type: str,
        scope: str | None,
        table_name: str,
        database: str | None,
        pg_database: str | None,
        columns: list[Any] | None = None,
    ) -> TableSnapshot:
        columns = columns if columns is not None else list_columns(engine, table_name, database or scope, pg_database)
        identity_columns = [column.name for column in columns if column.primary_key] or [column.name for column in columns if column.unique][:1]
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = preview_table(
                engine,
                table_name,
                1000,
                offset,
                database or scope,
                pg_database,
                sort_column=identity_columns[0] if identity_columns else None,
                sort_direction="ascend" if identity_columns else None,
                preserve_sql_types=True,
            )
            if len(rows) + len(page.rows) > MAX_TABLE_SNAPSHOT_ROWS:
                raise ValueError(
                    f"表 {table_name} 超过 Git 快照上限 {MAX_TABLE_SNAPSHOT_ROWS} 行，未创建快照"
                )
            rows.extend(
                {column: _encode_snapshot_value(value) for column, value in row.items()}
                for row in page.rows
            )
            if not page.limited or not page.rows:
                break
            offset += len(page.rows)
        fingerprint = hashlib.sha256(json.dumps({"columns": [column.name for column in columns], "rows": rows}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        snapshot = TableSnapshot(table_name=table_name, scope=scope, database=database, pg_database=pg_database, captured_at=datetime.now(timezone.utc).isoformat(), columns=[column.name for column in columns], identity_columns=identity_columns, rows=rows, fingerprint=fingerprint)
        snapshot_size = len(snapshot.model_dump_json(ensure_ascii=False).encode("utf-8"))
        if snapshot_size > MAX_TABLE_SNAPSHOT_BYTES:
            raise ValueError(
                f"表 {table_name} 的快照超过 Git 快照上限 {MAX_TABLE_SNAPSHOT_BYTES} 字节，未创建快照"
            )
        return snapshot

    def _read_table_from_path(self, path: str) -> TableSnapshot | None:
        content = github_oauth_service.read_repository_file_bytes(path)
        if content is None:
            return None
        try:
            return TableSnapshot.model_validate_json(gzip.decompress(content).decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            return None

    @staticmethod
    def _parse_manifest(content: str) -> DatabaseSnapshotManifest:
        try:
            return DatabaseSnapshotManifest.model_validate_json(content)
        except ValueError as exc:
            raise ValueError("GitHub 中的数据库快照格式无效") from exc

    @staticmethod
    def _schema_changes(previous: SchemaSnapshot | None, current: SchemaSnapshot) -> str:
        if previous is None:
            return "\n\n".join(item.ddl.rstrip(";") + ";" for item in current.objects)
        old = {(item.scope, item.type, item.name): item.ddl for item in previous.objects}
        new = {(item.scope, item.type, item.name): item.ddl for item in current.objects}
        lines = [ddl.rstrip(";") + ";" for key, ddl in new.items() if old.get(key) != ddl]
        lines.extend(f"-- 对象已删除：{key[1]} {key[2]}" for key in old.keys() - new.keys())
        return "\n\n".join(lines)

    @classmethod
    def _table_changes(cls, previous: TableSnapshot | None, current: TableSnapshot, engine: Any, scope: str | None) -> str:
        if previous is None or not previous.identity_columns or previous.identity_columns != current.identity_columns:
            return cls._insert_sql(current, engine, scope)
        old = cls._rows_by_identity(previous.rows, previous.identity_columns)
        new = cls._rows_by_identity(current.rows, current.identity_columns)
        statements: list[str] = []
        for key, row in new.items():
            if key not in old:
                statements.append(cls._insert_statement(current, row, engine, scope))
            elif old[key] != row:
                assignments = ", ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column), engine)}" for column in current.columns if column not in current.identity_columns and old[key].get(column) != row.get(column))
                if assignments:
                    where = " AND ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column), engine)}" for column in current.identity_columns)
                    statements.append(f"UPDATE {cls._qualified_table(current, engine, scope)} SET {assignments} WHERE {where};")
        for key, row in old.items():
            if key not in new:
                where = " AND ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column), engine)}" for column in previous.identity_columns)
                statements.append(f"DELETE FROM {cls._qualified_table(current, engine, scope)} WHERE {where};")
        return "\n".join(statements)

    @classmethod
    def _table_restore_statements(
        cls,
        current: TableSnapshot,
        historical: TableSnapshot,
        engine: Any,
        scope: str | None,
    ) -> tuple[list[str], list[str]]:
        if current.identity_columns and current.identity_columns == historical.identity_columns:
            cls._rows_by_identity(current.rows, current.identity_columns)
            cls._rows_by_identity(historical.rows, historical.identity_columns)
            sql = cls._table_changes(current, historical, engine, scope)
            statements = [str(statement).strip() for statement in sqlparse.parse(sql) if str(statement).strip()]
            return (
                [statement for statement in statements if statement.lstrip().upper().startswith("DELETE")],
                [
                    statement
                    for statement in statements
                    if statement.lstrip().upper().startswith(("INSERT", "UPDATE"))
                ],
            )
        qualified = cls._qualified_table(historical, engine, scope)
        return (
            [f"DELETE FROM {qualified}"],
            [cls._insert_statement(historical, row, engine, scope) for row in historical.rows],
        )

    @classmethod
    def _insert_sql(cls, snapshot: TableSnapshot, engine: Any, scope: str | None) -> str:
        return "\n".join(cls._insert_statement(snapshot, row, engine, scope) for row in snapshot.rows)

    @classmethod
    def _insert_statement(cls, snapshot: TableSnapshot, row: dict[str, Any], engine: Any, scope: str | None) -> str:
        quote = engine.dialect.identifier_preparer.quote
        columns = ", ".join(quote(column) for column in snapshot.columns)
        values = ", ".join(cls._literal(row.get(column), engine) for column in snapshot.columns)
        return f"INSERT INTO {cls._qualified_table(snapshot, engine, scope)} ({columns}) VALUES ({values});"

    @classmethod
    def _insert_snapshot_rows(
        cls,
        connection: Any,
        snapshot: TableSnapshot,
        engine: Any,
        scope: str | None,
        columns: list[str] | None = None,
    ) -> None:
        requested_columns = snapshot.columns if columns is None else columns
        selected_columns = [column for column in requested_columns if column in snapshot.columns]
        quote = engine.dialect.identifier_preparer.quote
        table = cls._qualified_table(snapshot, engine, scope)
        if not selected_columns:
            for _ in snapshot.rows:
                connection.execute(text(f"INSERT INTO {table} DEFAULT VALUES"))
            return

        parameter_names = [f"value_{index}" for index in range(len(selected_columns))]
        statement = text(
            f"INSERT INTO {table} ({', '.join(quote(column) for column in selected_columns)}) "
            f"VALUES ({', '.join(f':{name}' for name in parameter_names)})"
        )
        values = [
            {
                name: _snapshot_bind_value(row.get(column))
                for name, column in zip(parameter_names, selected_columns, strict=True)
            }
            for row in snapshot.rows
        ]
        if values:
            connection.execute(statement, values)

    @staticmethod
    def _qualified_table(snapshot: TableSnapshot, engine: Any, scope: str | None) -> str:
        quote = engine.dialect.identifier_preparer.quote
        return f"{quote(scope)}.{quote(snapshot.table_name)}" if scope else quote(snapshot.table_name)

    @staticmethod
    def _identity_values(row: dict[str, Any], columns: list[str]) -> dict[str, Any]:
        return {column: row.get(column) for column in columns}

    @staticmethod
    def _table_scope(database_type: str, database: str | None) -> str | None:
        return database if database_type in {"mysql", "clickhouse", "postgresql", "gaussdb", "dm", "oracle"} else None

    def table_snapshot_target(
        self,
        connection_id: str,
        table_name: str,
        database: str | None = None,
        pg_database: str | None = None,
    ) -> tuple[str | None, str, str | None, str | None]:
        request = connection_manager.get_connection_request(connection_id)
        return (
            self._table_scope(request.database_type, database),
            table_name,
            database,
            pg_database,
        )

    @staticmethod
    def _row_key(row: dict[str, Any], columns: list[str]) -> str:
        return json.dumps({column: row.get(column) for column in columns}, ensure_ascii=False, sort_keys=True, default=str)

    @classmethod
    def _rows_by_identity(cls, rows: list[dict[str, Any]], columns: list[str]) -> dict[str, dict[str, Any]]:
        indexed_rows: dict[str, dict[str, Any]] = {}
        for row in rows:
            key = cls._row_key(row, columns)
            if key in indexed_rows:
                raise ValueError("快照中存在重复的主键或唯一键，无法安全处理行级版本")
            indexed_rows[key] = row
        return indexed_rows

    @staticmethod
    def _literal(value: Any, engine: Any | None = None) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, dict) and value.get(SNAPSHOT_VALUE_TYPE_KEY) == "decimal":
            try:
                decimal_value = Decimal(value["value"])
            except (InvalidOperation, KeyError, TypeError) as exc:
                raise ValueError("快照中的 Decimal 值格式无效") from exc
            if not decimal_value.is_finite():
                raise ValueError("快照中的 Decimal 值不是有限数")
            return str(decimal_value)
        if isinstance(value, dict) and value.get(SNAPSHOT_VALUE_TYPE_KEY) == "bytes":
            try:
                binary_value = base64.b64decode(value["value"], validate=True)
            except (ValueError, KeyError, TypeError) as exc:
                raise ValueError("快照中的二进制值格式无效") from exc
            hexadecimal = binary_value.hex()
            dialect = engine.dialect.name if engine is not None else ""
            if dialect in {"sqlite", "mysql", "mariadb"}:
                return f"X'{hexadecimal}'"
            if dialect in {"postgresql", "gaussdb"}:
                encoded = base64.b64encode(binary_value).decode("ascii")
                return f"decode('{encoded}', 'base64')"
            if dialect in {"dm", "dmPython", "oracle"}:
                return f"HEXTORAW('{hexadecimal}')"
            if dialect in {"clickhouse", "clickhousedb"}:
                return f"unhex('{hexadecimal}')"
            raise ValueError("当前数据库类型无法生成二进制恢复 SQL")
        if isinstance(value, dict) and value.get(SNAPSHOT_VALUE_TYPE_KEY) == "object":
            value = _decode_snapshot_value(value)
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        return "'" + str(value).replace("'", "''") + "'"

    @staticmethod
    def _commit_message(
        reason: str, manifest: DatabaseSnapshotManifest, schema_change_count: int, changed_table_count: int
    ) -> str:
        normalized = reason.strip() or "更新数据库 Git 快照"
        return (
            f"DataDjinn: {normalized}（{len(manifest.tables)} 张表，"
            f"结构变更 {schema_change_count} 项，数据变更 {changed_table_count} 张表）"
        )

    @staticmethod
    def _table_commit_message(reason: str, table_name: str) -> str:
        normalized = reason.strip() or "更新表数据 Git 快照"
        return f"DataDjinn: {normalized}（表 {table_name}，数据变更 1 张表）"

    @staticmethod
    def _history_message(message: str) -> str:
        """旧版本曾将 SQL 写入 commit message，这里只向界面暴露概要首行。"""
        return next((line.strip() for line in message.splitlines() if line.strip()), "DataDjinn: 数据库 Git 快照")

    @staticmethod
    def _ensure_enabled(connection_id: str, *, require_authorization: bool = True) -> Any:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("请先在连接设置中开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持 Git 数据版本管理")
        if require_authorization and not github_oauth_service.status().authorized:
            raise ValueError("请先在设置的“同步与版本”中登录 GitHub")
        return request


database_versioning_service = DatabaseVersioningService()


def task_to_model(task: GitTask) -> DatabaseSnapshotTask:
    return DatabaseSnapshotTask(
        id=task.id,
        connection_id=task.connection_id,
        title=task.title,
        status=task.status,
        current=task.current,
        total=task.total,
        percent=task.percent,
        detail=task.detail,
        error=task.error,
        started_at=task.started_at,
        finished_at=task.finished_at,
        result=task.result,
    )
