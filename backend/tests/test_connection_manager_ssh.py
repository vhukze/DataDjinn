import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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

        create_connection.assert_called_once_with(("jump.internal", 2222), timeout=5)
        probe_socket.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
