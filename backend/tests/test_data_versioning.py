from __future__ import annotations

import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import BackgroundTasks

from app.api import metadata as metadata_api
from app.data_versioning_runtime import (
    DATA_VERSIONING_MODULE_ENV,
    DataVersioningModuleUnavailable,
    _load_data_versioning_module,
    get_data_versioning_service,
)
from app.git_sync.github_oauth import (
    GitHubRepositoryCommit,
    GitHubRepositoryFile,
    GitHubRepositoryWriteResult,
)
from app.git_versioning.data_history import (
    DATA_SNAPSHOT_MAX_ROWS,
    DataVersioningService,
    TableDataSnapshot,
)
from app.api.git_versioning import CreateDataSnapshotRequest, create_data_snapshot, list_data_versions
from app.schemas.query import QueryResponse
from app.schemas.metadata import TableDataChangeRequest


class DataVersioningServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = DataVersioningService()
        self.connection_id = "versioned-sqlite"
        self.request = SimpleNamespace(git_versioning_enabled=True, database_type="sqlite")

    def test_data_versioning_requires_the_optional_runtime_module(self) -> None:
        previous = os.environ.pop(DATA_VERSIONING_MODULE_ENV, None)
        _load_data_versioning_module.cache_clear()
        try:
            with self.assertRaises(DataVersioningModuleUnavailable):
                get_data_versioning_service()
        finally:
            if previous is not None:
                os.environ[DATA_VERSIONING_MODULE_ENV] = previous
            _load_data_versioning_module.cache_clear()

    @patch("app.git_versioning.data_history.github_oauth_service")
    @patch("app.git_versioning.data_history.connection_manager")
    @patch("app.db.metadata.list_columns")
    @patch("app.git_versioning.data_history.preview_table")
    def test_creates_data_snapshot_with_primary_key_identity(
        self, preview, list_columns, connection_manager, github_service
    ) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.return_value = None
        github_service.write_repository_file.return_value = GitHubRepositoryWriteResult(
            path=self.service.snapshot_path(self.connection_id, "items"), sha="content-sha"
        )
        github_service.list_repository_commits.return_value = [
            GitHubRepositoryCommit(sha="commit-sha", message="DataDjinn: 数据快照")
        ]
        list_columns.return_value = [
            SimpleNamespace(name="id", primary_key=True, unique=False),
            SimpleNamespace(name="title", primary_key=False, unique=False),
        ]
        preview.return_value = QueryResponse(
            columns=["id", "title"],
            rows=[{"id": 1, "title": "第一条"}],
            row_count=1,
            limited=False,
        )

        result = self.service.create_snapshot(self.connection_id, "items")

        self.assertTrue(result.changed)
        self.assertEqual(result.snapshot.identity_mode, "primary_key")
        self.assertEqual(result.snapshot.identity_columns, ["id"])
        self.assertEqual(result.snapshot.rows, [{"id": 1, "title": "第一条"}])
        self.assertEqual(preview.call_args.kwargs["sort_column"], "id")
        github_service.write_repository_file.assert_called_once()

    @patch("app.git_versioning.data_history.github_oauth_service")
    @patch("app.git_versioning.data_history.connection_manager")
    @patch("app.db.metadata.list_columns")
    @patch("app.git_versioning.data_history.preview_table")
    def test_unchanged_data_does_not_create_another_commit(
        self, preview, list_columns, connection_manager, github_service
    ) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        list_columns.return_value = [SimpleNamespace(name="id", primary_key=True, unique=False)]
        preview.return_value = QueryResponse(
            columns=["id"], rows=[{"id": 1}], row_count=1, limited=False
        )
        snapshot = self.service._capture_snapshot(
            self.connection_id, "sqlite", object(), "items", None, None
        )
        github_service.read_repository_file.return_value = GitHubRepositoryFile(
            path=self.service.snapshot_path(self.connection_id, "items"),
            sha="old-sha",
            content=snapshot.model_dump_json(),
        )
        github_service.list_repository_commits.return_value = [
            GitHubRepositoryCommit(sha="old-commit", message="DataDjinn: 初始数据快照")
        ]

        result = self.service.create_snapshot(self.connection_id, "items")

        self.assertFalse(result.changed)
        self.assertEqual(result.version_id, "old-commit")
        github_service.write_repository_file.assert_not_called()

    @patch("app.git_versioning.data_history.github_oauth_service")
    @patch("app.git_versioning.data_history.connection_manager")
    @patch("app.db.metadata.list_columns")
    @patch("app.git_versioning.data_history.preview_table")
    def test_table_without_primary_or_unique_key_is_snapshot_only(
        self, preview, list_columns, connection_manager, github_service
    ) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        list_columns.return_value = [SimpleNamespace(name="title", primary_key=False, unique=False)]
        preview.return_value = QueryResponse(
            columns=["title"], rows=[{"title": "无标识"}], row_count=1, limited=False
        )

        snapshot = self.service._capture_snapshot(
            self.connection_id, "sqlite", object(), "logs", None, None
        )

        self.assertEqual(snapshot.identity_mode, "snapshot_only")
        self.assertEqual(snapshot.identity_columns, [])
        self.assertIsNone(preview.call_args.kwargs["sort_column"])

    @patch("app.git_versioning.data_history.github_oauth_service")
    @patch("app.git_versioning.data_history.connection_manager")
    @patch("app.db.metadata.list_columns")
    @patch("app.git_versioning.data_history.preview_table")
    def test_refuses_table_larger_than_snapshot_row_limit(
        self, preview, list_columns, connection_manager, github_service
    ) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        list_columns.return_value = [SimpleNamespace(name="id", primary_key=True, unique=False)]
        preview.return_value = QueryResponse(
            columns=["id"],
            rows=[{"id": index} for index in range(DATA_SNAPSHOT_MAX_ROWS + 1)],
            row_count=DATA_SNAPSHOT_MAX_ROWS + 1,
            limited=True,
        )

        with self.assertRaisesRegex(ValueError, "超过"):
            self.service.create_snapshot(self.connection_id, "large_items")

    def test_snapshot_paths_do_not_expose_table_names_or_scopes(self) -> None:
        path = self.service.snapshot_path(
            self.connection_id, "Orders / 2026", "生产 schema", "业务库"
        )

        self.assertTrue(path.startswith(f"versioning/data/{self.connection_id}/"))
        self.assertTrue(path.endswith("/snapshot.json"))
        self.assertNotIn("Orders", path)
        self.assertNotIn("生产", path)

    @patch("app.git_versioning.data_history.connection_manager")
    def test_compares_current_rows_with_historical_snapshot_by_primary_key(
        self, connection_manager
    ) -> None:
        historical = TableDataSnapshot(
            connection_id=self.connection_id,
            database_type="sqlite",
            table_name="items",
            captured_at="2026-01-01T00:00:00+00:00",
            fingerprint="historical",
            columns=["id", "title"],
            identity_columns=["id"],
            identity_mode="primary_key",
            rows=[{"id": 1, "title": "旧标题"}, {"id": 2, "title": "已删除"}],
        )
        current = historical.model_copy(
            update={
                "fingerprint": "current",
                "rows": [{"id": 1, "title": "新标题"}, {"id": 3, "title": "新增"}],
            }
        )
        connection_manager.get_engine.return_value = object()
        with patch.object(self.service, "get_version", return_value=historical), patch.object(
            self.service, "_ensure_versioning_enabled", return_value=self.request
        ), patch.object(self.service, "_capture_snapshot", return_value=current):
            result = self.service.diff_version(self.connection_id, "items", "history-sha")

        self.assertEqual([change.identity for change in result.added], [{"id": 3}])
        self.assertEqual([change.identity for change in result.deleted], [{"id": 2}])
        self.assertEqual([change.identity for change in result.updated], [{"id": 1}])
        self.assertEqual(result.updated[0].changed_columns, ["title"])

    def test_refuses_row_diff_for_snapshot_without_identity(self) -> None:
        snapshot = TableDataSnapshot(
            connection_id=self.connection_id,
            database_type="sqlite",
            table_name="logs",
            captured_at="2026-01-01T00:00:00+00:00",
            fingerprint="snapshot-only",
            columns=["message"],
            rows=[{"message": "entry"}],
        )
        with patch.object(self.service, "get_version", return_value=snapshot):
            with self.assertRaisesRegex(ValueError, "不能生成行级差异"):
                self.service.diff_version(self.connection_id, "logs", "history-sha")

    @patch("app.git_versioning.data_history.github_oauth_service")
    @patch("app.git_versioning.data_history.connection_manager")
    def test_schedules_data_snapshot_only_for_a_managed_authorized_table(
        self, connection_manager, github_service
    ) -> None:
        background_tasks = SimpleNamespace(add_task=Mock())
        connection_manager.get_connection_request.return_value = self.request
        github_service.status.return_value = SimpleNamespace(authorized=True)

        self.service.schedule_snapshot(
            background_tasks,
            self.connection_id,
            "items",
            "main",
            None,
            "保存表格数据",
        )

        background_tasks.add_task.assert_called_once_with(
            self.service._create_snapshot_if_managed_safely,
            self.connection_id,
            "items",
            "main",
            None,
            "保存表格数据",
        )

        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=False, database_type="sqlite"
        )
        self.service.schedule_snapshot(background_tasks, self.connection_id, "items")
        background_tasks.add_task.assert_called_once()

    @patch("app.git_versioning.data_history.github_oauth_service")
    def test_automatic_snapshot_skips_tables_without_an_initial_snapshot(self, github_service) -> None:
        github_service.read_repository_file.return_value = None

        self.service._create_snapshot_if_managed_safely(
            self.connection_id, "items", None, None, "保存表格数据"
        )

        github_service.read_repository_file.assert_called_once_with(
            self.service.snapshot_path(self.connection_id, "items", None, None)
        )

    @patch("app.git_versioning.data_history.github_oauth_service")
    def test_automatic_snapshot_creates_a_new_version_for_a_managed_table(self, github_service) -> None:
        github_service.read_repository_file.return_value = GitHubRepositoryFile(
            path=self.service.snapshot_path(self.connection_id, "items"),
            sha="initial-snapshot",
            content="{}",
        )

        with patch.object(self.service, "create_snapshot") as create_snapshot:
            self.service._create_snapshot_if_managed_safely(
                self.connection_id, "items", "main", "business", "保存表格数据"
            )

        create_snapshot.assert_called_once_with(
            self.connection_id, "items", "main", "business", "保存表格数据"
        )

    @patch("app.api.metadata.schedule_data_snapshot")
    @patch.object(metadata_api, "preview_table")
    @patch.object(metadata_api, "apply_table_data_changes")
    @patch.object(metadata_api.connection_manager, "get_engine")
    def test_table_preview_save_schedules_data_snapshot(
        self, get_engine, apply_changes, preview, schedule_snapshot
    ) -> None:
        engine = object()
        get_engine.return_value = engine
        preview.return_value = QueryResponse(columns=["id"], rows=[{"id": 1}], row_count=1, limited=False)
        background_tasks = BackgroundTasks()

        response = metadata_api.update_table_data(
            self.connection_id,
            "items",
            TableDataChangeRequest(updated=[{"original": {"id": 1}, "values": {"id": 1}}]),
            background_tasks,
            database="main",
            pg_database="business",
        )

        self.assertEqual(response.rows, [{"id": 1}])
        apply_changes.assert_called_once_with(
            engine,
            "items",
            unittest.mock.ANY,
            "main",
            "business",
        )
        schedule_snapshot.assert_called_once_with(
            background_tasks,
            self.connection_id,
            "items",
            "main",
            "business",
            "保存表格数据",
        )

    @patch("app.api.git_versioning.get_data_versioning_service")
    def test_data_snapshot_api_forwards_table_scope_and_reason(self, service) -> None:
        service.return_value.create_snapshot.return_value = SimpleNamespace(changed=True)
        request = CreateDataSnapshotRequest(
            table_name="orders", database="sales", pg_database="business", reason="发布前基线"
        )

        result = create_data_snapshot(self.connection_id, request)

        self.assertTrue(result.changed)
        service.return_value.create_snapshot.assert_called_once_with(
            self.connection_id, "orders", "sales", "business", "发布前基线"
        )

    @patch("app.api.git_versioning.get_data_versioning_service")
    def test_data_version_api_forwards_table_scope(self, service) -> None:
        service.return_value.list_versions.return_value = []

        result = list_data_versions(self.connection_id, "orders", "sales", "business", 10)

        self.assertEqual(result, [])
        service.return_value.list_versions.assert_called_once_with(
            self.connection_id, "orders", "sales", "business", 10
        )


if __name__ == "__main__":
    unittest.main()
