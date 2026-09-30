from __future__ import annotations

import base64
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from app.db.connection_manager import _decrypt_password, _encrypt_password


LOCAL_HISTORY_DB_NAME = "database-version-history.sqlite3"
LOCAL_SNAPSHOT_ENCRYPTION_CHUNK_BYTES = 256_000


def _database_path() -> Path:
    configured = os.environ.get("DATADJINN_DATA_DIR", "").strip()
    data_dir = Path(configured).expanduser() if configured else Path(__file__).resolve().parents[2] / "data"
    return data_dir / LOCAL_HISTORY_DB_NAME


class LocalSnapshotHistory:
    def __init__(self, database_path: Path | None = None) -> None:
        self.database_path = database_path

    def save_prepared(
        self,
        connection_id: str,
        reason: str,
        payload: bytes,
        snapshot_kind: str = "checkpoint",
    ) -> str:
        snapshot_id = uuid4().hex
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO snapshots (
                    id, connection_id, captured_at, reason, status, snapshot_payload, snapshot_kind
                ) VALUES (?, ?, ?, ?, 'prepared', ?, ?)
                """,
                (
                    snapshot_id,
                    connection_id,
                    datetime.now(timezone.utc).isoformat(),
                    reason,
                    payload,
                    snapshot_kind,
                ),
            )
        return snapshot_id

    def update_status(
        self,
        snapshot_id: str,
        status: str,
        remote_commit_id: str | None = None,
        error: str | None = None,
        remove_payload: bool = False,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE snapshots
                SET status = ?, remote_commit_id = COALESCE(?, remote_commit_id),
                    error = ?,
                    snapshot_payload = CASE WHEN ? THEN NULL ELSE snapshot_payload END,
                    encrypted_payload = CASE WHEN ? THEN NULL ELSE encrypted_payload END
                WHERE id = ?
                """,
                (status, remote_commit_id, error, int(remove_payload), int(remove_payload), snapshot_id),
            )

    def list(
        self,
        connection_id: str,
        limit: int = 100,
        snapshot_kind: str | None = None,
    ) -> list[dict[str, Any]]:
        kind_filter = " AND snapshot_kind = ?" if snapshot_kind else ""
        parameters: tuple[Any, ...] = (connection_id, max(1, min(limit, 500)))
        if snapshot_kind:
            parameters = (connection_id, snapshot_kind, max(1, min(limit, 500)))
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT id, captured_at, reason, status, remote_commit_id, error, snapshot_kind
                FROM snapshots
                WHERE connection_id = ? AND status != 'discarded'{kind_filter}
                ORDER BY captured_at DESC
                LIMIT ?
                """,
                parameters,
            ).fetchall()
        return [
            {
                "id": row[0],
                "captured_at": row[1],
                "message": row[2],
                "status": row[3],
                "remote_commit_id": row[4],
                "error": row[5],
                "snapshot_kind": row[6],
            }
            for row in rows
        ]

    def get_payload(self, snapshot_id: str) -> bytes | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT snapshot_payload, encrypted_payload FROM snapshots WHERE id = ?",
                (snapshot_id,),
            ).fetchone()
        if row is None:
            return None
        if row[0] is not None:
            return bytes(row[0])
        if row[1] is None:
            return None
        try:
            encrypted_record = json.loads(bytes(row[1]).decode("utf-8"))
            if encrypted_record.get("version") != 1 or not isinstance(encrypted_record.get("chunks"), list):
                raise ValueError("本机数据库快照版本无效")
            decrypted_chunks = [_decrypt_password(chunk) for chunk in encrypted_record["chunks"]]
            if any(chunk is None for chunk in decrypted_chunks):
                raise ValueError("本机数据库快照无法解密")
            return b"".join(
                base64.b64decode(chunk, validate=True)
                for chunk in decrypted_chunks
                if chunk is not None
            )
        except ValueError as exc:
            raise ValueError("本机数据库快照内容无效") from exc
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError, TypeError) as exc:
            raise ValueError("本机数据库快照内容无效") from exc

    def get_record(self, snapshot_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, connection_id, captured_at, reason, status, remote_commit_id, error, snapshot_kind
                FROM snapshots WHERE id = ?
                """,
                (snapshot_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "connection_id": row[1],
            "captured_at": row[2],
            "message": row[3],
            "status": row[4],
            "remote_commit_id": row[5],
            "error": row[6],
            "snapshot_kind": row[7],
        }

    def oldest_pending(self, connection_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, reason, status, encrypted_payload, snapshot_kind
                FROM snapshots
                WHERE connection_id = ? AND status IN ('prepared', 'pending', 'error')
                ORDER BY captured_at ASC
                LIMIT 1
                """,
                (connection_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "reason": row[1],
            "status": row[2],
            "payload": self.get_payload(row[0]),
            "snapshot_kind": row[4],
        }

    def retry_failed(self, snapshot_id: str) -> bool:
        with self._connect() as connection:
            result = connection.execute(
                "UPDATE snapshots SET status = 'pending', error = NULL "
                "WHERE id = ? AND status IN ('error', 'local_only') "
                "AND COALESCE(snapshot_payload, encrypted_payload) IS NOT NULL",
                (snapshot_id,),
            )
            return result.rowcount == 1

    def has_newer_snapshot(self, connection_id: str, snapshot_id: str, captured_at: str) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT 1 FROM snapshots
                WHERE connection_id = ? AND id != ? AND captured_at > ? AND status != 'discarded'
                LIMIT 1
                """,
                (connection_id, snapshot_id, captured_at),
            ).fetchone()
        return row is not None

    def pending_connection_ids(self) -> list[str]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT DISTINCT connection_id FROM snapshots "
                "WHERE status IN ('prepared', 'pending', 'error') ORDER BY connection_id"
            ).fetchall()
        return [row[0] for row in rows]

    def get_last_scheduled_snapshot(self, connection_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT captured_at FROM scheduled_snapshots WHERE connection_id = ?",
                (connection_id,),
            ).fetchone()
        return row[0] if row else None

    def set_last_scheduled_snapshot(self, connection_id: str, captured_at: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO scheduled_snapshots (connection_id, captured_at)
                VALUES (?, ?)
                ON CONFLICT(connection_id) DO UPDATE SET captured_at = excluded.captured_at
                """,
                (connection_id, captured_at),
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        path = self.database_path or _database_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=15)
        try:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS snapshots (
                    id TEXT PRIMARY KEY,
                    connection_id TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL,
                    remote_commit_id TEXT,
                    error TEXT,
                    encrypted_payload BLOB,
                    snapshot_payload BLOB,
                    snapshot_kind TEXT NOT NULL DEFAULT 'checkpoint'
                )
                """
            )
            snapshot_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(snapshots)").fetchall()
            }
            if "snapshot_kind" not in snapshot_columns:
                connection.execute(
                    "ALTER TABLE snapshots ADD COLUMN snapshot_kind TEXT NOT NULL DEFAULT 'checkpoint'"
                )
            if "snapshot_payload" not in snapshot_columns:
                connection.execute("ALTER TABLE snapshots ADD COLUMN snapshot_payload BLOB")
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_snapshots_connection_time "
                "ON snapshots(connection_id, captured_at DESC)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS scheduled_snapshots (
                    connection_id TEXT PRIMARY KEY,
                    captured_at TEXT NOT NULL
                )
                """
            )
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


local_snapshot_history = LocalSnapshotHistory()
