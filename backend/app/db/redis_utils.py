from __future__ import annotations

from itertools import islice
from typing import Any

try:
    from redis import Redis
    from redis.exceptions import ResponseError as RedisResponseError
except ImportError:  # pragma: no cover - optional dependency guard
    Redis = None  # type: ignore[assignment]

    class RedisResponseError(Exception):
        pass


DEFAULT_REDIS_DATABASE_COUNT = 16


def is_redis_client(client: Any) -> bool:
    return Redis is not None and isinstance(client, Redis)


def redis_text(value: Any) -> str:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()
    return str(value)


def redis_database_name(index: int) -> str:
    return f"db{index}"


def parse_redis_database_name(name: str | None, fallback: int = 0) -> int:
    if not name:
        return fallback

    normalized = name.strip().lower()
    if normalized.startswith("db"):
        normalized = normalized[2:]

    try:
        index = int(normalized)
    except ValueError as exc:
        raise ValueError("Redis 数据库名称应为 db0、db1 或数字序号") from exc

    if index < 0:
        raise ValueError("Redis 数据库序号不能小于 0")

    return index


def redis_current_database(client: Any) -> int:
    if not is_redis_client(client):
        return 0

    db = client.connection_pool.connection_kwargs.get("db", 0)
    try:
        return int(db or 0)
    except (TypeError, ValueError):
        return 0


def redis_database_count(client: Any, fallback: int = DEFAULT_REDIS_DATABASE_COUNT) -> int:
    try:
        config = client.config_get("databases")
    except RedisResponseError:
        return fallback

    value = config.get("databases") if isinstance(config, dict) else None
    if value is None and isinstance(config, dict):
        value = config.get(b"databases")

    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return fallback


def redis_client_for_database(client: Any, database_name: str | None = None) -> Any:
    if not is_redis_client(client):
        return client

    target_db = parse_redis_database_name(database_name, redis_current_database(client))
    if target_db == redis_current_database(client):
        return client

    kwargs = dict(client.connection_pool.connection_kwargs)
    kwargs["db"] = target_db
    return Redis(**kwargs)


def serialize_redis_value(value: Any) -> Any:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()

    if isinstance(value, list):
        return [serialize_redis_value(item) for item in value]

    if isinstance(value, tuple):
        return [serialize_redis_value(item) for item in value]

    if isinstance(value, set):
        return [serialize_redis_value(item) for item in value]

    if isinstance(value, dict):
        return {redis_text(key): serialize_redis_value(item) for key, item in value.items()}

    return value


def redis_key_type(client: Any, key: str) -> str:
    return redis_text(client.type(key))


def redis_key_length(client: Any, key: str, key_type: str | None = None) -> int | None:
    current_type = key_type or redis_key_type(client, key)

    if current_type == "string":
        return client.strlen(key)
    if current_type == "hash":
        return client.hlen(key)
    if current_type == "list":
        return client.llen(key)
    if current_type == "set":
        return client.scard(key)
    if current_type == "zset":
        return client.zcard(key)

    return None


def redis_memory_usage(client: Any, key: str) -> int | None:
    try:
        value = client.memory_usage(key)
    except Exception:
        return None

    return int(value) if value is not None else None


def redis_scan_keys(client: Any, limit: int = 1000) -> list[str]:
    return [redis_text(key) for key in islice(client.scan_iter(count=500), limit)]
