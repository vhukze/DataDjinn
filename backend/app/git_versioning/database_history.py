from __future__ import annotations

import gzip
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import sqlparse
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.db.connection_manager import connection_manager
from app.db.metadata import get_object_ddl, list_columns, list_db_objects, list_tables
from app.db.readonly_query import preview_table
from app.git_sync.github_oauth import github_oauth_service
from app.git_versioning.schema_history import SchemaSnapshot, SchemaSnapshotObject, schema_versioning_service
from app.git_versioning.task_progress import GitTask, git_task_registry


DATABASE_SNAPSHOT_FORMAT = "datadjinn-database-snapshot"
DATABASE_SNAPSHOT_VERSION = 1
MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS = 4


class DatabaseSnapshotResult(BaseModel):
    id: str
    task_id: str
    status: str
    percent: int = 0
    detail: str = "准备开始"


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
    fingerprint: str
    schema_snapshot: SchemaSnapshot = Field(alias="schema")
    tables: list[dict[str, Any]] = Field(default_factory=list)


class DatabaseVersioningService:
    def manifest_path(self, connection_id: str) -> str:
        return f"versioning/database/{connection_id}/manifest.json"

    def table_path(self, connection_id: str, scope: str | None, table_name: str) -> str:
        key = hashlib.sha256(json.dumps([scope or "", table_name], ensure_ascii=False).encode("utf-8")).hexdigest()[:24]
        return f"versioning/database/{connection_id}/tables/{key}.json.gz"

    def changes_path(self, connection_id: str) -> str:
        return f"versioning/database/{connection_id}/changes.sql.gz"

    def create_snapshot_async(self, connection_id: str, reason: str = "初始化数据库 Git 快照") -> DatabaseSnapshotResult:
        task = git_task_registry.start(connection_id, "数据库 Git 快照", lambda item: self._create_snapshot(connection_id, reason, item))
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

    def list_versions(self, connection_id: str, limit: int = 30) -> list[dict[str, Any]]:
        self._ensure_enabled(connection_id)
        return [
            {"id": commit.sha, "message": commit.message, "committed_at": commit.committed_at}
            for commit in github_oauth_service.list_repository_commits(self.manifest_path(connection_id), per_page=limit)
        ]

    def list_table_versions(self, connection_id: str, scope: str | None, table_name: str, limit: int = 30) -> list[dict[str, Any]]:
        self._ensure_enabled(connection_id)
        path = self.table_path(connection_id, scope, table_name)
        return [
            {"id": commit.sha, "message": commit.message, "committed_at": commit.committed_at}
            for commit in github_oauth_service.list_repository_commits(path, per_page=limit)
        ]

    def get_table_snapshot(self, connection_id: str, scope: str | None, table_name: str, version_id: str | None = None) -> TableSnapshot:
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
        return {"version_id": version_id, "snapshot": snapshot.model_dump(), "changes_sql": changes}

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
        self, connection_id: str, scope: str | None, table_name: str, version_id: str
    ) -> dict[str, Any]:
        historical = self.get_table_snapshot(connection_id, scope, table_name, version_id)
        request = self._ensure_enabled(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接尚未打开，无法恢复历史数据")
        current = self._capture_table(engine, request.database_type, scope, table_name, None, None)
        sql = self._table_changes(current, historical, engine, scope)
        statements = [str(statement).strip() for statement in sqlparse.parse(sql) if str(statement).strip()]
        if statements:
            with engine.begin() as connection:
                for statement in statements:
                    connection.execute(text(statement))
        return {"version_id": version_id, "table_name": table_name, "executed_count": len(statements)}

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
        preparer = engine.dialect.identifier_preparer
        qualified = f"{preparer.quote(scope)}.{preparer.quote(table_name)}" if scope else preparer.quote(table_name)
        with engine.begin() as connection:
            if current is not None and (target is None or current.ddl != target.ddl):
                connection.execute(text(f"DROP TABLE {qualified}"))
            if target is not None and (current is None or current.ddl != target.ddl):
                statements = [str(statement).strip() for statement in sqlparse.parse(target.ddl) if str(statement).strip()]
                for statement in statements:
                    connection.execute(text(statement))
        return {
            "version_id": version_id,
            "table_name": table_name,
            "changed": current is None or target is None or current.ddl != target.ddl,
            "action": "created" if current is None and target is not None else "dropped" if target is None else "recreated",
        }

    def _schema_at_version(self, connection_id: str, version_id: str) -> SchemaSnapshot:
        manifest = github_oauth_service.read_repository_file(self.manifest_path(connection_id), ref=version_id)
        if manifest is not None:
            return self._parse_manifest(manifest.content).schema_snapshot
        snapshot = github_oauth_service.read_repository_file(
            schema_versioning_service.snapshot_path(connection_id), ref=version_id
        )
        if snapshot is None:
            raise ValueError("找不到指定的结构版本")
        return schema_versioning_service._parse_snapshot(snapshot.content)

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
        old = {cls._row_key(row, historical.identity_columns): row for row in historical.rows}
        new = {cls._row_key(row, historical.identity_columns): row for row in current.rows}
        added = [row for key, row in new.items() if key not in old]
        deleted = [row for key, row in old.items() if key not in new]
        updated = [
            {"before": old[key], "after": row}
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
        if schema_sql:
            sql_sections.append("-- DDL\n" + schema_sql)

        task.detail = f"正在并行读取 {table_count} 张表的数据（并压缩）"
        captured_tables: dict[int, TableSnapshot] = {}
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
                captured_tables[index] = future.result()
                task.current = 5 + (completed * 70 // max(1, table_count))
                task.detail = f"正在读取并压缩数据：{completed}/{table_count} 张表"

        task.current = 76
        task.detail = "数据读取完成，正在生成变更 SQL"
        for index, (scope, table_name, database, pg_database) in enumerate(table_targets, start=1):
            if task.cancel_requested:
                return {"cancelled": True}
            table_snapshot = captured_tables[index]
            path = self.table_path(connection_id, scope, table_name)
            table_entries.append({"scope": scope, "table_name": table_name, "path": path, "fingerprint": table_snapshot.fingerprint, "row_count": len(table_snapshot.rows)})
            previous_entry = previous_tables.get(path)
            if previous_entry and previous_entry.get("fingerprint") == table_snapshot.fingerprint:
                continue
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
        message = self._commit_message(reason, manifest, sql_text)
        task.current = 92
        task.detail = "正在上传快照文件并更新远端分支"
        result = github_oauth_service.write_repository_files(files, message)
        task.current = 99
        task.detail = f"远端提交完成：已提交 {len(table_targets)} 张表"
        return {"commit_sha": result.commit_sha, "table_count": len(table_targets), "manifest_path": self.manifest_path(connection_id)}

    def _capture_table(self, engine: Any, database_type: str, scope: str | None, table_name: str, database: str | None, pg_database: str | None) -> TableSnapshot:
        columns = list_columns(engine, table_name, database or scope, pg_database)
        identity_columns = [column.name for column in columns if column.primary_key] or [column.name for column in columns if column.unique][:1]
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = preview_table(engine, table_name, 1000, offset, database or scope, pg_database, sort_column=identity_columns[0] if identity_columns else None, sort_direction="ascend" if identity_columns else None)
            rows.extend(page.rows)
            if not page.limited or not page.rows:
                break
            offset += len(page.rows)
        fingerprint = hashlib.sha256(json.dumps({"columns": [column.name for column in columns], "rows": rows}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
        return TableSnapshot(table_name=table_name, scope=scope, database=database, pg_database=pg_database, captured_at=datetime.now(timezone.utc).isoformat(), columns=[column.name for column in columns], identity_columns=identity_columns, rows=rows, fingerprint=fingerprint)

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
        old = {cls._row_key(row, previous.identity_columns): row for row in previous.rows}
        new = {cls._row_key(row, current.identity_columns): row for row in current.rows}
        statements: list[str] = []
        for key, row in new.items():
            if key not in old:
                statements.append(cls._insert_statement(current, row, engine, scope))
            elif old[key] != row:
                assignments = ", ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column))}" for column in current.columns if column not in current.identity_columns and old[key].get(column) != row.get(column))
                if assignments:
                    where = " AND ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column))}" for column in current.identity_columns)
                    statements.append(f"UPDATE {cls._qualified_table(current, engine, scope)} SET {assignments} WHERE {where};")
        for key, row in old.items():
            if key not in new:
                where = " AND ".join(f"{engine.dialect.identifier_preparer.quote(column)} = {cls._literal(row.get(column))}" for column in previous.identity_columns)
                statements.append(f"DELETE FROM {cls._qualified_table(current, engine, scope)} WHERE {where};")
        return "\n".join(statements)

    @classmethod
    def _insert_sql(cls, snapshot: TableSnapshot, engine: Any, scope: str | None) -> str:
        return "\n".join(cls._insert_statement(snapshot, row, engine, scope) for row in snapshot.rows)

    @classmethod
    def _insert_statement(cls, snapshot: TableSnapshot, row: dict[str, Any], engine: Any, scope: str | None) -> str:
        quote = engine.dialect.identifier_preparer.quote
        columns = ", ".join(quote(column) for column in snapshot.columns)
        values = ", ".join(cls._literal(row.get(column)) for column in snapshot.columns)
        return f"INSERT INTO {cls._qualified_table(snapshot, engine, scope)} ({columns}) VALUES ({values});"

    @staticmethod
    def _qualified_table(snapshot: TableSnapshot, engine: Any, scope: str | None) -> str:
        quote = engine.dialect.identifier_preparer.quote
        return f"{quote(scope)}.{quote(snapshot.table_name)}" if scope else quote(snapshot.table_name)

    @staticmethod
    def _row_key(row: dict[str, Any], columns: list[str]) -> str:
        return json.dumps({column: row.get(column) for column in columns}, ensure_ascii=False, sort_keys=True, default=str)

    @staticmethod
    def _literal(value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, (dict, list)):
            value = json.dumps(value, ensure_ascii=False)
        return "'" + str(value).replace("'", "''") + "'"

    @staticmethod
    def _commit_message(reason: str, manifest: DatabaseSnapshotManifest, sql_text: str) -> str:
        normalized = reason.strip() or "更新数据库 Git 快照"
        preview = sql_text[:12_000]
        suffix = "\n-- 完整变更 SQL 已压缩保存到 versioning/database/*/changes.sql.gz" if len(sql_text) > len(preview) else ""
        return f"DataDjinn: {normalized}（{len(manifest.tables)} 张表）\n\n{preview}{suffix}"

    @staticmethod
    def _ensure_enabled(connection_id: str) -> Any:
        request = connection_manager.get_connection_request(connection_id)
        if not request.git_versioning_enabled:
            raise ValueError("请先在连接设置中开启 Git 版本管理")
        if request.database_type in {"mongodb", "redis"}:
            raise ValueError("MongoDB 和 Redis 暂不支持 Git 数据版本管理")
        if not github_oauth_service.status().authorized:
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
