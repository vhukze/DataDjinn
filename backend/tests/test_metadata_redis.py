from __future__ import annotations

import unittest

from redis import Redis
from redis.exceptions import ConnectionError, ResponseError

from app.db.metadata import list_databases


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
