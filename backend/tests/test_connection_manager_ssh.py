import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from sqlalchemy.pool import QueuePool

from app.db import connection_manager as connection_manager_module
from app.schemas.connection import ConnectionRequest


class FakeTunnel:
    def __init__(self, local_host: str = "127.0.0.1", local_port: int = 43061) -> None:
        self.local_host = local_host
        self.local_port = local_port
        self.closed = False

    def close(self) -> None:
        self.closed = True


class ConnectionManagerSshTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.connection_store_path = Path(self.temp_dir.name) / "connections.json"
        self.connection_store_patch = patch.object(connection_manager_module, "CONNECTION_STORE_PATH", self.connection_store_path)
        self.connection_store_patch.start()
        self.manager = connection_manager_module.ConnectionManager()

    def tearDown(self) -> None:
        self.connection_store_patch.stop()
        self.temp_dir.cleanup()

    def build_ssh_request(self) -> ConnectionRequest:
        return ConnectionRequest(
            name="SSH MySQL",
            database_type="mysql",
            host="db.internal",
            port=3306,
            username="root",
            password="db-secret",
            ssh_enabled=True,
            ssh_host="jump.internal",
            ssh_port=2222,
            ssh_username="ubuntu",
            ssh_auth_type="password",
            ssh_password="ssh-secret",
        )

    def test_create_and_restore_connection_preserves_ssh_credentials(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())

        stored = self.manager._stored_connections[created.connection_id]
        self.assertTrue(stored.ssh_enabled)
        self.assertEqual(stored.ssh_host, "jump.internal")
        self.assertEqual(stored.ssh_port, 2222)
        self.assertEqual(stored.ssh_username, "ubuntu")
        self.assertEqual(stored.ssh_auth_type, "password")
        self.assertIsNotNone(stored.encrypted_ssh_password)
        self.assertNotEqual(stored.encrypted_ssh_password, "ssh-secret")

        restored = self.manager.get_connection_request(created.connection_id)
        self.assertTrue(restored.ssh_enabled)
        self.assertEqual(restored.ssh_host, "jump.internal")
        self.assertEqual(restored.ssh_port, 2222)
        self.assertEqual(restored.ssh_username, "ubuntu")
        self.assertEqual(restored.ssh_auth_type, "password")
        self.assertEqual(restored.ssh_password, "ssh-secret")

    def test_restore_connection_with_unavailable_dpapi_password_keeps_connection_editable(self) -> None:
        connection_id = "legacy-connection"
        legacy_store = {
            "connections": [
                {
                    "connection_id": connection_id,
                    "name": "Legacy MySQL",
                    "database_type": "mysql",
                    "host": "db.internal",
                    "port": 3306,
                    "username": "root",
                    "encrypted_password": "aW52YWxpZA==",
                    "database": "inventory",
                }
            ]
        }
        self.connection_store_path.write_text(
            json.dumps(legacy_store, ensure_ascii=False), encoding="utf-8"
        )

        restored_manager = connection_manager_module.ConnectionManager()

        restored_info = restored_manager.list_connections()[0]
        restored_request = restored_manager.get_connection_request(connection_id)
        self.assertEqual(restored_info.name, "Legacy MySQL")
        self.assertEqual(restored_request.host, "db.internal")
        self.assertEqual(restored_request.database, "inventory")
        self.assertFalse(restored_info.has_password)
        self.assertIsNone(restored_request.password)
        self.assertEqual(
            json.loads(self.connection_store_path.read_text(encoding="utf-8")), legacy_store
        )

        updated = restored_manager.update_connection(
            connection_id, restored_request.model_copy(update={"password": "new-secret"})
        )

        self.assertTrue(updated.has_password)
        self.assertEqual(restored_manager.get_password(connection_id), "new-secret")

    def test_test_connection_uses_forwarded_endpoint_and_releases_tunnel(self) -> None:
        fake_tunnel = FakeTunnel(local_port=43107)
        fake_engine = object()
        captured_runtime_request: list[ConnectionRequest] = []

        def fake_create_engine(request: ConnectionRequest) -> object:
            captured_runtime_request.append(request)
            return fake_engine

        with (
            patch.object(self.manager, "_open_ssh_tunnel", return_value=fake_tunnel),
            patch.object(self.manager, "_create_engine", side_effect=fake_create_engine),
            patch.object(self.manager, "_ping_engine"),
            patch.object(self.manager, "_dispose_engine") as dispose_engine,
        ):
            self.manager.test_connection(self.build_ssh_request())

        self.assertEqual(len(captured_runtime_request), 1)
        runtime_request = captured_runtime_request[0]
        self.assertEqual(runtime_request.host, "127.0.0.1")
        self.assertEqual(runtime_request.port, 43107)
        self.assertFalse(runtime_request.ssh_enabled)
        dispose_engine.assert_called_once_with(fake_engine)
        self.assertTrue(fake_tunnel.closed)

    def test_test_ssh_tunnel_opens_and_releases_tunnel_only(self) -> None:
        fake_tunnel = FakeTunnel(local_port=43141)

        with patch.object(self.manager, "_open_ssh_tunnel", return_value=fake_tunnel) as open_ssh_tunnel:
            self.manager.test_ssh_tunnel(self.build_ssh_request())

        open_ssh_tunnel.assert_called_once()
        self.assertTrue(fake_tunnel.closed)

    def test_open_and_close_connection_manage_tunnel_lifecycle(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        fake_tunnel = FakeTunnel(local_port=43123)
        fake_engine = object()

        with (
            patch.object(self.manager, "_open_ssh_tunnel", return_value=fake_tunnel),
            patch.object(self.manager, "_create_engine", return_value=fake_engine),
            patch.object(self.manager, "_ping_engine"),
            patch.object(self.manager, "_detect_server_version", return_value="8.0.36"),
        ):
            opened = self.manager.open_connection(created.connection_id)

        self.assertTrue(opened.is_open)
        self.assertIs(self.manager.get_engine(created.connection_id), fake_engine)
        self.assertIs(self.manager._ssh_tunnels[created.connection_id], fake_tunnel)

        with patch.object(self.manager, "_dispose_engine") as dispose_engine:
            closed = self.manager.close_connection(created.connection_id)

        self.assertFalse(closed.is_open)
        dispose_engine.assert_called_once_with(fake_engine)
        self.assertTrue(fake_tunnel.closed)
        self.assertNotIn(created.connection_id, self.manager._ssh_tunnels)

    def test_health_check_failure_releases_the_stale_connection_without_using_error_text(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        stale_engine = object()
        self.manager._engines[created.connection_id] = stale_engine
        self.manager._connections[created.connection_id] = created.model_copy(update={"is_open": True})

        with (
            patch.object(self.manager, "_ping_engine", side_effect=RuntimeError("driver failure")),
            patch.object(self.manager, "_dispose_connection_resources") as dispose_resources,
        ):
            self.assertFalse(self.manager.ensure_connection_healthy(created.connection_id, force=True))

        self.assertIsNone(self.manager.get_engine(created.connection_id))
        self.assertFalse(self.manager.list_connections()[0].is_open)
        dispose_resources.assert_called_once_with(stale_engine, None)

    def test_jdbc_pool_pre_ping_uses_the_jdbc_dialect_after_reusing_a_connection(self) -> None:
        class RecordingCursor:
            def __init__(self, statements: list[str]) -> None:
                self.statements = statements

            def execute(self, _statement: str) -> None:
                self.statements.append(_statement)

            def close(self) -> None:
                pass

        class ReusableConnection:
            def __init__(self) -> None:
                self.statements: list[str] = []

            def cursor(self) -> RecordingCursor:
                return RecordingCursor(self.statements)

            def rollback(self) -> None:
                pass

            def close(self) -> None:
                pass

        dialect = connection_manager_module.JdbcReconnectDialect("dm", "SELECT 1 FROM DUAL")
        raw_connection = ReusableConnection()
        pool = QueuePool(
            lambda: connection_manager_module.DmJdbcConnectionAdapter(raw_connection),
            pre_ping=True,
            dialect=dialect,
        )

        first_checkout = pool.connect()
        first_checkout.close()
        second_checkout = pool.connect()
        second_checkout.close()
        pool.dispose()

        self.assertIs(pool._dialect, dialect)  # type: ignore[attr-defined]
        self.assertEqual(raw_connection.statements, ["SELECT 1 FROM DUAL"])

    def test_close_cancels_an_open_attempt_that_is_still_connecting(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        fake_engine = object()
        ping_started = threading.Event()
        allow_ping_to_finish = threading.Event()
        open_errors: list[Exception] = []

        def slow_ping(_engine: object) -> None:
            ping_started.set()
            allow_ping_to_finish.wait(timeout=2)

        with (
            patch.object(self.manager, "_open_runtime_engine", return_value=(fake_engine, None)),
            patch.object(self.manager, "_ping_engine", side_effect=slow_ping),
            patch.object(self.manager, "_detect_server_version", return_value="8.0.36"),
            patch.object(self.manager, "_dispose_engine") as dispose_engine,
        ):
            opening_thread = threading.Thread(
                target=lambda: self._capture_open_error(
                    created.connection_id, "open-attempt", open_errors
                )
            )
            opening_thread.start()
            self.assertTrue(ping_started.wait(timeout=2))

            closed = self.manager.close_connection(created.connection_id, "open-attempt")
            allow_ping_to_finish.set()
            opening_thread.join(timeout=2)

        self.assertFalse(opening_thread.is_alive())
        self.assertFalse(closed.is_open)
        self.assertEqual(len(open_errors), 1)
        self.assertEqual(str(open_errors[0]), "连接已取消")
        self.assertIsNone(self.manager.get_engine(created.connection_id))
        dispose_engine.assert_called_once_with(fake_engine)

    def _capture_open_error(
        self, connection_id: str, open_attempt_id: str, errors: list[Exception]
    ) -> None:
        try:
            self.manager.open_connection(connection_id, open_attempt_id)
        except Exception as exc:
            errors.append(exc)

    def test_ensure_ssh_gateway_reachable_reports_connection_refused(self) -> None:
        socket_error = OSError("actively refused")
        socket_error.winerror = 10061

        with patch.object(connection_manager_module.socket, "create_connection", side_effect=socket_error):
            with self.assertRaisesRegex(RuntimeError, "无法连接到 SSH 网关（jump.internal:2222）") as context:
                self.manager._ensure_ssh_gateway_reachable("jump.internal", 2222)

        self.assertIn("目标主机拒绝连接", str(context.exception))

    def test_ensure_ssh_gateway_reachable_closes_probe_socket_after_success(self) -> None:
        probe_socket = Mock()

        with patch.object(connection_manager_module.socket, "create_connection", return_value=probe_socket) as create_connection:
            self.manager._ensure_ssh_gateway_reachable("jump.internal", 2222)

        create_connection.assert_called_once_with(
            ("jump.internal", 2222),
            timeout=connection_manager_module.SSH_GATEWAY_CONNECT_TIMEOUT_SECONDS,
        )
        probe_socket.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
