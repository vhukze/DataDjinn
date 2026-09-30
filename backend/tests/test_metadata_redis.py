from __future__ import annotations

import unittest
from unittest.mock import MagicMock, Mock, patch

from redis import Redis
from redis.exceptions import ConnectionError, ResponseError

from app.db.metadata import _apply_redis_key_update, apply_redis_data_changes, list_databases
from app.schemas.metadata import RedisDataChangeRequest, RedisKeyUpdate


class ConfigDisabledRedis(Redis):
    def __init__(self) -> None:
        super().__init__(host="localhost", port=6379, db=20)

    def info(self, section: str | None = None) -> dict[str, object]:
        assert section == "keyspace"
        return {
            "db0": {"keys": 2},
            "db5": {"keys": 4}
        }

    def config_get(self, pattern: str = "*") -> dict[str, str]:
        assert pattern == "databases"
        raise ResponseError("unknown command 'CONFIG', with args beginning with: 'GET', 'databases'")


class DisconnectedRedis(ConfigDisabledRedis):
    def config_get(self, pattern: str = "*") -> dict[str, str]:
        raise ConnectionError("connection closed")


class ConfigEnabledRedis(Redis):
    def __init__(self) -> None:
        super().__init__(host="localhost", port=6379, db=0)

    def info(self, section: str | None = None) -> dict[str, object]:
        return {}

    def config_get(self, pattern: str = "*") -> dict[bytes, bytes]:
        return {b"databases": b"4"}


class RedisMetadataTests(unittest.TestCase):
    def test_list_databases_reads_binary_config_response(self) -> None:
        databases = list_databases(ConfigEnabledRedis())

        self.assertEqual([database.name for database in databases], ["db0", "db1", "db2", "db3"])

    def test_list_databases_falls_back_when_config_is_disabled(self) -> None:
        databases = list_databases(ConfigDisabledRedis())

        names = [database.name for database in databases]
        self.assertEqual(names[:16], [f"db{index}" for index in range(16)])
        self.assertEqual(names[-1], "db20")
        self.assertEqual(
            next(database for database in databases if database.name == "db5").size_bytes,
            4,
        )

    def test_list_databases_does_not_hide_connection_errors(self) -> None:
        with self.assertRaisesRegex(ConnectionError, "connection closed"):
            list_databases(DisconnectedRedis())

    def test_invalid_replacement_does_not_delete_the_original_key(self) -> None:
        target = Mock()

        with self.assertRaisesRegex(ValueError, "至少需要一个 field"):
            _apply_redis_key_update(
                target,
                RedisKeyUpdate(
                    key="renamed",
                    original_key="existing",
                    type="hash",
                    value={},
                ),
                True,
            )

        target.delete.assert_called_once()
        self.assertNotEqual(target.delete.call_args.args[0], "existing")
        target.hset.assert_not_called()
        target.pipeline.assert_not_called()

    def test_valid_replacement_stages_then_atomically_renames_and_deletes_old_key(self) -> None:
        target = Mock()
        pipeline = Mock()
        target.pipeline.return_value = MagicMock()
        target.pipeline.return_value.__enter__.return_value = pipeline
        update = RedisKeyUpdate(
            key="renamed",
            original_key="existing",
            type="string",
            value="new value",
            ttl=60,
        )

        _apply_redis_key_update(target, update, True)

        temporary_key = target.set.call_args.args[0]
        target.set.assert_called_once_with(temporary_key, "new value")
        target.expire.assert_called_once_with(temporary_key, 60)
        target.pipeline.assert_called_once_with(transaction=True)
        pipeline.rename.assert_called_once_with(temporary_key, "renamed")
        pipeline.delete.assert_called_once_with("existing")
        pipeline.execute.assert_called_once_with()

    def test_invalid_batch_does_not_apply_earlier_deletions(self) -> None:
        engine = object()
        target = Mock()
        changes = RedisDataChangeRequest(
            deleted=["keep-until-batch-valid"],
            updated=[RedisKeyUpdate(key="renamed", original_key="existing", type="hash", value={})],
        )

        with (
            patch("app.db.metadata.is_redis_client", return_value=True),
            patch("app.db.metadata.redis_client_for_database", return_value=target),
            self.assertRaisesRegex(ValueError, "至少需要一个 field"),
        ):
            apply_redis_data_changes(engine, changes)

        self.assertFalse(
            any("keep-until-batch-valid" in call.args for call in target.delete.call_args_list)
        )
        target.pipeline.assert_not_called()

    def test_rename_chain_is_rejected_before_staging(self) -> None:
        engine = object()
        target = Mock()
        changes = RedisDataChangeRequest(
            updated=[
                RedisKeyUpdate(key="second", original_key="first", type="string", value="2"),
                RedisKeyUpdate(key="third", original_key="second", type="string", value="3"),
            ]
        )

        with (
            patch("app.db.metadata.is_redis_client", return_value=True),
            patch("app.db.metadata.redis_client_for_database", return_value=target),
            self.assertRaisesRegex(ValueError, "不能同时重命名相互关联的 Key"),
        ):
            apply_redis_data_changes(engine, changes)

        target.set.assert_not_called()
        target.pipeline.assert_not_called()
