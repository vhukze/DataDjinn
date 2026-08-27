from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import BackgroundTasks

from app.api.git_versioning import (
    UpdateVersioningScopesRequest,
    get_database_baseline,
    get_versioning_scopes,
    list_database_versions,
    update_versioning_scopes,
)
from app.api.query import query
from app.git_sync.github_oauth import GitHubRepositoryCommit, GitHubRepositoryFile, GitHubRepositoryWriteResult
from app.git_versioning.schema_history import (
    SchemaSnapshot,
    SchemaSnapshotObject,
    SchemaVersioningService,
    contains_schema_mutation,
)
from app.schemas.query import QueryRequest, QueryResponse


class SchemaVersioningServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = SchemaVersioningService()
        self.connection_id = "versioned-sqlite"
        self.request = SimpleNamespace(git_versioning_enabled=True, database_type="sqlite")
        self.snapshot = SchemaSnapshot(
            connection_id=self.connection_id,
            database_type="sqlite",
            captured_at="2026-08-15T00:00:00+00:00",
            fingerprint="schema-fingerprint",
            objects=[
                SchemaSnapshotObject(
                    name="items",
                    type="table",
                    ddl="CREATE TABLE items (id INTEGER PRIMARY KEY)",
                )
            ],
        )

    @patch("app.git_versioning.schema_history.github_oauth_service")
    @patch("app.git_versioning.schema_history.connection_manager")
    def test_creates_a_commit_for_a_new_schema_snapshot(self, connection_manager, github_service) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.return_value = None
        github_service.write_repository_file.return_value = GitHubRepositoryWriteResult(
            path=self.service.snapshot_path(self.connection_id), sha="content-sha"
        )
        github_service.list_repository_commits.return_value = [
            GitHubRepositoryCommit(sha="commit-sha", message="DataDjinn: 手动创建结构快照（1 个对象）")
        ]

        with patch.object(self.service, "_capture_snapshot", return_value=self.snapshot):
            result = self.service.create_snapshot(self.connection_id)

        self.assertTrue(result.changed)
        self.assertEqual("commit-sha", result.version_id)
        github_service.write_repository_file.assert_called_once()
        path, content, message = github_service.write_repository_file.call_args.args
        self.assertEqual(self.service.snapshot_path(self.connection_id), path)
        self.assertIn('"fingerprint":"schema-fingerprint"', content.replace(" ", ""))
        self.assertIn("手动创建结构快照", message)

    @patch("app.git_versioning.schema_history.github_oauth_service")
    @patch("app.git_versioning.schema_history.connection_manager")
    def test_unchanged_schema_does_not_create_another_commit(self, connection_manager, github_service) -> None:
        connection_manager.get_connection_request.return_value = self.request
        connection_manager.get_engine.return_value = object()
        github_service.status.return_value = SimpleNamespace(authorized=True)
        github_service.read_repository_file.return_value = GitHubRepositoryFile(
            path=self.service.snapshot_path(self.connection_id),
            sha="previous-content-sha",
            content=self.snapshot.model_dump_json(),
        )
        github_service.list_repository_commits.return_value = [
            GitHubRepositoryCommit(sha="previous-commit", message="DataDjinn: 初始基线（1 个对象）")
        ]

        with patch.object(self.service, "_capture_snapshot", return_value=self.snapshot):
            result = self.service.create_snapshot(self.connection_id)

        self.assertFalse(result.changed)
        self.assertEqual("previous-commit", result.version_id)
        github_service.write_repository_file.assert_not_called()

    @patch("app.db.metadata.get_object_ddl")
    @patch("app.db.metadata.list_db_objects")
    def test_captured_schema_has_a_stable_order_and_fingerprint(self, list_objects, get_ddl) -> None:
        list_objects.return_value = [
            SimpleNamespace(name="z_view", type="view"),
            SimpleNamespace(name="orders", type="table"),
            SimpleNamespace(name="accounts", type="table"),
        ]
        get_ddl.side_effect = lambda _engine, name, _type, _scope: f"DDL {name}"

        first = self.service._capture_snapshot(self.connection_id, "sqlite", object())
        second = self.service._capture_snapshot(self.connection_id, "sqlite", object())

        self.assertEqual(["accounts", "orders", "z_view"], [item.name for item in first.objects])
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual([], first.skipped_objects)

    @patch("app.db.metadata.get_object_ddl")
    @patch("app.db.metadata.list_db_objects")
    @patch("app.db.metadata.list_databases")
    def test_dameng_snapshot_includes_only_selected_schemas(
        self, list_databases, list_objects, get_ddl
    ) -> None:
        engine = object()
        list_databases.return_value = [
            SimpleNamespace(name="SYS"),
            SimpleNamespace(name="APP"),
            SimpleNamespace(name="AUDIT"),
        ]
        list_objects.return_value = [SimpleNamespace(name="orders", type="table")]
        get_ddl.return_value = "CREATE TABLE orders (id BIGINT)"

        snapshot = self.service._capture_snapshot(
            self.connection_id, "dm", engine, ["APP"]
        )

        self.assertEqual(["APP"], [item.scope for item in snapshot.objects])
        list_objects.assert_called_once_with(engine, "APP", include_stats=False)
        get_ddl.assert_called_once_with(engine, "orders", "table", "APP")

    @patch("app.git_versioning.schema_history.connection_manager")
    @patch("app.db.metadata.list_databases")
    def test_dameng_scope_config_excludes_system_schemas_and_keeps_selection(
        self, list_databases, connection_manager
    ) -> None:
        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=True,
            database_type="dm",
            git_versioning_scopes=["app"],
        )
        connection_manager.ensure_connection_available.return_value = True
        connection_manager.get_engine.return_value = object()
        list_databases.return_value = [
            SimpleNamespace(name="SYS"),
            SimpleNamespace(name="APP"),
            SimpleNamespace(name="REPORT"),
        ]

        config = self.service.get_scope_config(self.connection_id)

        self.assertEqual(config.scope_kind, "schema")
        self.assertEqual(config.available_scopes, ["APP", "REPORT"])
        self.assertEqual(config.selected_scopes, ["APP"])
        connection_manager.ensure_connection_available.assert_called_once_with(self.connection_id)

    @patch("app.db.metadata.list_databases", return_value=[SimpleNamespace(name="REPORT")])
    def test_refuses_to_overwrite_history_when_selected_schema_no_longer_exists(
        self, _list_databases
    ) -> None:
        with self.assertRaisesRegex(ValueError, "已不存在"):
            self.service._capture_snapshot(self.connection_id, "dm", object(), ["APP"])

    @patch("app.api.git_versioning.schema_versioning_service")
    def test_scope_api_forwards_read_and_update_requests(self, service) -> None:
        config = SimpleNamespace(scope_kind="schema", available_scopes=["APP"], selected_scopes=["APP"])
        service.get_scope_config.return_value = config
        service.update_scope_config.return_value = config

        self.assertIs(get_versioning_scopes(self.connection_id), config)
        self.assertIs(
            update_versioning_scopes(
                self.connection_id, UpdateVersioningScopesRequest(selected_scopes=["APP"])
            ),
            config,
        )
        service.get_scope_config.assert_called_once_with(self.connection_id)
        service.update_scope_config.assert_called_once_with(self.connection_id, ["APP"])

    @patch("app.api.git_versioning.database_versioning_service")
    def test_database_versions_api_uses_database_snapshot_history(self, database_service) -> None:
        database_service.list_versions.return_value = [
            {"id": "commit-1", "message": "DataDjinn: 初始数据库快照", "committed_at": "2026-08-19T00:00:00Z"}
        ]

        versions = list_database_versions(self.connection_id, 20)

        self.assertEqual("commit-1", versions[0].id)
        database_service.list_versions.assert_called_once_with(self.connection_id, 20)

    @patch("app.api.git_versioning.github_oauth_service")
    @patch("app.api.git_versioning.database_versioning_service")
    def test_database_baseline_api_checks_manifest_presence(self, database_service, github_service) -> None:
        database_service._ensure_enabled.return_value = self.request
        database_service.manifest_path.return_value = "versioning/database/c1/manifest.json"
        github_service.read_repository_file.return_value = object()

        result = get_database_baseline(self.connection_id)

        self.assertEqual({"exists": True}, result)
        github_service.read_repository_file.assert_called_once_with(
            "versioning/database/c1/manifest.json"
        )

    @patch("app.git_versioning.schema_history.github_oauth_service")
    @patch("app.git_versioning.schema_history.connection_manager")
    def test_rejects_non_relational_connection_types(self, connection_manager, github_service) -> None:
        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=True, database_type="redis"
        )
        github_service.status.return_value = SimpleNamespace(authorized=True)

        with self.assertRaisesRegex(ValueError, "Redis"):
            self.service.create_snapshot(self.connection_id)

    def test_detects_only_explicit_schema_mutation_statements(self) -> None:
        self.assertTrue(contains_schema_mutation("-- baseline\nCREATE TABLE items (id INTEGER)"))
        self.assertTrue(contains_schema_mutation("SELECT 1; ALTER TABLE items ADD COLUMN title TEXT"))
        self.assertTrue(contains_schema_mutation("/* cleanup */\nDROP VIEW summary"))
        self.assertFalse(contains_schema_mutation("SELECT * FROM items WHERE title = 'create table'"))
        self.assertFalse(contains_schema_mutation("SELECT '; ALTER TABLE items ADD COLUMN ignored'"))
        self.assertFalse(contains_schema_mutation("UPDATE items SET title = 'new'"))

    @patch("app.api.query.schema_versioning_service.schedule_snapshot")
    @patch("app.api.query.execute_query")
    @patch("app.api.query.connection_manager.get_engine")
    def test_sql_editor_schedules_snapshots_only_after_schema_changes(
        self, get_engine, execute_query, schedule_snapshot
    ) -> None:
        get_engine.return_value = object()
        execute_query.return_value = QueryResponse(columns=[], rows=[], row_count=0, limited=False)
        background_tasks = BackgroundTasks()

        query(
            QueryRequest(connection_id=self.connection_id, sql="ALTER TABLE items ADD COLUMN title TEXT"),
            background_tasks,
        )
        schedule_snapshot.assert_called_once_with(
            background_tasks, self.connection_id, "SQL 编辑器执行结构变更"
        )

        schedule_snapshot.reset_mock()
        query(QueryRequest(connection_id=self.connection_id, sql="SELECT * FROM items"), background_tasks)
        schedule_snapshot.assert_not_called()

    @patch("app.git_versioning.schema_history.github_oauth_service")
    @patch("app.git_versioning.schema_history.connection_manager")
    def test_schedules_automatic_snapshot_only_for_an_authorized_versioned_connection(
        self, connection_manager, github_service
    ) -> None:
        background_tasks = SimpleNamespace(add_task=Mock())
        connection_manager.get_connection_request.return_value = self.request
        github_service.status.return_value = SimpleNamespace(authorized=True)

        self.service.schedule_snapshot(background_tasks, self.connection_id, "创建表 items")

        background_tasks.add_task.assert_called_once_with(
            self.service._create_snapshot_safely, self.connection_id, "创建表 items"
        )

        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=False, database_type="sqlite", git_versioning_scopes=[]
        )
        self.service.schedule_snapshot(background_tasks, self.connection_id, "不应创建")
        background_tasks.add_task.assert_called_once()

        connection_manager.get_connection_request.return_value = SimpleNamespace(
            git_versioning_enabled=True, database_type="dm", git_versioning_scopes=[]
        )
        self.service.schedule_snapshot(background_tasks, self.connection_id, "未选择范围")
        background_tasks.add_task.assert_called_once()


if __name__ == "__main__":
    unittest.main()
