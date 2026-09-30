from __future__ import annotations

import base64
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.git_versioning.local_history import LocalSnapshotHistory


class LocalSnapshotHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.history = LocalSnapshotHistory(Path(self.temp_dir.name) / "history.sqlite3")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_snapshot_payload_is_stored_without_encryption_and_can_be_loaded(self) -> None:
        snapshot_id = self.history.save_prepared("c1", "保存数据", b"snapshot-payload")
        self.assertEqual(b"snapshot-payload", self.history.get_payload(snapshot_id))

        with self.history._connect() as connection:
            payload, encrypted_payload = connection.execute(
                "SELECT snapshot_payload, encrypted_payload FROM snapshots WHERE id = ?", (snapshot_id,)
            ).fetchone()
        self.assertEqual(b"snapshot-payload", payload)
        self.assertIsNone(encrypted_payload)

    def test_legacy_encrypted_snapshot_payload_remains_readable(self) -> None:
        encoded_payload = base64.b64encode(b"legacy-snapshot").decode("ascii")
        encrypted_record = json.dumps(
            {"version": 1, "chunks": [f"enc:{encoded_payload}"]}, separators=(",", ":")
        ).encode("utf-8")
        snapshot_id = "legacy-snapshot-id"
        with self.history._connect() as connection:
            connection.execute(
                """
                INSERT INTO snapshots (
                    id, connection_id, captured_at, reason, status, encrypted_payload, snapshot_kind
                ) VALUES (?, ?, ?, ?, 'local_only', ?, 'checkpoint')
                """,
                (snapshot_id, "c1", datetime.now(timezone.utc).isoformat(), "旧格式快照", encrypted_record),
            )
        with patch(
            "app.git_versioning.local_history._decrypt_password",
            side_effect=lambda value: value.removeprefix("enc:"),
        ):
            self.assertEqual(b"legacy-snapshot", self.history.get_payload(snapshot_id))

    def test_history_tracks_pending_and_synced_remote_versions(self) -> None:
        snapshot_id = self.history.save_prepared("c1", "SQL 写入前", b"archive")

        self.history.update_status(snapshot_id, "pending")
        self.history.update_status(snapshot_id, "synced", remote_commit_id="commit-1", remove_payload=True)

        versions = self.history.list("c1")
        self.assertEqual("synced", versions[0]["status"])
        self.assertEqual("commit-1", versions[0]["remote_commit_id"])
        self.assertIsNone(self.history.get_payload(snapshot_id))

    def test_pending_connection_ids_include_versions_waiting_for_a_sync_attempt(self) -> None:
        first = self.history.save_prepared("c2", "前快照", b"one")
        second = self.history.save_prepared("c1", "前快照", b"two")
        self.history.update_status(first, "pending")
        self.history.update_status(second, "error", error="offline")

        self.assertEqual(["c1", "c2"], self.history.pending_connection_ids())

    def test_history_filters_full_database_checkpoints_from_table_changes(self) -> None:
        checkpoint = self.history.save_prepared("c1", "定时全库快照", b"full", "checkpoint")
        table_change = self.history.save_prepared("c1", "表写入前快照", b"table", "table_change")

        self.assertEqual([checkpoint], [item["id"] for item in self.history.list("c1", snapshot_kind="checkpoint")])
        self.assertEqual([table_change], [item["id"] for item in self.history.list("c1", snapshot_kind="table_change")])

    def test_newer_snapshots_are_detected_before_retrying_an_older_version(self) -> None:
        older = self.history.save_prepared("c1", "旧快照", b"older")
        newer = self.history.save_prepared("c1", "新快照", b"newer")
        records = self.history.list("c1")
        captured_at = {item["id"]: item["captured_at"] for item in records}

        self.assertTrue(self.history.has_newer_snapshot("c1", older, captured_at[older]))
        self.assertFalse(self.history.has_newer_snapshot("c1", newer, captured_at[newer]))

    def test_scheduled_snapshot_time_is_persisted(self) -> None:
        captured_at = "2026-09-25T12:00:00+00:00"

        self.history.set_last_scheduled_snapshot("c1", captured_at)

        self.assertEqual(captured_at, self.history.get_last_scheduled_snapshot("c1"))


if __name__ == "__main__":
    unittest.main()
