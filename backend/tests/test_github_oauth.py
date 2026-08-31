import io
import base64
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from app.git_sync.github_oauth import GitHubOAuthService
from app.git_sync import github_oauth as github_oauth_module


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class GitHubOAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.data_dir_patch = patch.object(github_oauth_module, "_data_dir", return_value=self.data_dir)
        self.data_dir_patch.start()
        self.service = GitHubOAuthService()

    def tearDown(self) -> None:
        self.data_dir_patch.stop()
        self.temp_dir.cleanup()

    def test_device_authorization_requests_repository_and_secret_gist_scopes(self) -> None:
        with patch.object(
            github_oauth_module,
            "urlopen",
            return_value=FakeResponse(
                {
                    "device_code": "device-code",
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://github.com/login/device",
                    "verification_uri_complete": "https://github.com/login/device?user_code=ABCD-EFGH",
                    "expires_in": 900,
                    "interval": 3,
                }
            ),
        ) as urlopen:
            authorization = self.service.start_device_authorization()

        self.assertEqual(authorization.user_code, "ABCD-EFGH")
        self.assertEqual(authorization.interval_seconds, 3)
        self.assertIn(authorization.session_id, self.service._pending_authorizations)
        request = urlopen.call_args.args[0]
        self.assertIn(b"scope=repo", request.data)
        self.assertIn(b"gist", request.data)

    def test_authorized_device_flow_encrypts_token_and_restores_account_status(self) -> None:
        with patch.object(
            github_oauth_module,
            "urlopen",
            side_effect=[
                FakeResponse(
                    {
                        "device_code": "device-code",
                        "user_code": "ABCD-EFGH",
                        "verification_uri": "https://github.com/login/device",
                        "expires_in": 900,
                    }
                ),
                FakeResponse({"access_token": "github-token", "token_type": "bearer"}),
                FakeResponse(
                    {
                        "login": "vhukze",
                        "name": "DataDjinn User",
                        "avatar_url": "https://avatars.githubusercontent.com/u/1",
                    }
                ),
            ],
        ), patch.object(
            github_oauth_module, "_encrypt_password", side_effect=lambda value: f"encrypted:{value}"
        ), patch.object(
            github_oauth_module,
            "_decrypt_password",
            side_effect=lambda value: value.removeprefix("encrypted:"),
        ):
            authorization = self.service.start_device_authorization()
            result = self.service.poll_device_authorization(authorization.session_id)

        self.assertEqual(result["status"], "authorized")
        self.assertEqual(result["auth"]["login"], "vhukze")
        stored = json.loads((self.data_dir / "github-sync.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["encrypted_access_token"], "encrypted:github-token")
        self.assertNotIn("github-token", json.dumps({key: value for key, value in stored.items() if key != "encrypted_access_token"}))

    def test_pending_device_flow_does_not_finish_or_store_a_token(self) -> None:
        pending_error = HTTPError(
            "https://github.com/login/oauth/access_token",
            400,
            "Bad Request",
            hdrs=None,
            fp=io.BytesIO(json.dumps({"error": "authorization_pending"}).encode("utf-8")),
        )
        with patch.object(
            github_oauth_module,
            "urlopen",
            side_effect=[
                FakeResponse(
                    {
                        "device_code": "device-code",
                        "user_code": "ABCD-EFGH",
                        "verification_uri": "https://github.com/login/device",
                        "expires_in": 900,
                    }
                ),
                pending_error,
            ],
        ):
            authorization = self.service.start_device_authorization()
            result = self.service.poll_device_authorization(authorization.session_id)

        self.assertEqual(result["status"], "pending")
        self.assertFalse((self.data_dir / "github-sync.json").exists())

    def test_device_authorization_retries_transient_proxy_tls_failure(self) -> None:
        with patch.object(
            github_oauth_module,
            "urlopen",
            side_effect=[
                URLError("<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING]>"),
                FakeResponse(
                    {
                        "device_code": "device-code",
                        "user_code": "ABCD-EFGH",
                        "verification_uri": "https://github.com/login/device",
                        "expires_in": 900,
                        "interval": 3,
                    }
                ),
            ],
        ):
            authorization = self.service.start_device_authorization()

        self.assertEqual(authorization.user_code, "ABCD-EFGH")

    def test_pending_device_flow_accepts_a_success_response_with_error_payload(self) -> None:
        with patch.object(
            github_oauth_module,
            "urlopen",
            side_effect=[
                FakeResponse(
                    {
                        "device_code": "device-code",
                        "user_code": "ABCD-EFGH",
                        "verification_uri": "https://github.com/login/device",
                        "expires_in": 900,
                    }
                ),
                FakeResponse(
                    {
                        "error": "authorization_pending",
                        "error_description": "The authorization request is still pending",
                    }
                ),
            ],
        ):
            authorization = self.service.start_device_authorization()
            result = self.service.poll_device_authorization(authorization.session_id)

        self.assertEqual(result["status"], "pending")
        self.assertFalse((self.data_dir / "github-sync.json").exists())

    def test_sign_out_removes_the_local_authorization_store(self) -> None:
        store_path = self.data_dir / "github-sync.json"
        store_path.write_text(json.dumps({"encrypted_access_token": "encrypted:token"}), encoding="utf-8")

        self.service.sign_out()

        self.assertFalse(store_path.exists())

    def test_initializes_private_repository_and_persists_its_location(self) -> None:
        (self.data_dir / "github-sync.json").write_text(
            json.dumps({"encrypted_access_token": "encrypted:token"}), encoding="utf-8"
        )
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                [],
                {"full_name": "vhukze/datadjinn-sync-a1b2c3d4", "html_url": "https://github.com/vhukze/datadjinn-sync-a1b2c3d4"},
                {},
            ],
        ) as github_request:
            repository = self.service.ensure_sync_repository()

        self.assertEqual(repository.full_name, "vhukze/datadjinn-sync-a1b2c3d4")
        self.assertEqual(github_request.call_args_list[1].args[0:2], ("POST", "/user/repos"))
        stored = json.loads((self.data_dir / "github-sync.json").read_text(encoding="utf-8"))
        self.assertEqual(stored["repository_full_name"], repository.full_name)

    def test_discovers_existing_repository_from_private_pointer_on_new_device(self) -> None:
        (self.data_dir / "github-sync.json").write_text(
            json.dumps({"encrypted_access_token": "encrypted:token"}), encoding="utf-8"
        )
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                [{"id": "pointer-1", "description": github_oauth_module.SYNC_POINTER_DESCRIPTION}],
                {
                    "files": {
                        github_oauth_module.SYNC_POINTER_FILE: {
                            "content": json.dumps({"repository": "vhukze/datadjinn-sync-existing"})
                        }
                    }
                },
                {
                    "full_name": "vhukze/datadjinn-sync-existing",
                    "html_url": "https://github.com/vhukze/datadjinn-sync-existing",
                },
            ],
        ) as github_request:
            repository = self.service.ensure_sync_repository()

        self.assertEqual(repository.full_name, "vhukze/datadjinn-sync-existing")
        self.assertEqual(github_request.call_args_list[0].args[0:2], ("GET", "/gists?per_page=100"))
        self.assertEqual(github_request.call_args_list[2].args[0:2], ("GET", "/repos/vhukze/datadjinn-sync-existing"))
        self.assertNotIn("POST", [call.args[0] for call in github_request.call_args_list])

    def test_reads_repository_file_and_decodes_utf8_content(self) -> None:
        self._store_authorized_repository()
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                self._repository_response(),
                {
                    "sha": "remote-sha",
                    "content": base64.b64encode("{\"name\":\"同步配置\"}".encode("utf-8")).decode("ascii"),
                },
            ],
        ) as github_request:
            repository_file = self.service.read_repository_file("sync/config.json")

        self.assertIsNotNone(repository_file)
        self.assertEqual(repository_file.sha, "remote-sha")
        self.assertEqual(repository_file.content, '{"name":"同步配置"}')
        self.assertEqual(
            github_request.call_args_list[1].args[1],
            "/repos/vhukze/datadjinn-sync-a1b2c3d4/contents/sync/config.json",
        )

    def test_reads_large_repository_file_from_git_blob_when_contents_omits_content(self) -> None:
        self._store_authorized_repository()
        expected = gzip.compress(b"large compressed snapshot", mtime=0)
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                self._repository_response(),
                {"sha": "large-blob-sha", "encoding": "none", "size": len(expected)},
                {"sha": "large-blob-sha", "encoding": "base64", "content": base64.b64encode(expected).decode("ascii")},
            ],
        ) as github_request:
            content = self.service.read_repository_file_bytes("versioning/database/c1/changes.sql.gz", ref="commit-1")

        self.assertEqual(expected, content)
        self.assertEqual(
            "/repos/vhukze/datadjinn-sync-a1b2c3d4/git/blobs/large-blob-sha",
            github_request.call_args_list[2].args[1],
        )

    def test_reads_large_utf8_repository_file_from_git_blob_when_contents_omits_content(self) -> None:
        self._store_authorized_repository()
        expected = '{"name":"数据库快照"}'
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                self._repository_response(),
                {"sha": "manifest-blob-sha", "encoding": "none", "size": len(expected.encode("utf-8"))},
                {"sha": "manifest-blob-sha", "encoding": "base64", "content": base64.b64encode(expected.encode("utf-8")).decode("ascii")},
            ],
        ):
            repository_file = self.service.read_repository_file("versioning/database/c1/manifest.json")

        self.assertIsNotNone(repository_file)
        self.assertEqual(expected, repository_file.content)
        self.assertEqual("manifest-blob-sha", repository_file.sha)

    def test_missing_repository_file_is_a_first_sync(self) -> None:
        self._store_authorized_repository()
        missing = HTTPError("https://api.github.com/file", 404, "Not Found", hdrs=None, fp=io.BytesIO(b"{}"))
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service, "_github_request", side_effect=[self._repository_response(), missing]
        ):
            self.assertIsNone(self.service.read_repository_file("sync/config.json"))

    def test_lists_repository_commits_for_a_versioned_file(self) -> None:
        self._store_authorized_repository()
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[
                self._repository_response(),
                [
                    {
                        "sha": "version-commit",
                        "commit": {
                            "message": "DataDjinn: 创建结构快照",
                            "committer": {"date": "2026-08-15T00:00:00Z"},
                        },
                    }
                ],
            ],
        ) as github_request:
            commits = self.service.list_repository_commits("versioning/schema/connection/snapshot.json")

        self.assertEqual(["version-commit"], [commit.sha for commit in commits])
        self.assertEqual("DataDjinn: 创建结构快照", commits[0].message)
        self.assertEqual(
            "/repos/vhukze/datadjinn-sync-a1b2c3d4/commits?path=versioning/schema/connection/snapshot.json&per_page=30",
            github_request.call_args_list[1].args[1],
        )

    def test_writes_new_repository_file_without_sha(self) -> None:
        self._store_authorized_repository()
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[self._repository_response(), {"content": {"sha": "created-sha"}}],
        ) as github_request:
            result = self.service.write_repository_file("sync/config.json", "中文内容", "首次同步")

        self.assertEqual(result.sha, "created-sha")
        payload = github_request.call_args_list[1].args[3]
        self.assertNotIn("sha", payload)
        self.assertEqual(base64.b64decode(payload["content"]).decode("utf-8"), "中文内容")

    def test_updates_repository_file_with_remote_sha(self) -> None:
        self._store_authorized_repository()
        with patch.object(github_oauth_module, "_decrypt_password", return_value="token"), patch.object(
            self.service,
            "_github_request",
            side_effect=[self._repository_response(), {"content": {"sha": "updated-sha"}}],
        ) as github_request:
            result = self.service.write_repository_file(
                "sync/config.json", "new-content", "同步 DataDjinn 配置", sha="remote-sha"
            )

        self.assertEqual(result.sha, "updated-sha")
        self.assertEqual(github_request.call_args_list[1].args[3]["sha"], "remote-sha")

    def _store_authorized_repository(self) -> None:
        (self.data_dir / "github-sync.json").write_text(
            json.dumps(
                {
                    "encrypted_access_token": "encrypted:token",
                    "repository_full_name": "vhukze/datadjinn-sync-a1b2c3d4",
                    "repository_url": "https://github.com/vhukze/datadjinn-sync-a1b2c3d4",
                }
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _repository_response() -> dict[str, str]:
        return {
            "full_name": "vhukze/datadjinn-sync-a1b2c3d4",
            "html_url": "https://github.com/vhukze/datadjinn-sync-a1b2c3d4",
        }


class GitHubRepositoryWriteTests(unittest.TestCase):
    def test_batch_write_rebuilds_from_latest_head_after_non_fast_forward(self) -> None:
        service = GitHubOAuthService()
        conflict = HTTPError(
            "https://api.github.com/git/refs/heads/main",
            422,
            "Unprocessable Entity",
            hdrs=None,
            fp=io.BytesIO(json.dumps({"message": "Update is not a fast forward"}).encode()),
        )
        result = github_oauth_module.GitHubRepositoryBatchWriteResult(
            commit_sha="new-head", paths=["snapshot.json"]
        )
        with patch.object(service, "_write_repository_files_once", side_effect=[conflict, result]) as write_once, patch(
            "app.git_sync.github_oauth.time.sleep"
        ) as sleep:
            actual = service.write_repository_files({"snapshot.json": "{}"}, "快照")

        self.assertEqual(result, actual)
        self.assertEqual(2, write_once.call_count)
        sleep.assert_called_once()

    def test_batch_write_reports_readable_error_after_retry_exhaustion(self) -> None:
        service = GitHubOAuthService()
        conflict = HTTPError(
            "https://api.github.com/git/refs/heads/main", 422, "Unprocessable Entity", hdrs=None,
            fp=io.BytesIO(b'{"message":"Update is not a fast forward"}'),
        )
        with patch.object(service, "_write_repository_files_once", side_effect=[conflict, conflict, conflict]), patch(
            "app.git_sync.github_oauth.time.sleep"
        ), self.assertRaisesRegex(ValueError, "远端仓库刚刚发生了更新"):
            service.write_repository_files({"snapshot.json": "{}"}, "快照")
