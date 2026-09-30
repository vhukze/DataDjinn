from __future__ import annotations

import gzip
import json
import threading
import unittest
from base64 import b64encode
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from fastapi import BackgroundTasks
from sqlalchemy import create_engine, text

from app.git_versioning.database_history import (
    SNAPSHOT_VALUE_TYPE_KEY,
    DatabaseSnapshotManifest,
    DatabaseVersioningService,
    LocalDatabaseSnapshot,
    TableSnapshot,
    _decode_snapshot_value,
    _encode_snapshot_value,
)
from app.git_versioning.schema_history import SchemaSnapshot, SchemaSnapshotObject
from app.git_versioning.task_progress import GitTask
from app.schemas.query import QueryResponse


class DatabaseVersioningServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = DatabaseVersioningService()

    def test_table_snapshot_is_gzip_compressible_and_round_trips(self) -> None:
        snapshot = TableSnapshot(
            table_name="items",
            columns=["id", "title"],
            identity_columns=["id"],
            rows=[{"id": 1, "title": "第一条"}],
            captured_at="2026-08-18T00:00:00+00:00",
            fingerprint="fingerprint",
        )
        compressed = gzip.compress(snapshot.model_dump_json(ensure_ascii=False).encode("utf-8"), compresslevel=9, mtime=0)
        restored = TableSnapshot.model_validate_json(gzip.decompress(compressed).decode("utf-8"))
        self.assertEqual(snapshot.rows, restored.rows)
        self.assertLess(len(compressed), len(snapshot.model_dump_json().encode("utf-8")) + 40)

    def test_local_table_snapshots_are_listed_for_their_table(self) -> None:
        from app.git_versioning import database_history

        snapshot = TableSnapshot(
            table_name="items",
            scope="sales",
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}],
            captured_at="2026-09-29T10:00:00+00:00",
            fingerprint="table-fingerprint",
        )
        archive = LocalDatabaseSnapshot(
            connection_id="c1",
            reason="保存表格前快照",
            captured_at=snapshot.captured_at,
            snapshot_kind="table_change",
            tables=[snapshot],
        )
        payload = gzip.compress(archive.model_dump_json().encode("utf-8"))
        with (
            patch.object(self.service, "_ensure_enabled"),
            patch("app.git_versioning.database_history.local_snapshot_history.list", return_value=[{
                "id": "local-table-snapshot",
                "message": "保存表格前快照",
                "captured_at": snapshot.captured_at,
                "status": "local_only",
                "remote_commit_id": None,
                "error": "offline",
            }]),
            patch("app.git_versioning.database_history.local_snapshot_history.get_payload", return_value=payload),
        ):
            versions = self.service.list_local_table_versions("c1", "sales", "items")

        self.assertEqual(["local-table-snapshot"], [item["id"] for item in versions])
        self.assertEqual("local_only", versions[0]["status"])

    def test_local_table_snapshot_can_be_loaded_without_github_authorization(self) -> None:
        from app.git_versioning import database_history

        snapshot = TableSnapshot(
            table_name="items",
            scope=None,
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}],
            captured_at="2026-09-29T10:00:00+00:00",
            fingerprint="table-fingerprint",
        )
        archive = LocalDatabaseSnapshot(
            connection_id="c1",
            reason="保存表格前快照",
            captured_at=snapshot.captured_at,
            snapshot_kind="table_change",
            tables=[snapshot],
        )
        payload = gzip.compress(archive.model_dump_json().encode("utf-8"))
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.get_record", return_value={
                "connection_id": "c1",
                "snapshot_kind": "table_change",
            }),
            patch("app.git_versioning.database_history.local_snapshot_history.get_payload", return_value=payload),
            patch.object(self.service, "_ensure_enabled") as ensure_enabled,
        ):
            restored = self.service.get_table_snapshot("c1", None, "items", "local-id")

        self.assertEqual(snapshot.rows, restored.rows)
        ensure_enabled.assert_called_once_with("c1", require_authorization=False)

    def test_retry_rejects_an_older_local_snapshot_when_a_newer_snapshot_exists(self) -> None:
        from app.git_versioning import database_history

        with (
            patch("app.git_versioning.database_history.local_snapshot_history.get_record", return_value={
                "connection_id": "c1",
                "captured_at": "2026-09-29T10:00:00+00:00",
            }),
            patch("app.git_versioning.database_history.local_snapshot_history.has_newer_snapshot", return_value=True),
            patch("app.git_versioning.database_history.local_snapshot_history.retry_failed") as retry_failed,
        ):
            with self.assertRaisesRegex(ValueError, "远端最新版本倒退"):
                self.service.retry_local_snapshot_sync("c1", "older-id")

        retry_failed.assert_not_called()

    def test_snapshot_values_preserve_decimal_precision_binary_data_and_reserved_json_keys(self) -> None:
        value = {
            "amount": Decimal("12345678901234567890.1234567890123456789"),
            "payload": memoryview(b"\x00\xffbinary"),
            "document": {SNAPSHOT_VALUE_TYPE_KEY: "application-value", "value": 1},
        }

        restored = _decode_snapshot_value(json.loads(json.dumps(_encode_snapshot_value(value))))

        self.assertEqual(value["amount"], restored["amount"])
        self.assertEqual(bytes(value["payload"]), restored["payload"])
        self.assertEqual(value["document"], restored["document"])
        engine = create_engine("sqlite://")
        try:
            self.assertEqual(
                "12345678901234567890.1234567890123456789",
                self.service._literal(_encode_snapshot_value(value["amount"]), engine),
            )
            self.assertEqual(
                "X'00ff62696e617279'",
                self.service._literal(_encode_snapshot_value(b"\x00\xffbinary"), engine),
            )
        finally:
            engine.dispose()

    def test_history_details_render_typed_values_without_internal_tags(self) -> None:
        historical = TableSnapshot(
            table_name="items",
            columns=["id", "amount", "payload"],
            identity_columns=["id"],
            rows=[
                {
                    "id": 1,
                    "amount": _encode_snapshot_value(Decimal("12345678901234567890.123456789")),
                    "payload": _encode_snapshot_value(b"\x00\xff"),
                }
            ],
            captured_at="",
            fingerprint="typed",
        )
        with (
            patch.object(self.service, "get_table_snapshot", return_value=historical),
            patch.object(self.service, "_read_changes", return_value=""),
            patch.object(self.service, "_extract_table_changes", return_value=""),
        ):
            details = self.service.get_table_version_details("c1", None, "items", "commit-1")

        row = details["snapshot"]["rows"][0]
        self.assertEqual("12345678901234567890.123456789", row["amount"])
        self.assertEqual("00ff", row["payload"])
        self.assertNotIn(SNAPSHOT_VALUE_TYPE_KEY, json.dumps(row))

    @patch("app.git_versioning.database_history.list_columns")
    @patch("app.git_versioning.database_history.preview_table")
    def test_table_capture_encodes_exact_decimal_and_binary_values(self, preview, list_columns) -> None:
        amount = Decimal("12345678901234567890.1234567890123456789")
        payload = b"\x00\xffcapture"
        list_columns.return_value = [
            SimpleNamespace(name="id", primary_key=True, unique=True),
            SimpleNamespace(name="amount", primary_key=False, unique=False),
            SimpleNamespace(name="payload", primary_key=False, unique=False),
        ]
        preview.return_value = SimpleNamespace(
            rows=[{"id": 1, "amount": amount, "payload": memoryview(payload)}],
            limited=False,
        )

        snapshot = self.service._capture_table(object(), "sqlite", None, "items", None, None)

        self.assertEqual(_encode_snapshot_value(amount), snapshot.rows[0]["amount"])
        self.assertEqual(_encode_snapshot_value(payload), snapshot.rows[0]["payload"])
        self.assertIs(preview.call_args.kwargs["preserve_sql_types"], True)

    def test_write_snapshot_captures_all_tables_before_mutation(self) -> None:
        connection_id = "sqlite-auto-snapshot"
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at="2026-09-23T00:00:00+00:00",
            fingerprint="schema-fingerprint",
        )
        request = SimpleNamespace(
            git_versioning_enabled=True,
            database_type="sqlite",
            git_versioning_scopes=[],
        )
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)"))
                connection.execute(text("CREATE TABLE audit (id INTEGER PRIMARY KEY, event TEXT)"))
                connection.execute(text("INSERT INTO items VALUES (1, 'before')"))
                connection.execute(text("INSERT INTO audit VALUES (1, 'created')"))

            saved: dict[str, bytes] = {}

            def save_snapshot(_connection_id: str, _reason: str, payload: bytes, **_kwargs: object) -> str:
                saved["payload"] = payload
                return "snapshot-1"

            with (
                patch("app.git_versioning.database_history.connection_manager.get_connection_request", return_value=request),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.schema_versioning_service._selected_scopes", return_value=[None]),
                patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=schema) as capture_schema,
                patch("app.git_versioning.database_history.list_tables", return_value=[SimpleNamespace(name="items"), SimpleNamespace(name="audit")]),
                patch("app.git_versioning.database_history.local_snapshot_history.save_prepared", side_effect=save_snapshot),
            ):
                snapshot_id = self.service.prepare_write_snapshot(connection_id, "SQL 写入前")

            with engine.begin() as connection:
                connection.execute(text("UPDATE items SET value = 'after' WHERE id = 1"))

            archive = LocalDatabaseSnapshot.model_validate_json(
                gzip.decompress(saved["payload"]).decode("utf-8")
            )
            tables = {table.table_name: table for table in archive.tables}
            self.assertEqual("snapshot-1", snapshot_id)
            self.assertEqual({"items", "audit"}, set(tables))
            self.assertEqual("before", tables["items"].rows[0]["value"])
            self.assertEqual("created", tables["audit"].rows[0]["event"])
            capture_schema.assert_called_once()
        finally:
            engine.dispose()

    def test_targeted_write_snapshot_captures_only_the_affected_table(self) -> None:
        connection_id = "sqlite-partial-auto-snapshot"
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at="2026-09-24T00:00:00+00:00",
            fingerprint="schema-fingerprint",
        )
        request = SimpleNamespace(
            git_versioning_enabled=True,
            database_type="sqlite",
            git_versioning_scopes=[],
        )
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)"))
                connection.execute(text("CREATE TABLE audit (event TEXT)"))
                connection.execute(text("INSERT INTO items VALUES (1, 'before')"))
                connection.execute(text("INSERT INTO audit VALUES ('created')"))

            saved: dict[str, bytes] = {}

            def save_snapshot(_connection_id: str, _reason: str, payload: bytes, **_kwargs: object) -> str:
                saved["payload"] = payload
                return "snapshot-1"

            with (
                patch("app.git_versioning.database_history.connection_manager.get_connection_request", return_value=request),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.schema_versioning_service._selected_scopes", return_value=[None]),
                patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=schema) as capture_schema,
                patch("app.git_versioning.database_history.list_tables") as list_tables,
                patch("app.git_versioning.database_history.local_snapshot_history.save_prepared", side_effect=save_snapshot),
            ):
                snapshot_id = self.service.prepare_write_snapshot(
                    connection_id,
                    "保存表格 items 前快照",
                    affected_tables=[(None, "items", None, None)],
                )

            archive = LocalDatabaseSnapshot.model_validate_json(
                gzip.decompress(saved["payload"]).decode("utf-8")
            )
            self.assertEqual("snapshot-1", snapshot_id)
            self.assertEqual("table_change", archive.snapshot_kind)
            self.assertEqual(["items"], [table.table_name for table in archive.tables])
            self.assertEqual([], archive.skipped_tables)
            self.assertIsNone(archive.schema_snapshot)
            capture_schema.assert_not_called()
            list_tables.assert_not_called()
        finally:
            engine.dispose()

    def test_targeted_write_snapshot_captures_keyless_table_for_full_table_restore(self) -> None:
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE audit (event TEXT)"))
                connection.execute(text("INSERT INTO audit VALUES ('before')"))
            schema = SchemaSnapshot(
                connection_id="sqlite-keyless-snapshot",
                database_type="sqlite",
                captured_at="2026-09-24T00:00:00+00:00",
                fingerprint="schema-fingerprint",
            )
            request = SimpleNamespace(
                git_versioning_enabled=True,
                database_type="sqlite",
                git_versioning_scopes=[],
            )
            saved: dict[str, bytes] = {}

            def save_snapshot(_connection_id: str, _reason: str, payload: bytes, **_kwargs: object) -> str:
                saved["payload"] = payload
                return "snapshot-keyless"

            with (
                patch("app.git_versioning.database_history.connection_manager.get_connection_request", return_value=request),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.schema_versioning_service._selected_scopes", return_value=[None]),
                patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=schema) as capture_schema,
                patch("app.git_versioning.database_history.local_snapshot_history.save_prepared", side_effect=save_snapshot),
            ):
                snapshot_id = self.service.prepare_write_snapshot(
                    "sqlite-keyless-snapshot",
                    "保存表格 audit 前快照",
                    affected_tables=[(None, "audit", None, None)],
                )

            archive = LocalDatabaseSnapshot.model_validate_json(
                gzip.decompress(saved["payload"]).decode("utf-8")
            )
            self.assertEqual("snapshot-keyless", snapshot_id)
            self.assertEqual("audit", archive.tables[0].table_name)
            self.assertEqual([], archive.tables[0].identity_columns)
            self.assertEqual([{"event": "before"}], archive.tables[0].rows)
            capture_schema.assert_not_called()
        finally:
            engine.dispose()

    def test_synced_local_snapshot_id_loads_its_remote_commit(self) -> None:
        connection_id = "sqlite-synced-snapshot"
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at="2026-09-23T00:00:00+00:00",
            fingerprint="schema-fingerprint",
        )
        table = TableSnapshot(
            table_name="items",
            columns=["id", "value"],
            identity_columns=["id"],
            rows=[{"id": 1, "value": "before"}],
            captured_at=schema.captured_at,
            fingerprint="table-fingerprint",
        )
        manifest = DatabaseSnapshotManifest(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at=schema.captured_at,
            fingerprint="database-fingerprint",
            schema=schema,
            tables=[{"scope": None, "table_name": "items", "path": "tables/items.json.gz"}],
        )
        compressed_table = gzip.compress(table.model_dump_json().encode("utf-8"), mtime=0)
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.get_record", return_value={
                "id": "local-snapshot-1",
                "connection_id": connection_id,
                "remote_commit_id": "remote-commit-1",
            }),
            patch("app.git_versioning.database_history.local_snapshot_history.get_payload", return_value=None),
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=SimpleNamespace(
                content=manifest.model_dump_json(by_alias=True)
            )) as read_manifest,
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file_bytes", return_value=compressed_table),
        ):
            archive, selected_commit = self.service._load_database_archive(connection_id, "local-snapshot-1")

        self.assertEqual("remote-commit-1", selected_commit)
        self.assertEqual("before", archive.tables[0].rows[0]["value"])
        read_manifest.assert_called_once_with(self.service.manifest_path(connection_id), ref="remote-commit-1")

    def test_completed_write_queues_local_snapshot_for_background_sync(self) -> None:
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.update_status") as update_status,
            patch.object(self.service, "_start_local_snapshot_sync") as start_sync,
        ):
            self.service.complete_write_snapshot("c1", "snapshot-1", True)

        update_status.assert_called_once_with("snapshot-1", "pending")
        start_sync.assert_called_once_with("c1")

    def test_failed_write_keeps_snapshot_local_without_starting_remote_sync(self) -> None:
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.update_status") as update_status,
            patch.object(self.service, "_start_local_snapshot_sync") as start_sync,
        ):
            self.service.complete_write_snapshot("c1", "snapshot-1", False)

        update_status.assert_called_once_with(
            "snapshot-1",
            "local_only",
            error="本次写入未成功，快照仅保存在本机；如确认发生了部分变更，可手动重试同步",
        )
        start_sync.assert_not_called()

    def test_background_sync_uploads_local_snapshot_and_releases_payload(self) -> None:
        schema = SchemaSnapshot(
            connection_id="c1",
            database_type="sqlite",
            captured_at="2026-09-23T00:00:00+00:00",
            fingerprint="schema-fingerprint",
        )
        archive = LocalDatabaseSnapshot(
            connection_id="c1",
            reason="写入前快照",
            captured_at=schema.captured_at,
            schema_snapshot=schema,
        )
        record = {
            "id": "snapshot-1",
            "reason": archive.reason,
            "status": "pending",
            "payload": gzip.compress(archive.model_dump_json().encode("utf-8"), mtime=0),
        }
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.oldest_pending", side_effect=[record, None]),
            patch("app.git_versioning.database_history.local_snapshot_history.update_status") as update_status,
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=object()),
            patch.object(self.service, "_upload_local_snapshot", return_value=SimpleNamespace(commit_sha="commit-1")) as upload,
        ):
            self.service._sync_pending_local_snapshots("c1", threading.Lock())

        upload.assert_called_once()
        update_status.assert_called_once_with(
            "snapshot-1", "synced", remote_commit_id="commit-1", remove_payload=True
        )

    def test_background_sync_retries_an_earlier_error_before_later_snapshots(self) -> None:
        records = [
            {
                "id": "snapshot-1",
                "reason": "第一次写入前快照",
                "status": "error",
                "payload": b"archive-1",
            },
            {
                "id": "snapshot-1",
                "reason": "第一次写入前快照",
                "status": "pending",
                "payload": b"archive-1",
            },
            {
                "id": "snapshot-2",
                "reason": "第二次写入前快照",
                "status": "pending",
                "payload": b"archive-2",
            },
            None,
        ]
        with (
            patch("app.git_versioning.database_history.local_snapshot_history.oldest_pending", side_effect=records),
            patch("app.git_versioning.database_history.local_snapshot_history.retry_failed", return_value=True) as retry_failed,
            patch("app.git_versioning.database_history.local_snapshot_history.update_status") as update_status,
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=object()),
            patch("app.git_versioning.database_history.gzip.decompress", return_value=b"{}"),
            patch("app.git_versioning.database_history.LocalDatabaseSnapshot.model_validate_json", return_value=object()),
            patch.object(self.service, "_upload_local_snapshot", side_effect=[
                SimpleNamespace(commit_sha="commit-1"),
                SimpleNamespace(commit_sha="commit-2"),
            ]) as upload,
        ):
            self.service._sync_pending_local_snapshots("c1", threading.Lock())

        retry_failed.assert_called_once_with("snapshot-1")
        self.assertEqual(2, upload.call_count)
        self.assertEqual(
            [
                call("snapshot-1", "synced", remote_commit_id="commit-1", remove_payload=True),
                call("snapshot-2", "synced", remote_commit_id="commit-2", remove_payload=True),
            ],
            update_status.call_args_list,
        )

    def test_table_change_upload_does_not_rewrite_full_database_manifest(self) -> None:
        snapshot = TableSnapshot(
            table_name="items",
            columns=["id", "value"],
            identity_columns=["id"],
            rows=[{"id": 1, "value": "before"}],
            captured_at="2026-09-25T00:00:00+00:00",
            fingerprint="table-fingerprint",
        )
        archive = LocalDatabaseSnapshot(
            connection_id="c1",
            reason="保存表格 items 前快照",
            captured_at=snapshot.captured_at,
            snapshot_kind="table_change",
            schema_snapshot=SchemaSnapshot(
                connection_id="c1",
                database_type="sqlite",
                captured_at=snapshot.captured_at,
                fingerprint="schema",
            ),
            tables=[snapshot],
        )
        result = SimpleNamespace(commit_sha="table-commit")
        with (
            patch.object(self.service, "_read_table_from_path", return_value=None),
            patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=None),
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=None),
            patch("app.git_versioning.database_history.github_oauth_service.write_repository_files", return_value=result) as write_files,
        ):
            uploaded = self.service._upload_local_snapshot("c1", archive)

        files = write_files.call_args.args[0]
        self.assertEqual(result, uploaded)
        self.assertIn(self.service.table_path("c1", None, "items"), files)
        self.assertNotIn(self.service.manifest_path("c1"), files)

    def test_scheduler_starts_checkpoint_only_when_interval_is_due(self) -> None:
        connection = SimpleNamespace(connection_id="c1", is_open=True)
        request = SimpleNamespace(
            git_versioning_enabled=True,
            git_versioning_snapshot_interval_hours=6,
            git_versioning_scopes=[],
            database_type="sqlite",
        )
        now = __import__("datetime").datetime.fromisoformat("2026-09-25T12:00:00+00:00")
        with (
            patch("app.git_versioning.database_history.connection_manager.list_connections", return_value=[connection]),
            patch("app.git_versioning.database_history.connection_manager.get_connection_request", return_value=request),
            patch("app.git_versioning.database_history.local_snapshot_history.get_last_scheduled_snapshot", return_value="2026-09-25T05:00:00+00:00"),
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=object()),
            patch("app.git_versioning.database_history.git_task_registry.start") as start_task,
        ):
            self.service.run_due_scheduled_snapshots(now)

        start_task.assert_called_once()
        self.assertEqual("定时全库检查点", start_task.call_args.args[1])

    def test_schema_change_uploads_schema_history_without_updating_database_manifest(self) -> None:
        schema = SchemaSnapshot(
            connection_id="c1",
            database_type="sqlite",
            captured_at="2026-09-25T00:00:00+00:00",
            fingerprint="schema-before-change",
            objects=[SchemaSnapshotObject(scope=None, name="items", type="table", ddl="CREATE TABLE items (id INT)")],
        )
        previous = TableSnapshot(
            table_name="items",
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}],
            captured_at="2026-09-24T00:00:00+00:00",
            fingerprint="same-table-data",
        )
        archive = LocalDatabaseSnapshot(
            connection_id="c1",
            reason="修改表结构 items 前快照",
            captured_at=schema.captured_at,
            snapshot_kind="table_change",
            schema_snapshot=schema,
            tables=[previous],
        )
        schema_path = self.service.table_path("c1", None, "items")
        with (
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=None),
            patch("app.git_versioning.database_history.github_oauth_service.read_repository_file_bytes", return_value=gzip.compress(previous.model_dump_json().encode("utf-8"))),
            patch("app.git_versioning.database_history.github_oauth_service.write_repository_files", return_value=SimpleNamespace(commit_sha="schema-commit")) as write_files,
            patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=None),
        ):
            result = self.service._upload_local_table_snapshot("c1", archive)

        files, _ = write_files.call_args.args
        self.assertEqual("schema-commit", result.commit_sha)
        self.assertIn(schema_path, files)
        self.assertIn(self.service.table_path("c1", None, "items"), files)
        self.assertIn("versioning/schema/c1/snapshot.json", files)
        self.assertNotIn(self.service.manifest_path("c1"), files)

    def test_database_snapshot_uses_bounded_parallel_table_capture(self) -> None:
        from app.git_versioning.database_history import MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS

        self.assertEqual(4, MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS)

    def test_database_restore_round_trip_restores_all_rows_from_local_archive(self) -> None:
        connection_id = "sqlite-restore"
        request = SimpleNamespace(
            git_versioning_enabled=True,
            database_type="sqlite",
            git_versioning_scopes=[],
        )
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at="2026-09-23T00:00:00+00:00",
            fingerprint="schema-fingerprint",
        )
        historical_table = TableSnapshot(
            table_name="items",
            columns=["id", "value"],
            identity_columns=["id"],
            rows=[{"id": 1, "value": "before"}, {"id": 2, "value": "kept"}],
            captured_at="2026-09-23T00:00:00+00:00",
            fingerprint="table-fingerprint",
        )
        archive = LocalDatabaseSnapshot(
            connection_id=connection_id,
            reason="写入前快照",
            captured_at=historical_table.captured_at,
            schema_snapshot=schema,
            tables=[historical_table],
        )
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)"))
                connection.execute(text("INSERT INTO items VALUES (1, 'changed'), (3, 'added')"))

            with (
                patch("app.git_versioning.database_history.connection_manager.get_connection_request", return_value=request),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.schema_versioning_service._selected_scopes", return_value=[None]),
                patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=schema),
                patch.object(self.service, "_load_database_archive", return_value=(archive, None)),
                patch.object(self.service, "prepare_write_snapshot", return_value="before-restore"),
                patch.object(self.service, "complete_write_snapshot") as complete_snapshot,
            ):
                result = self.service.restore_database_version(connection_id, "local-version")

            with engine.connect() as connection:
                rows = connection.execute(text("SELECT id, value FROM items ORDER BY id")).all()
            self.assertEqual([(1, "before"), (2, "kept")], rows)
            self.assertEqual(1, result["restored_table_count"])
            complete_snapshot.assert_called_once_with(connection_id, "before-restore", True)
        finally:
            engine.dispose()

    def test_snapshot_preview_lists_tables_and_sums_available_estimates(self) -> None:
        request = SimpleNamespace(database_type="mysql", git_versioning_scopes=["sales"])
        tables = [
            SimpleNamespace(name="orders", row_count=12, storage_size_bytes=1024, size_bytes=900),
            SimpleNamespace(name="customers", row_count=8, storage_size_bytes=2048, size_bytes=1900),
        ]
        with (
            patch.object(self.service, "_ensure_enabled", return_value=request),
            patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=object()),
            patch("app.git_versioning.schema_history.schema_versioning_service._selected_scopes", return_value=["sales"]),
            patch("app.git_versioning.database_history.list_tables", return_value=tables),
        ):
            preview = self.service.preview_snapshot("c1")

        self.assertEqual(["sales"], preview.scopes)
        self.assertEqual(["orders", "customers"], [table.table_name for table in preview.tables])
        self.assertEqual(20, preview.estimated_row_count)
        self.assertEqual(3072, preview.estimated_storage_size_bytes)
        self.assertEqual(100_000, preview.max_rows_per_table)
        self.assertEqual(50_000_000, preview.max_table_snapshot_bytes)

    def test_snapshot_preview_marks_totals_unknown_when_database_stats_are_missing(self) -> None:
        request = SimpleNamespace(database_type="sqlite", git_versioning_scopes=[])
        tables = [SimpleNamespace(name="items", row_count=None, storage_size_bytes=None, size_bytes=None)]
        with (
            patch.object(self.service, "_ensure_enabled", return_value=request),
            patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=object()),
            patch("app.git_versioning.schema_history.schema_versioning_service._selected_scopes", return_value=[None]),
            patch("app.git_versioning.database_history.list_tables", return_value=tables),
        ):
            preview = self.service.preview_snapshot("c1")

        self.assertEqual(["默认库"], preview.scopes)
        self.assertIsNone(preview.estimated_row_count)
        self.assertIsNone(preview.estimated_storage_size_bytes)

    def test_data_change_sql_contains_insert_update_delete(self) -> None:
        previous = TableSnapshot(
            table_name="items", columns=["id", "title"], identity_columns=["id"],
            rows=[{"id": 1, "title": "old"}, {"id": 2, "title": "gone"}],
            captured_at="", fingerprint="old"
        )
        current = TableSnapshot(
            table_name="items", columns=["id", "title"], identity_columns=["id"],
            rows=[{"id": 1, "title": "new"}, {"id": 3, "title": "added"}],
            captured_at="", fingerprint="new"
        )
        engine = SimpleNamespace(dialect=SimpleNamespace(identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"')))
        sql = self.service._table_changes(previous, current, engine, None)
        self.assertIn("UPDATE", sql)
        self.assertIn("INSERT", sql)
        self.assertIn("DELETE", sql)

    def test_row_diff_reports_added_deleted_and_updated_rows(self) -> None:
        historical = TableSnapshot(
            table_name="items", columns=["id", "title"], identity_columns=["id"],
            rows=[{"id": 1, "title": "old"}, {"id": 2, "title": "gone"}],
            captured_at="", fingerprint="old"
        )
        current = historical.model_copy(update={
            "rows": [{"id": 1, "title": "new"}, {"id": 3, "title": "added"}],
            "fingerprint": "new",
        })

        diff = self.service._row_diff(historical, current, "commit-1")

        self.assertEqual((1, 1, 1), (diff["added_count"], diff["deleted_count"], diff["updated_count"]))
        self.assertEqual({"id": 3}, diff["added"][0]["identity"])
        self.assertEqual({"id": 3, "title": "added"}, diff["added"][0]["after"])
        self.assertEqual({"id": 2}, diff["deleted"][0]["identity"])
        self.assertEqual({"id": 2, "title": "gone"}, diff["deleted"][0]["before"])
        self.assertEqual(["title"], diff["updated"][0]["changed_columns"])
        self.assertEqual("old", diff["updated"][0]["before"]["title"])
        self.assertEqual("new", diff["updated"][0]["after"]["title"])

    def test_row_diff_refuses_duplicate_identity_values(self) -> None:
        historical = TableSnapshot(
            table_name="items",
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}, {"id": 1}],
            captured_at="",
            fingerprint="duplicate",
        )
        with self.assertRaisesRegex(ValueError, "存在重复的主键或唯一键"):
            self.service._row_diff(historical, historical, "commit-1")

    def test_table_restore_replaces_keyless_table_from_full_snapshot(self) -> None:
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (value TEXT)"))
                connection.execute(text("INSERT INTO items VALUES ('current')"))
            historical = TableSnapshot(
                table_name="items",
                columns=["value"],
                identity_columns=[],
                rows=[{"value": "historical"}],
                captured_at="",
                fingerprint="historical",
            )
            current = historical.model_copy(update={"rows": [{"value": "current"}], "fingerprint": "current"})
            with (
                patch.object(self.service, "get_table_snapshot", return_value=historical),
                patch.object(self.service, "_ensure_enabled", return_value=SimpleNamespace(database_type="sqlite")),
                patch.object(self.service, "_capture_table", return_value=current),
                patch.object(self.service, "prepare_write_snapshot", return_value="before-restore"),
                patch.object(self.service, "complete_write_snapshot") as complete_snapshot,
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=None),
            ):
                result = self.service.restore_table_version("c1", None, "items", "commit-1")

            with engine.connect() as connection:
                rows = connection.execute(text("SELECT value FROM items")).fetchall()
            self.assertEqual("historical", rows[0][0])
            self.assertEqual(2, result["executed_count"])
            complete_snapshot.assert_called_once_with("c1", "before-restore", True)
        finally:
            engine.dispose()

    def test_table_restore_replaces_table_when_identity_columns_changed(self) -> None:
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)"))
                connection.execute(text("INSERT INTO items VALUES (1, 'current')"))
            historical = TableSnapshot(
                table_name="items",
                columns=["id", "value"],
                identity_columns=["id"],
                rows=[{"id": 2, "value": "historical"}],
                captured_at="",
                fingerprint="historical",
            )
            current = historical.model_copy(update={"identity_columns": ["value"], "rows": [{"id": 1, "value": "current"}]})
            with (
                patch.object(self.service, "get_table_snapshot", return_value=historical),
                patch.object(self.service, "_ensure_enabled", return_value=SimpleNamespace(database_type="sqlite")),
                patch.object(self.service, "_capture_table", return_value=current),
                patch.object(self.service, "prepare_write_snapshot", return_value="before-restore"),
                patch.object(self.service, "complete_write_snapshot"),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=None),
            ):
                self.service.restore_table_version("c1", None, "items", "commit-1")

            with engine.connect() as connection:
                rows = connection.execute(text("SELECT id, value FROM items")).fetchall()
            self.assertEqual([(2, "historical")], rows)
        finally:
            engine.dispose()

    def test_table_restore_refuses_to_mutate_without_a_pre_restore_snapshot(self) -> None:
        engine = create_engine("sqlite://")
        historical = TableSnapshot(
            table_name="items",
            columns=["value"],
            rows=[{"value": "historical"}],
            captured_at="",
            fingerprint="historical",
        )
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (value TEXT)"))
                connection.execute(text("INSERT INTO items VALUES ('current')"))
            with (
                patch.object(self.service, "get_table_snapshot", return_value=historical),
                patch.object(self.service, "_ensure_enabled", return_value=SimpleNamespace(database_type="sqlite")),
                patch.object(self.service, "prepare_write_snapshot", return_value=None),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
            ):
                with self.assertRaisesRegex(ValueError, "恢复前保护快照"):
                    self.service.restore_table_version("c1", None, "items", "commit-1")

            with engine.connect() as connection:
                value = connection.execute(text("SELECT value FROM items")).scalar_one()
            self.assertEqual("current", value)
        finally:
            engine.dispose()

    def test_table_restore_writes_binary_values_as_binary(self) -> None:
        engine = create_engine("sqlite://")
        payload = b"\x00\xffrestored"
        historical = TableSnapshot(
            table_name="items",
            columns=["id", "payload"],
            identity_columns=["id"],
            rows=[
                {
                    "id": 1,
                    "payload": {
                        SNAPSHOT_VALUE_TYPE_KEY: "bytes",
                        "value": b64encode(payload).decode("ascii"),
                    },
                }
            ],
            captured_at="",
            fingerprint="binary",
        )
        current = historical.model_copy(update={"rows": [{"id": 1, "payload": "old"}]})
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, payload BLOB)"))
                connection.execute(text("INSERT INTO items VALUES (1, X'6F6C64')"))
            with (
                patch.object(self.service, "get_table_snapshot", return_value=historical),
                patch.object(self.service, "_ensure_enabled", return_value=SimpleNamespace(database_type="sqlite")),
                patch.object(self.service, "prepare_write_snapshot", return_value="before-restore"),
                patch.object(self.service, "complete_write_snapshot"),
                patch.object(self.service, "_capture_table", return_value=current),
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.github_oauth_service.read_repository_file", return_value=None),
            ):
                self.service.restore_table_version("c1", None, "items", "commit-1")

            with engine.connect() as connection:
                restored = connection.execute(text("SELECT payload FROM items WHERE id = 1")).scalar_one()
            self.assertEqual(payload, restored)
        finally:
            engine.dispose()

    def test_structure_restore_keeps_compatible_columns_and_snapshots_before_change(self) -> None:
        engine = create_engine("sqlite://")
        request = SimpleNamespace(database_type="sqlite", git_versioning_scopes=[])
        target = SchemaSnapshotObject(
            name="items",
            type="table",
            scope=None,
            ddl="CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT, added TEXT DEFAULT 'new')",
        )
        current_schema = SchemaSnapshot(
            connection_id="c1", database_type="sqlite", captured_at="", fingerprint="current"
        )
        target_schema = current_schema.model_copy(update={"objects": [target]})
        current_object = SchemaSnapshotObject(
            name="items",
            type="table",
            scope=None,
            ddl="CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT, removed TEXT)",
        )
        current_schema = current_schema.model_copy(update={"objects": [current_object]})
        current_data = TableSnapshot(
            table_name="items",
            columns=["id", "value", "removed"],
            identity_columns=["id"],
            rows=[{"id": 1, "value": "preserved", "removed": "old"}],
            captured_at="",
            fingerprint="current-data",
        )
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT, removed TEXT)"))
                connection.execute(text("INSERT INTO items VALUES (1, 'preserved', 'old')"))
            with (
                patch.object(self.service, "_schema_at_version", return_value=target_schema),
                patch.object(self.service, "_ensure_enabled", return_value=request),
                patch.object(self.service, "_capture_table", return_value=current_data),
                patch.object(self.service, "prepare_write_snapshot", return_value="before-structure" ) as prepare_snapshot,
                patch.object(self.service, "complete_write_snapshot") as complete_snapshot,
                patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=engine),
                patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=current_schema),
            ):
                result = self.service.restore_table_structure("c1", None, "items", "commit-1")

            with engine.connect() as connection:
                row = connection.execute(text("SELECT id, value, added FROM items")).one()
            self.assertEqual((1, "preserved", "new"), row)
            self.assertTrue(result["changed"])
            prepare_snapshot.assert_called_once_with(
                "c1",
                "恢复历史结构前快照",
                affected_tables=[(None, "items", None, None)],
                capture_schema=True,
            )
            complete_snapshot.assert_called_once_with("c1", "before-structure", True)
        finally:
            engine.dispose()

    @patch("app.git_versioning.database_history.list_columns")
    @patch("app.git_versioning.database_history.preview_table")
    def test_table_capture_stops_before_exceeding_row_limit(self, preview, list_columns) -> None:
        from app.git_versioning import database_history

        list_columns.return_value = [SimpleNamespace(name="id", primary_key=True, unique=True)]
        preview.side_effect = [
            SimpleNamespace(rows=[{"id": 1}, {"id": 2}], limited=True),
            SimpleNamespace(rows=[{"id": 3}], limited=True),
        ]
        with patch.object(database_history, "MAX_TABLE_SNAPSHOT_ROWS", 2):
            with self.assertRaisesRegex(ValueError, "超过 Git 快照上限 2 行"):
                self.service._capture_table(object(), "sqlite", None, "items", None, None)
        self.assertEqual(2, preview.call_count)

    @patch("app.git_versioning.database_history.list_columns")
    @patch("app.git_versioning.database_history.preview_table")
    def test_table_capture_rejects_oversized_serialized_snapshot(self, preview, list_columns) -> None:
        from app.git_versioning import database_history

        list_columns.return_value = [SimpleNamespace(name="id", primary_key=True, unique=True)]
        preview.return_value = SimpleNamespace(rows=[{"id": 1}], limited=False)
        with patch.object(database_history, "MAX_TABLE_SNAPSHOT_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "超过 Git 快照上限 1 字节"):
                self.service._capture_table(object(), "sqlite", None, "items", None, None)

    def test_database_snapshot_commit_message_keeps_sql_out_of_history_summary(self) -> None:
        manifest = SimpleNamespace(tables=[{}, {}])

        message = self.service._commit_message("保存表格数据", manifest, 3, 2)

        self.assertEqual("DataDjinn: 保存表格数据（2 张表，结构变更 3 项，数据变更 2 张表）", message)
        self.assertNotIn("CREATE TABLE", message)

    def test_history_message_uses_only_first_commit_message_line(self) -> None:
        message = self.service._history_message("DataDjinn: 手动创建数据库 Git 快照（2 张表）\n\nCREATE TABLE items (...)")

        self.assertEqual("DataDjinn: 手动创建数据库 Git 快照（2 张表）", message)

    def test_restore_generates_sql_from_current_state_to_historical_state(self) -> None:
        historical = TableSnapshot(
            table_name="items", columns=["id", "title"], identity_columns=["id"],
            rows=[{"id": 1, "title": "old"}], captured_at="", fingerprint="old"
        )
        current = TableSnapshot(
            table_name="items", columns=["id", "title"], identity_columns=["id"],
            rows=[{"id": 1, "title": "new"}], captured_at="", fingerprint="new"
        )
        engine = SimpleNamespace(
            dialect=SimpleNamespace(identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"'))
        )

        sql = self.service._table_changes(current, historical, engine, None)

        self.assertIn('SET "title" = \'old\'', sql)

    @patch("app.git_versioning.database_history.github_oauth_service")
    @patch("app.git_versioning.database_history.connection_manager")
    def test_table_history_lists_commits_for_compressed_table_path(self, connection_manager, github_service) -> None:
        request = SimpleNamespace(git_versioning_enabled=True, database_type="sqlite")
        connection_manager.get_connection_request.return_value = request
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.list_repository_commits.return_value = [
            SimpleNamespace(sha="abc123", message="DataDjinn: 更新数据", committed_at="2026-08-18T00:00:00Z")
        ]
        versions = self.service.list_table_versions("c1", None, "items")
        self.assertEqual("abc123", versions[0]["id"])
        github_service.list_repository_commits.assert_called_once_with(
            self.service.table_path("c1", None, "items"), per_page=30
        )

    @patch("app.git_versioning.database_history.git_task_registry")
    def test_async_snapshot_result_exposes_id_used_by_frontend_polling(self, task_registry) -> None:
        task_registry.start.return_value = SimpleNamespace(
            id="task-1", status="running", percent=0, detail="准备开始"
        )

        result = self.service.create_snapshot_async("c1")

        self.assertEqual("task-1", result.id)
        self.assertEqual("task-1", result.task_id)

    def test_async_snapshot_reuses_running_task_for_same_connection(self) -> None:
        from app.git_versioning.task_progress import GitTaskRegistry

        registry = GitTaskRegistry()
        release = threading.Event()
        first = registry.start("c1", "数据库 Git 快照", lambda task: (release.wait(1), None)[1])
        second = registry.start("c1", "数据库 Git 快照", lambda task: None)
        release.set()
        self.assertEqual(first.id, second.id)

    def test_git_task_percent_is_monotonic_across_snapshot_phases(self) -> None:
        task = GitTask(id="task-1", connection_id="c1", title="数据库 Git 快照", total=100)
        checkpoints = []
        for current, detail in ((2, "扫描完成"), (5, "结构读取完成"), (40, "正在读取并压缩"), (76, "正在生成变更 SQL"), (92, "正在上传快照文件"), (99, "远端提交完成")):
            task.current = current
            task.detail = detail
            checkpoints.append(task.percent)
        self.assertEqual(checkpoints, sorted(checkpoints))
        self.assertEqual(99, checkpoints[-1])

    @patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot")
    @patch("app.git_versioning.database_history.schema_versioning_service._selected_scopes")
    @patch("app.git_versioning.database_history.list_tables")
    @patch("app.git_versioning.database_history.github_oauth_service")
    @patch("app.git_versioning.database_history.connection_manager")
    def test_initial_snapshot_writes_manifest_compressed_table_and_change_sql_in_one_commit(
        self,
        connection_manager,
        github_service,
        list_tables,
        selected_scopes,
        capture_schema,
    ) -> None:
        connection_id = "c1"
        engine = SimpleNamespace(
            dialect=SimpleNamespace(
                identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"')
            )
        )
        snapshot = TableSnapshot(
            table_name="items",
            scope="APP",
            columns=["id", "title"],
            identity_columns=["id"],
            rows=[{"id": 1, "title": "first"}],
            captured_at="2026-08-19T00:00:00+00:00",
            fingerprint="table-fingerprint",
        )
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="dm",
            captured_at="2026-08-19T00:00:00+00:00",
            fingerprint="schema-fingerprint",
            objects=[
                SchemaSnapshotObject(
                    scope="APP", name="items", type="table", ddl="CREATE TABLE items (id BIGINT)"
                )
            ],
        )
        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=True, database_type="dm", git_versioning_scopes=["APP"]
        )
        connection_manager.get_engine.return_value = engine
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.return_value = None
        github_service.read_repository_file_bytes.return_value = None
        github_service.write_repository_files.return_value = SimpleNamespace(commit_sha="commit-1")
        list_tables.return_value = [SimpleNamespace(name="items")]
        selected_scopes.return_value = ["APP"]
        capture_schema.return_value = schema

        with patch.object(self.service, "_capture_table", return_value=snapshot):
            result = self.service._create_snapshot(
                connection_id,
                "初始化数据库 Git 快照",
                GitTask(id="task-1", connection_id=connection_id, title="数据库 Git 快照"),
            )

        files, message = github_service.write_repository_files.call_args.args
        manifest_path = self.service.manifest_path(connection_id)
        table_path = self.service.table_path(connection_id, "APP", "items")
        self.assertEqual("commit-1", result["commit_sha"])
        self.assertIn(manifest_path, files)
        self.assertIn(table_path, files)
        self.assertIn(self.service.changes_path(connection_id), files)
        manifest = json.loads(files[manifest_path])
        self.assertEqual("datadjinn-database-snapshot", manifest["format"])
        self.assertEqual(table_path, manifest["tables"][0]["path"])
        restored_table = TableSnapshot.model_validate_json(gzip.decompress(files[table_path]).decode("utf-8"))
        self.assertEqual(snapshot.rows, restored_table.rows)
        self.assertIn("CREATE TABLE items", gzip.decompress(files[self.service.changes_path(connection_id)]).decode("utf-8"))
        self.assertIn("初始化数据库 Git 快照", message)

    def test_initial_snapshot_aborts_when_total_data_exceeds_limit(self) -> None:
        from app.git_versioning import database_history

        connection_id = "c1"
        request = SimpleNamespace(
            git_versioning_enabled=True,
            database_type="sqlite",
            git_versioning_scopes=[],
        )
        schema = SchemaSnapshot(
            connection_id=connection_id,
            database_type="sqlite",
            captured_at="",
            fingerprint="schema",
        )
        snapshot = TableSnapshot(
            table_name="items",
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}],
            captured_at="",
            fingerprint="table",
        )
        with (
            patch.object(self.service, "_ensure_enabled", return_value=request),
            patch("app.git_versioning.database_history.connection_manager.get_engine", return_value=object()),
            patch("app.git_versioning.schema_history.schema_versioning_service._selected_scopes", return_value=[None]),
            patch("app.git_versioning.database_history.list_tables", return_value=[SimpleNamespace(name="items")]),
            patch("app.git_versioning.schema_history.schema_versioning_service._capture_snapshot", return_value=schema),
            patch("app.git_versioning.database_history.github_oauth_service") as github_service,
            patch.object(self.service, "_capture_table", return_value=snapshot),
            patch.object(database_history, "MAX_DATABASE_SNAPSHOT_UNCOMPRESSED_BYTES", 1),
        ):
            github_service.read_repository_file.return_value = None
            with self.assertRaisesRegex(ValueError, "超过 50 MB 上限"):
                self.service._create_snapshot(
                    connection_id,
                    "初始化数据库 Git 快照",
                    GitTask(id="task-1", connection_id=connection_id, title="数据库 Git 快照"),
                )
        github_service.write_repository_files.assert_not_called()

    @patch("app.git_versioning.database_history.github_oauth_service")
    @patch("app.git_versioning.database_history.connection_manager")
    def test_table_snapshot_uploads_only_current_table_files(
        self, connection_manager, github_service
    ) -> None:
        engine = SimpleNamespace(
            dialect=SimpleNamespace(identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"'))
        )
        request = SimpleNamespace(git_versioning_enabled=True, database_type="sqlite")
        schema = SchemaSnapshot(
            connection_id="c1", database_type="sqlite", captured_at="", fingerprint="schema",
            objects=[SchemaSnapshotObject(scope="main", name="items", type="table", ddl="CREATE TABLE items (id INT)")],
        )
        manifest = {"connection_id": "c1", "database_type": "sqlite", "captured_at": "", "fingerprint": "old", "schema": schema.model_dump(), "tables": [
            {"scope": "main", "table_name": "items", "path": self.service.table_path("c1", "main", "items"), "fingerprint": "old-table", "row_count": 1},
            {"scope": "main", "table_name": "other", "path": self.service.table_path("c1", "main", "other"), "fingerprint": "other", "row_count": 1},
        ]}
        previous = TableSnapshot(table_name="items", scope="main", columns=["id"], identity_columns=["id"], rows=[{"id": 1}], captured_at="", fingerprint="old-table")
        current = previous.model_copy(update={"rows": [{"id": 2}], "fingerprint": "new-table"})
        connection_manager.get_connection_request.return_value = request
        connection_manager.get_engine.return_value = engine
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.side_effect = [SimpleNamespace(content=json.dumps(manifest), sha="manifest-sha")]
        github_service.read_repository_file_bytes.return_value = gzip.compress(previous.model_dump_json().encode())
        github_service.write_repository_files.return_value = SimpleNamespace(commit_sha="commit-2")
        with patch.object(self.service, "_capture_table", return_value=current):
            result = self.service._create_table_snapshot("c1", "main", "items", "main", None, "保存表格数据", GitTask(id="task", connection_id="c1", title="表"))
        files, _ = github_service.write_repository_files.call_args.args
        self.assertEqual("commit-2", result["commit_sha"])
        self.assertEqual(
            {self.service.table_path("c1", "main", "items"), self.service.changes_path("c1")},
            set(files),
        )
        self.assertNotIn(self.service.manifest_path("c1"), files)

    @patch("app.git_versioning.database_history.github_oauth_service")
    @patch("app.git_versioning.database_history.connection_manager")
    def test_table_change_always_starts_a_visible_table_task_after_database_baseline(
        self, connection_manager, github_service
    ) -> None:
        background_tasks = BackgroundTasks()
        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=True, database_type="dm"
        )
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.return_value = SimpleNamespace(sha="manifest-sha")

        self.service.schedule_table_snapshot(
            background_tasks,
            "c1",
            "items",
            "APP",
            None,
            "创建表后快照",
            capture_schema=True,
        )

        self.assertEqual(1, len(background_tasks.tasks))
        task = background_tasks.tasks[0]
        self.assertIs(task.func.__func__, self.service.create_table_snapshot_async.__func__)
        self.assertEqual(("c1", "APP", "items", "APP", None, "创建表后快照", True), task.args)

    @patch("app.git_versioning.database_history.github_oauth_service")
    @patch("app.git_versioning.database_history.connection_manager")
    def test_created_table_snapshot_uploads_only_its_data_and_structure(self, connection_manager, github_service) -> None:
        engine = SimpleNamespace(dialect=SimpleNamespace(identifier_preparer=SimpleNamespace(quote=lambda value: f'"{value}"')))
        request = SimpleNamespace(git_versioning_enabled=True, database_type="sqlite", git_versioning_scopes=[])
        previous_schema = SchemaSnapshot(
            connection_id="c1", database_type="sqlite", captured_at="", fingerprint="empty"
        )
        current_schema = SchemaSnapshot(
            connection_id="c1",
            database_type="sqlite",
            captured_at="",
            fingerprint="with-items",
            objects=[SchemaSnapshotObject(scope=None, name="items", type="table", ddl="CREATE TABLE items (id INT)")],
        )
        current_table = TableSnapshot(
            table_name="items",
            columns=["id"],
            identity_columns=["id"],
            rows=[{"id": 1}],
            captured_at="",
            fingerprint="table",
        )
        github_service.read_repository_file.side_effect = [
            SimpleNamespace(sha="baseline", content="{}"),
            SimpleNamespace(content=previous_schema.model_dump_json()),
        ]
        github_service.read_repository_file_bytes.return_value = None
        github_service.write_repository_files.return_value = SimpleNamespace(commit_sha="created-table")
        connection_manager.get_engine.return_value = engine
        with (
            patch.object(self.service, "_ensure_enabled", return_value=request),
            patch.object(self.service, "_capture_table", return_value=current_table),
            patch("app.git_versioning.database_history.schema_versioning_service._capture_snapshot", return_value=current_schema),
            patch.object(self.service, "_table_changes", return_value="INSERT INTO items VALUES (1);"),
        ):
            result = self.service._create_table_snapshot(
                "c1", None, "items", None, None, "创建表后快照", GitTask(id="task", connection_id="c1", title="表"), True
            )

        files, _ = github_service.write_repository_files.call_args.args
        self.assertEqual("created-table", result["commit_sha"])
        self.assertEqual(
            {
                self.service.table_path("c1", None, "items"),
                self.service.changes_path("c1"),
                "versioning/schema/c1/snapshot.json",
            },
            set(files),
        )
        self.assertNotIn(self.service.manifest_path("c1"), files)
