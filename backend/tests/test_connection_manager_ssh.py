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

    def build_sqlite_request(self, name: str) -> ConnectionRequest:
        return ConnectionRequest(
            name=name,
            database_type="sqlite",
            sqlite_path=str(Path(self.temp_dir.name) / "reload.db"),
        )

    def test_manager_reloads_connections_created_or_changed_by_another_process(self) -> None:
        mcp_manager = connection_manager_module.ConnectionManager()
        self.assertEqual([], mcp_manager.list_connections())

        created = self.manager.create_connection(self.build_sqlite_request("Created from desktop"))
        self.assertEqual([created.connection_id], [item.connection_id for item in mcp_manager.list_connections()])

        self.manager.update_connection(created.connection_id, self.build_sqlite_request("Renamed from desktop"))
        refreshed = mcp_manager.list_connections()
        self.assertEqual("Renamed from desktop", refreshed[0].name)

        self.assertTrue(self.manager.delete_connection(created.connection_id))
        self.assertEqual([], mcp_manager.list_connections())

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

    def test_create_and_restore_connection_preserves_git_versioning_preference(self) -> None:
        created = self.manager.create_connection(
            ConnectionRequest(
                name="Versioned SQLite",
                database_type="sqlite",
                sqlite_path=str(Path(self.temp_dir.name) / "versioned.db"),
                git_versioning_enabled=True,
                git_versioning_scopes=["main"],
                git_versioning_snapshot_interval_hours=12,
            )
        )

        self.assertTrue(created.git_versioning_enabled)
        self.assertTrue(self.manager.get_connection_request(created.connection_id).git_versioning_enabled)
        self.assertEqual(self.manager.get_connection_request(created.connection_id).git_versioning_scopes, ["main"])
        self.assertEqual(
            12,
            self.manager.get_connection_request(created.connection_id).git_versioning_snapshot_interval_hours,
        )
        self.manager.update_git_versioning_scopes(created.connection_id, ["main"], 6)

        restored_manager = connection_manager_module.ConnectionManager()
        restored = restored_manager.list_connections()
        self.assertEqual(len(restored), 1)
        self.assertTrue(restored[0].git_versioning_enabled)
        self.assertEqual(restored_manager.get_connection_request(restored[0].connection_id).git_versioning_scopes, ["main"])
        self.assertEqual(
            6,
            restored_manager.get_connection_request(restored[0].connection_id).git_versioning_snapshot_interval_hours,
        )

    def test_sync_snapshot_contains_secrets_but_excludes_device_specific_paths(self) -> None:
        request = self.build_ssh_request().model_copy(
            update={
                "driver_id": "local-driver",
                "driver_path": "C:/local/dmjdbc.jar",
                "ssh_auth_type": "private_key",
                "ssh_private_key_path": "C:/Users/test/.ssh/id_ed25519",
                "ssh_passphrase": "private-key-secret",
                "git_versioning_enabled": True,
                "git_versioning_scopes": ["SALES"],
            }
        )
        created = self.manager.create_connection(request)

        snapshot = self.manager.export_sync_connections()[created.connection_id]

        self.assertEqual(snapshot["password"], "db-secret")
        self.assertEqual(snapshot["ssh_passphrase"], "private-key-secret")
        self.assertEqual(snapshot["git_versioning_scopes"], ["SALES"])
        self.assertEqual(snapshot["git_versioning_snapshot_interval_hours"], 24)
        self.assertNotIn("driver_id", snapshot)
        self.assertNotIn("driver_path", snapshot)
        self.assertNotIn("ssh_private_key_path", snapshot)

    def test_replace_sync_connections_preserves_local_paths_and_remote_ids(self) -> None:
        existing = self.manager.create_connection(
            self.build_ssh_request().model_copy(
                update={
                    "driver_id": "local-driver",
                    "driver_path": "C:/local/driver.jar",
                    "ssh_auth_type": "private_key",
                    "ssh_private_key_path": "C:/local/id_ed25519",
                }
            )
        )
        incoming = self.manager.export_sync_connections()
        incoming[existing.connection_id]["name"] = "远程修改名称"
        incoming["remote-connection-id"] = ConnectionRequest(
            name="远程 SQLite",
            database_type="sqlite",
            sqlite_path="D:/shared/demo.db",
        ).model_dump()

        result = self.manager.replace_sync_connections(incoming)

        self.assertEqual({item.connection_id for item in result}, {existing.connection_id, "remote-connection-id"})
        restored = self.manager.get_connection_request(existing.connection_id)
        self.assertEqual(restored.name, "远程修改名称")
        self.assertEqual(restored.driver_id, "local-driver")
        self.assertEqual(restored.driver_path, "C:/local/driver.jar")
        self.assertEqual(restored.ssh_private_key_path, str(Path("C:/local/id_ed25519").resolve()))

    def test_replace_sync_connections_removes_connections_deleted_by_merged_snapshot(self) -> None:
        removed = self.manager.create_connection(self.build_ssh_request())
        retained = self.manager.create_connection(
            ConnectionRequest(name="保留", database_type="sqlite", sqlite_path="D:/keep.db")
        )
        snapshot = self.manager.export_sync_connections()
        snapshot.pop(removed.connection_id)

        self.manager.replace_sync_connections(snapshot)

        self.assertEqual([item.connection_id for item in self.manager.list_connections()], [retained.connection_id])
        persisted = json.loads(self.connection_store_path.read_text(encoding="utf-8"))
        self.assertEqual([item["connection_id"] for item in persisted["connections"]], [retained.connection_id])

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

    def test_mysql_and_postgresql_use_separate_connect_and_protocol_timeouts(self) -> None:
        mysql_request = ConnectionRequest(
            name="MySQL timeout", database_type="mysql", host="db.internal", port=3306, username="root"
        )
        postgresql_request = ConnectionRequest(
            name="PostgreSQL timeout",
            database_type="postgresql",
            host="db.internal",
            port=5432,
            username="postgres",
            database="postgres",
        )

        with patch.object(connection_manager_module, "create_engine", return_value=Mock()) as create_engine:
            self.manager._create_mysql_engine(mysql_request)
            mysql_kwargs = create_engine.call_args.kwargs
            self.manager._create_postgresql_engine(postgresql_request)
            postgresql_kwargs = create_engine.call_args.kwargs

        timeout = connection_manager_module.DATABASE_CONNECT_TIMEOUT_SECONDS
        self.assertEqual(mysql_kwargs["connect_args"], {
            "connect_timeout": timeout,
            "read_timeout": connection_manager_module.DATABASE_SOCKET_TIMEOUT_SECONDS,
            "write_timeout": connection_manager_module.DATABASE_SOCKET_TIMEOUT_SECONDS,
        })
        self.assertEqual(postgresql_kwargs["connect_args"], {"connect_timeout": timeout})

    def test_clickhouse_engine_uses_short_connect_timeouts(self) -> None:
        request = ConnectionRequest(
            name="ClickHouse timeout",
            database_type="clickhouse",
            host="db.internal",
            port=8123,
            database="default",
        )
        engine = Mock()
        with (
            patch.object(connection_manager_module, "_ensure_clickhouse_dialect_registered"),
            patch.object(connection_manager_module, "create_engine", return_value=engine) as create_engine,
        ):
            self.manager._create_clickhouse_engine(request)

        timeout = connection_manager_module.DATABASE_CONNECT_TIMEOUT_SECONDS
        self.assertEqual(create_engine.call_args.kwargs["connect_args"], {
            "connect_timeout": timeout,
            "send_receive_timeout": connection_manager_module.DATABASE_SOCKET_TIMEOUT_SECONDS,
            "query_retries": 0,
        })

    def test_database_endpoint_probe_closes_socket_after_success(self) -> None:
        request = ConnectionRequest(
            name="MySQL endpoint", database_type="mysql", host="db.internal", port=3306, username="root"
        )
        probe_socket = Mock()

        with patch.object(connection_manager_module.socket, "create_connection", return_value=probe_socket) as probe:
            self.manager._ensure_database_endpoint_reachable(request)

        probe.assert_called_once_with(
            ("db.internal", 3306),
            timeout=connection_manager_module.DATABASE_ENDPOINT_PROBE_TIMEOUT_SECONDS,
        )
        probe_socket.close.assert_called_once_with()

    def test_open_connection_does_not_wait_for_server_version_probe(self) -> None:
        created = self.manager.create_connection(self.build_sqlite_request("Fast open"))
        fake_engine = object()

        with (
            patch.object(self.manager, "_open_runtime_engine", return_value=(fake_engine, None)),
            patch.object(self.manager, "_ping_engine"),
            patch.object(self.manager, "_detect_server_version") as detect_version,
        ):
            opened = self.manager.open_connection(created.connection_id)

        self.assertTrue(opened.is_open)
        self.assertIsNone(opened.server_version)
        detect_version.assert_not_called()

    def test_jdbc_connection_login_is_bounded_and_timeout_setting_is_restored(self) -> None:
        driver_manager = Mock()
        driver_manager.getLoginTimeout.return_value = 0
        jpype = Mock()
        jpype.JClass.return_value = driver_manager
        connect = Mock(return_value="connected")

        result = connection_manager_module._connect_jdbc_with_timeout(jpype, connect)

        self.assertEqual(result, "connected")
        self.assertEqual(
            [item.args[0] for item in driver_manager.setLoginTimeout.call_args_list],
            [connection_manager_module.JDBC_LOGIN_TIMEOUT_SECONDS, 0],
        )
        connect.assert_called_once_with()

    def test_jdbc_connect_timeout_url_preserves_existing_parameters(self) -> None:
        self.assertEqual(
            connection_manager_module._jdbc_url_with_connect_timeout("jdbc:dm://db:5236", 10_000),
            "jdbc:dm://db:5236?connectTimeout=10000",
        )
        self.assertEqual(
            connection_manager_module._jdbc_url_with_connect_timeout("jdbc:gauss://db:8000/main?ssl=true", 10),
            "jdbc:gauss://db:8000/main?ssl=true&connectTimeout=10",
        )

    def test_mongodb_uses_distinct_connect_and_server_selection_timeouts(self) -> None:
        request = ConnectionRequest(
            name="Mongo timeout", database_type="mongodb", host="db.internal", port=27017
        )

        with patch.object(connection_manager_module, "MongoClient") as mongo_client:
            self.manager._create_mongodb_client(request)

        self.assertEqual(
            mongo_client.call_args.kwargs["connectTimeoutMS"],
            connection_manager_module.DATABASE_CONNECT_TIMEOUT_SECONDS * 1000,
        )
        self.assertEqual(
            mongo_client.call_args.kwargs["serverSelectionTimeoutMS"],
            connection_manager_module.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        )

    def test_redis_connect_and_command_timeouts_are_separate(self) -> None:
        request = ConnectionRequest(
            name="Redis timeout", database_type="redis", host="db.internal", port=6379
        )

        with patch.object(connection_manager_module, "Redis") as redis_client:
            self.manager._create_redis_client(request)

        self.assertEqual(
            redis_client.call_args.kwargs["socket_connect_timeout"],
            connection_manager_module.DATABASE_CONNECT_TIMEOUT_SECONDS,
        )
        self.assertEqual(
            redis_client.call_args.kwargs["socket_timeout"],
            connection_manager_module.DATABASE_SOCKET_TIMEOUT_SECONDS,
        )

    def test_elasticsearch_does_not_retry_a_slow_connection(self) -> None:
        request = ConnectionRequest(
            name="Elasticsearch timeout",
            database_type="elasticsearch",
            host="db.internal",
            port=9200,
            es_auth_type="none",
        )

        with (
            patch("elasticsearch.Elasticsearch") as elasticsearch,
            patch.object(connection_manager_module, "ElasticsearchClient"),
        ):
            self.manager._create_elasticsearch_client(request)

        self.assertEqual(
            elasticsearch.call_args.kwargs["request_timeout"],
            connection_manager_module.DATABASE_REQUEST_TIMEOUT_SECONDS,
        )
        self.assertEqual(elasticsearch.call_args.kwargs["max_retries"], 0)

    def test_dm_python_login_timeout_is_longer_than_previous_five_second_limit(self) -> None:
        request = ConnectionRequest(
            name="DM timeout",
            database_type="dm",
            host="db.internal",
            port=5236,
            username="SYSDBA",
            dm_driver_id="dm-python",
        )
        driver = type("Driver", (), {
            "database_type": "dm",
            "enabled": True,
            "driver_type": "python",
            "path": "dmPython.pyd",
        })()
        dm_python = Mock()

        with (
            patch.object(connection_manager_module.driver_manager, "get_driver", return_value=driver),
            patch.object(connection_manager_module, "_load_dm_python", return_value=dm_python),
            patch.object(connection_manager_module, "create_engine", return_value=Mock()) as create_engine,
        ):
            self.manager._create_dm_engine(request)
            create_engine.call_args.kwargs["creator"]()

        self.assertEqual(
            dm_python.connect.call_args.kwargs["login_timeout"],
            connection_manager_module.DATABASE_CONNECT_TIMEOUT_SECONDS * 1000,
        )

    def test_cancelling_a_timed_out_attempt_does_not_cancel_a_newer_open_attempt(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        self.manager._opening_connection_attempts[created.connection_id] = "new-attempt"

        self.manager.close_connection(created.connection_id, "timed-out-attempt")

        self.assertIn((created.connection_id, "timed-out-attempt"), self.manager._cancelled_open_attempts)
        self.assertNotIn((created.connection_id, "new-attempt"), self.manager._cancelled_open_attempts)

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

        def reopen(connection_id: str) -> None:
            self.manager._engines[connection_id] = object()

        with patch.object(self.manager, "open_connection", side_effect=reopen) as open_connection:
            self.assertTrue(self.manager.ensure_connection_available(created.connection_id))
        open_connection.assert_called_once_with(created.connection_id)

    def test_ensure_connection_available_reopens_a_connection_still_marked_open(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        self.manager._connections[created.connection_id] = created.model_copy(update={"is_open": True})

        def reopen(connection_id: str) -> None:
            self.manager._engines[connection_id] = object()

        with patch.object(self.manager, "open_connection", side_effect=reopen) as open_connection:
            self.assertTrue(self.manager.ensure_connection_available(created.connection_id))

        open_connection.assert_called_once_with(created.connection_id)
        self.assertIsNotNone(self.manager.get_engine(created.connection_id))

    def test_ensure_connection_available_does_not_reopen_a_deliberately_closed_connection(self) -> None:
        created = self.manager.create_connection(self.build_ssh_request())
        self.manager._connections[created.connection_id] = created.model_copy(update={"is_open": False})

        with patch.object(self.manager, "open_connection") as open_connection:
            self.assertFalse(self.manager.ensure_connection_available(created.connection_id))

        open_connection.assert_not_called()

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
