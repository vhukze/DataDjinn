from __future__ import annotations

import gzip
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import BackgroundTasks

from app.git_versioning.database_history import DatabaseVersioningService, TableSnapshot
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

    def test_database_snapshot_uses_bounded_parallel_table_capture(self) -> None:
        from app.git_versioning.database_history import MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS

        self.assertEqual(4, MAX_DATABASE_SNAPSHOT_CAPTURE_WORKERS)

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
        self.assertEqual({self.service.manifest_path("c1"), self.service.table_path("c1", "main", "items"), self.service.changes_path("c1")}, set(files))
        updated_manifest = json.loads(files[self.service.manifest_path("c1")])
        self.assertEqual("other", updated_manifest["tables"][1]["table_name"])
        self.assertEqual("new-table", updated_manifest["tables"][0]["fingerprint"])

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
            background_tasks, "c1", "items", "APP", None, "保存表格数据"
        )

        self.assertEqual(1, len(background_tasks.tasks))
        task = background_tasks.tasks[0]
        self.assertIs(task.func.__func__, self.service.create_table_snapshot_async.__func__)
        self.assertEqual(("c1", "APP", "items", "APP", None, "保存表格数据"), task.args)
