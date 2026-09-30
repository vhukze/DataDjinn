import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from fastapi import HTTPException

from app.api.git_sync import (
    SYNC_PAYLOAD_PATH,
    DeviceAuthorizationPollRequest,
    SyncFileStatusResponse,
    SyncFilePullRequest,
    SyncFilePushRequest,
    get_sync_file_status,
    poll_device_authorization,
    pull_sync_file,
    push_sync_file,
)
from app.api.git_versioning import list_database_versions, list_table_git_versions
from app.git_sync.github_oauth import (
    GitHubRepositoryFile,
    GitHubRepositoryWriteResult,
    GitHubSyncRepository,
)


class GitSyncApiTests(unittest.TestCase):
    def test_database_version_list_marks_remote_history_unavailable_when_local_versions_exist(self) -> None:
        local_version = {
            "id": "local-checkpoint",
            "message": "本机快照",
            "captured_at": "2026-09-29T10:00:00+00:00",
            "status": "local_only",
            "remote_commit_id": None,
            "error": None,
        }
        with (
            patch(
                "app.api.git_versioning.database_versioning_service.list_local_versions",
                return_value=[local_version],
            ),
            patch(
                "app.api.git_versioning.database_versioning_service.list_versions",
                side_effect=RuntimeError("network unavailable"),
            ),
        ):
            versions = list_database_versions("c1")

        self.assertEqual("remote_error", versions[0].status)
        self.assertIn("network unavailable", versions[0].error)
        self.assertEqual("local-checkpoint", versions[1].id)

    def test_table_version_list_keeps_local_history_and_marks_remote_error(self) -> None:
        local_version = {
            "id": "local-table-snapshot",
            "message": "本机表快照",
            "committed_at": "2026-09-29T10:00:00+00:00",
            "status": "error",
            "remote_commit_id": None,
            "error": "offline",
        }
        with (
            patch(
                "app.api.git_versioning.database_versioning_service.list_local_table_versions",
                return_value=[local_version],
            ),
            patch(
                "app.api.git_versioning.database_versioning_service.list_table_versions",
                side_effect=RuntimeError("network unavailable"),
            ),
        ):
            versions = list_table_git_versions("c1", "items")

        self.assertEqual("remote_error", versions[0]["status"])
        self.assertEqual("local-table-snapshot", versions[1]["id"])

    def test_successful_github_authorization_resumes_pending_database_snapshot_syncs(self) -> None:
        with patch(
            "app.api.git_sync.github_oauth_service.poll_device_authorization",
            return_value={"status": "authorized", "auth": {"authorized": True}},
        ), patch(
            "app.git_versioning.database_history.database_versioning_service.resume_pending_local_syncs"
        ) as resume_syncs:
            result = poll_device_authorization(DeviceAuthorizationPollRequest(session_id="session-1"))

        self.assertEqual("authorized", result.status)
        resume_syncs.assert_called_once_with()

    def test_pending_github_authorization_does_not_start_database_snapshot_syncs(self) -> None:
        with patch(
            "app.api.git_sync.github_oauth_service.poll_device_authorization",
            return_value={"status": "pending", "interval_seconds": 5},
        ), patch(
            "app.git_versioning.database_history.database_versioning_service.resume_pending_local_syncs"
        ) as resume_syncs:
            result = poll_device_authorization(DeviceAuthorizationPollRequest(session_id="session-1"))

        self.assertEqual("pending", result.status)
        resume_syncs.assert_not_called()

    def test_remote_status_exposes_existing_repository_and_payload_without_passphrase(self) -> None:
        repository = GitHubSyncRepository(
            full_name="vhukze/datadjinn-sync-existing",
            html_url="https://github.com/vhukze/datadjinn-sync-existing",
        )
        remote_file = GitHubRepositoryFile(
            path=SYNC_PAYLOAD_PATH,
            sha="remote-sha",
            content="encrypted-payload",
        )
        with patch(
            "app.api.git_sync.github_oauth_service.find_sync_repository",
            return_value=repository,
        ), patch(
            "app.api.git_sync.github_oauth_service.read_repository_file",
            return_value=remote_file,
        ):
            result = get_sync_file_status()

        self.assertIsInstance(result, SyncFileStatusResponse)
        self.assertTrue(result.exists)
        self.assertEqual(result.sha, "remote-sha")
        self.assertEqual(result.repository.full_name, repository.full_name)

    def test_remote_status_without_repository_does_not_create_or_read_one(self) -> None:
        with patch(
            "app.api.git_sync.github_oauth_service.find_sync_repository",
            return_value=None,
        ), patch(
            "app.api.git_sync.github_oauth_service.read_repository_file"
        ) as read_repository_file:
            result = get_sync_file_status()

        self.assertFalse(result.exists)
        self.assertIsNone(result.repository)
        read_repository_file.assert_not_called()

    def test_first_pull_reports_missing_remote_payload(self) -> None:
        with patch("app.api.git_sync.github_oauth_service.read_repository_file", return_value=None):
            result = pull_sync_file(SyncFilePullRequest(passphrase="同步口令-123456"))

        self.assertFalse(result.exists)
        self.assertIsNone(result.sha)
        self.assertIsNone(result.payload)

    def test_push_then_pull_round_trips_encrypted_payload(self) -> None:
        payload = {
            "format": "datadjinn-sync",
            "version": 1,
            "device_id": "test-device",
            "connections": {"connection-1": {"name": "生产库", "password": "秘密"}},
        }
        captured_content = ""

        def capture_write(path: str, content: str, message: str, *, sha: str | None = None):
            nonlocal captured_content
            captured_content = content
            self.assertEqual(path, SYNC_PAYLOAD_PATH)
            self.assertEqual(sha, "old-sha")
            return GitHubRepositoryWriteResult(path=path, sha="new-sha")

        with patch(
            "app.api.git_sync.github_oauth_service.write_repository_file",
            side_effect=capture_write,
        ):
            pushed = push_sync_file(
                SyncFilePushRequest(
                    passphrase="同步口令-123456",
                    payload=payload,
                    remote_sha="old-sha",
                )
            )

        self.assertEqual(pushed.sha, "new-sha")
        self.assertNotIn("生产库", captured_content)
        self.assertNotIn("秘密", captured_content)

        with patch(
            "app.api.git_sync.github_oauth_service.read_repository_file",
            return_value=GitHubRepositoryFile(
                path=SYNC_PAYLOAD_PATH,
                sha="new-sha",
                content=captured_content,
            ),
        ):
            pulled = pull_sync_file(SyncFilePullRequest(passphrase="同步口令-123456"))

        self.assertTrue(pulled.exists)
        self.assertEqual(pulled.sha, "new-sha")
        self.assertEqual(pulled.payload.model_dump(mode="json"), {
            **payload,
            "generated_at": pulled.payload.generated_at.isoformat().replace("+00:00", "Z"),
            "settings": {},
            "preferences": {},
        })

    def test_push_maps_stale_sha_to_conflict(self) -> None:
        stale_error = HTTPError(
            "https://api.github.com/file",
            409,
            "Conflict",
            hdrs=None,
            fp=io.BytesIO(json.dumps({"message": "sha does not match"}).encode("utf-8")),
        )
        with patch(
            "app.api.git_sync.github_oauth_service.write_repository_file",
            side_effect=stale_error,
        ), self.assertRaises(HTTPException) as raised:
            push_sync_file(
                SyncFilePushRequest(
                    passphrase="同步口令-123456",
                    payload={"version": 1, "device_id": "test-device"},
                    remote_sha="stale-sha",
                )
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("远程同步内容已发生变化", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
