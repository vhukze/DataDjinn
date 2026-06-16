import json
import re

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Engine, inspect, text

from app.db.mongo_utils import is_mongo_client, mongo_default_database, mongo_value_type
from app.db.redis_utils import is_redis_client, parse_redis_database_name, redis_client_for_database, redis_current_database, redis_database_name, redis_key_length, redis_key_type, redis_memory_usage, redis_scan_keys, redis_text, serialize_redis_value
from app.schemas.metadata import ColumnInfo, DatabaseInfo, DbObjectInfo, RedisDataChangeRequest, RedisKeyUpdate, TableDataChangeRequest, TableInfo, TableUpdateColumn

COLUMN_TYPE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_ (),]*$")
NUMERIC_LITERAL_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")

PG_SYSTEM_SCHEMAS = {"pg_catalog", "information_schema"}
DM_SYSTEM_SCHEMAS = {"SYS", "SYSDBA", "SYSAUDITOR", "SYSSSO", "CTISYS"}
ORACLE_SYSTEM_SCHEMAS = {
    "ANONYMOUS", "APPQOSSYS", "AUDSYS", "CTXSYS", "DBSNMP", "DIP", "DVF", "DVSYS", "GGSYS", "GSMADMIN_INTERNAL",
    "LBACSYS", "MDSYS", "OJVMSYS", "OLAPSYS", "ORACLE_OCM", "OUTLN", "REMOTE_SCHEDULER_AGENT", "SYS", "SYSTEM",
    "SYSBACKUP", "SYSDG", "SYSKM", "SYSRAC", "WMSYS", "XDB", "XS$NULL",
}
DEFAULT_VALUE_ACTION = "default"


def _is_clickhouse_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"clickhouse", "clickhousedb"}


def _is_oracle_engine(engine: Engine) -> bool:
    return engine.dialect.name == "oracle"


def _is_schema_scoped_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"postgresql", "gaussdb"}


def _is_default_value_marker(value: Any) -> bool:
    return isinstance(value, dict) and value.get("__datadjinn_action__") == DEFAULT_VALUE_ACTION


def _dm_current_user(connection: Any) -> str:
    row = connection.execute(text("SELECT USER FROM DUAL")).fetchone()
    return str(row[0]).upper() if row and row[0] is not None else "SYSDBA"


def _dm_owner_segment_sizes(connection: Any, current_user: str) -> dict[str, int]:
    for sql, params in [
        ("SELECT OWNER, COALESCE(SUM(BYTES), 0) FROM ALL_SEGMENTS GROUP BY OWNER", {}),
        ("SELECT OWNER, COALESCE(SUM(BYTES), 0) FROM DBA_SEGMENTS GROUP BY OWNER", {}),
        ("SELECT :owner, COALESCE(SUM(BYTES), 0) FROM USER_SEGMENTS", {"owner": current_user}),
    ]:
        try:
            rows = connection.execute(text(sql), params).fetchall()
            return {str(row[0]).upper(): int(row[1] or 0) for row in rows}
        except Exception:
            try:
                connection.rollback()
            except Exception:
                pass
            continue
    return {}


def _dm_table_segment_sizes(connection: Any, schema_name: str, current_user: str) -> dict[str, int]:
    queries = [
        (
            "SELECT SEGMENT_NAME, COALESCE(SUM(BYTES), 0) FROM ALL_SEGMENTS "
            "WHERE OWNER = :schema_name GROUP BY SEGMENT_NAME",
            {"schema_name": schema_name},
        ),
        (
            "SELECT SEGMENT_NAME, COALESCE(SUM(BYTES), 0) FROM DBA_SEGMENTS "
            "WHERE OWNER = :schema_name GROUP BY SEGMENT_NAME",
            {"schema_name": schema_name},
        ),
    ]
    if schema_name == current_user:
        queries.append(("SELECT SEGMENT_NAME, COALESCE(SUM(BYTES), 0) FROM USER_SEGMENTS GROUP BY SEGMENT_NAME", {}))

    for sql, params in queries:
        try:
            rows = connection.execute(text(sql), params).fetchall()
            return {str(row[0]).upper(): int(row[1] or 0) for row in rows}
        except Exception:
            try:
                connection.rollback()
            except Exception:
                pass
            continue
    return {}


def _oracle_current_user(connection: Any) -> str:
    row = connection.execute(text("SELECT USER FROM DUAL")).fetchone()
    return str(row[0]).upper() if row and row[0] is not None else ""


def _oracle_table_segment_sizes(connection: Any, schema_name: str, current_user: str) -> dict[str, int]:
    queries = [
        (
            "SELECT SEGMENT_NAME, COALESCE(SUM(BYTES), 0) FROM ALL_SEGMENTS "
            "WHERE OWNER = :schema_name AND SEGMENT_TYPE = 'TABLE' GROUP BY SEGMENT_NAME",
            {"schema_name": schema_name},
        ),
    ]
    if schema_name == current_user:
        queries.append(
            ("SELECT SEGMENT_NAME, COALESCE(SUM(BYTES), 0) FROM USER_SEGMENTS WHERE SEGMENT_TYPE = 'TABLE' GROUP BY SEGMENT_NAME", {})
        )

    for sql, params in queries:
        try:
            rows = connection.execute(text(sql), params).fetchall()
            return {str(row[0]).upper(): int(row[1] or 0) for row in rows}
        except Exception:
            try:
                connection.rollback()
            except Exception:
                pass
            continue
    return {}


def format_size(size_bytes: int | None) -> str | None:
    if size_bytes is None:
        return None

    value = float(size_bytes)
    for unit in ["B", "K", "M", "G"]:
        if value < 1024 or unit == "G":
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}B"
        value /= 1024

    return f"{value:.1f}G"


def _db_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    if hasattr(value, "getSubString") and hasattr(value, "length"):
        try:
            return str(value.getSubString(1, int(value.length())))
        except Exception:
            pass

    if hasattr(value, "read"):
        try:
            content = value.read()
            return _db_text(content)
        except Exception:
            pass

    return str(value)


def _pg_engine(engine: Engine, database_name: str) -> Engine:
    if engine.dialect.name == "postgresql":
        if engine.url.database == database_name:
            return engine

        from sqlalchemy import create_engine

        return create_engine(engine.url.set(database=database_name), pool_pre_ping=True)

    if engine.dialect.name == "gaussdb":
        current_database = engine.url.database
        if current_database == database_name:
            return engine

        factory = getattr(engine, "_datadjinn_engine_factory", None)
        if callable(factory):
            return factory(database_name)

    return engine


def list_databases(engine: Engine) -> list[DatabaseInfo]:
    if is_mongo_client(engine):
        databases = []
        for name in engine.list_database_names():
            stats = engine[name].command("dbStats")
            databases.append(DatabaseInfo(
                name=name,
                size_bytes=int(stats.get("dataSize", 0) or 0),
                size_display=format_size(int(stats.get("dataSize", 0) or 0)),
                storage_size_bytes=int(stats.get("storageSize", 0) or 0),
                storage_size_display=format_size(int(stats.get("storageSize", 0) or 0)),
            ))
        return databases

    if is_redis_client(engine):
        info = engine.info("keyspace")
        config = engine.config_get("databases")
        database_count = int(config.get("databases", 16) or 16)
        indexes = set(range(database_count))
        for key in info:
            if key.startswith("db"):
                indexes.add(parse_redis_database_name(key))

        return [
            DatabaseInfo(
                name=redis_database_name(index),
                size_bytes=int(info.get(redis_database_name(index), {}).get("keys", 0) or 0) if isinstance(info.get(redis_database_name(index)), dict) else 0,
                size_display=f"{int(info.get(redis_database_name(index), {}).get('keys', 0) or 0)} keys",
            )
            for index in sorted(indexes)
        ]

    if engine.dialect.name == "mysql":
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT s.SCHEMA_NAME, COALESCE(SUM(CASE WHEN COALESCE(t.TABLE_ROWS, 0) = 0 THEN 0 "
                    "ELSE COALESCE(t.TABLE_ROWS, 0) * COALESCE(c.ESTIMATED_ROW_BYTES, 64) END), 0) AS DATA_SIZE_BYTES, "
                    "COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS STORAGE_SIZE_BYTES "
                    "FROM information_schema.SCHEMATA s "
                    "LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME "
                    "LEFT JOIN ("
                    "SELECT TABLE_SCHEMA, TABLE_NAME, GREATEST(SUM(CASE "
                    "WHEN DATA_TYPE IN ('tinyint') THEN 1 "
                    "WHEN DATA_TYPE IN ('smallint') THEN 2 "
                    "WHEN DATA_TYPE IN ('mediumint') THEN 3 "
                    "WHEN DATA_TYPE IN ('int', 'integer', 'float', 'date', 'year') THEN 4 "
                    "WHEN DATA_TYPE IN ('bigint', 'double', 'datetime', 'timestamp', 'time') THEN 8 "
                    "WHEN DATA_TYPE IN ('decimal', 'numeric') THEN 16 "
                    "WHEN DATA_TYPE IN ('char', 'varchar', 'binary', 'varbinary') THEN LEAST(COALESCE(CHARACTER_MAXIMUM_LENGTH, 32), 256) "
                    "WHEN DATA_TYPE IN ('text', 'tinytext', 'mediumtext', 'longtext', 'blob', 'tinyblob', 'mediumblob', 'longblob', 'json') THEN 256 "
                    "WHEN DATA_TYPE IN ('enum', 'set') THEN 32 "
                    "ELSE 64 END), 1) AS ESTIMATED_ROW_BYTES "
                    "FROM information_schema.COLUMNS GROUP BY TABLE_SCHEMA, TABLE_NAME"
                    ") c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME "
                    "GROUP BY s.SCHEMA_NAME ORDER BY s.SCHEMA_NAME"
                )
            ).fetchall()
        return [
            DatabaseInfo(
                name=str(row[0]),
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[2] or 0),
                storage_size_display=format_size(int(row[2] or 0)),
            )
            for row in rows
        ]

    if _is_schema_scoped_engine(engine):
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname")
            ).fetchall()
        return [
            DatabaseInfo(
                name=str(row[0]),
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[1] or 0),
                storage_size_display=format_size(int(row[1] or 0)),
            )
            for row in rows
        ]

    if _is_oracle_engine(engine):
        with engine.connect() as connection:
            current_user = _oracle_current_user(connection)
            user_rows = []
            for sql in [
                "SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME",
                "SELECT USERNAME FROM USER_USERS ORDER BY USERNAME",
            ]:
                try:
                    user_rows = connection.execute(text(sql)).fetchall()
                    break
                except Exception:
                    try:
                        connection.rollback()
                    except Exception:
                        pass
                    continue

        names: list[str] = []
        for row in user_rows:
            schema_name = str(row[0]).upper()
            if schema_name == current_user or schema_name not in ORACLE_SYSTEM_SCHEMAS:
                names.append(schema_name)
        if current_user and current_user not in names:
            names.insert(0, current_user)
        ordered_names = sorted(dict.fromkeys(names), key=lambda item: (item != current_user, item))
        return [DatabaseInfo(name=name) for name in ordered_names]

    if _is_clickhouse_engine(engine):
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT d.name, COALESCE(SUM(t.total_bytes), 0) AS storage_size_bytes "
                    "FROM system.databases d LEFT JOIN system.tables t ON t.database = d.name "
                    "WHERE d.name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') "
                    "GROUP BY d.name ORDER BY d.name"
                )
            ).fetchall()
        return [
            DatabaseInfo(
                name=str(row[0]),
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[1] or 0),
                storage_size_display=format_size(int(row[1] or 0)),
            )
            for row in rows
        ]

    if engine.dialect.name in {"dm", "dmPython"}:
        with engine.connect() as connection:
            current_user = _dm_current_user(connection)
            owner_sizes = _dm_owner_segment_sizes(connection, current_user)
            schema_rows = []
            for schema_sql in [
                "SELECT NAME FROM SYSOBJECTS WHERE TYPE$ = 'SCH' ORDER BY NAME",
                "SELECT OBJECT_NAME FROM DBA_OBJECTS WHERE OBJECT_TYPE = 'SCH' ORDER BY OBJECT_NAME",
                "SELECT DISTINCT OWNER FROM ALL_OBJECTS WHERE OWNER IS NOT NULL ORDER BY OWNER",
                "SELECT DISTINCT TABLE_SCHEMA FROM ALL_TABLES WHERE TABLE_SCHEMA IS NOT NULL ORDER BY TABLE_SCHEMA",
            ]:
                try:
                    schema_rows = connection.execute(text(schema_sql)).fetchall()
                    break
                except Exception:
                    continue

        database_map = {
            owner: DatabaseInfo(
                name=owner,
                size_bytes=size_bytes,
                size_display=format_size(size_bytes),
                storage_size_bytes=size_bytes,
                storage_size_display=format_size(size_bytes),
            )
            for owner, size_bytes in owner_sizes.items()
        }
        for row in schema_rows:
            schema_name = str(row[0]).upper()
            if schema_name not in database_map:
                database_map[schema_name] = DatabaseInfo(name=schema_name)
        return sorted(database_map.values(), key=lambda item: (item.name != current_user, item.name))

    return [DatabaseInfo(name="main")]


def list_schemas(engine: Engine, database_name: str | None = None) -> list[DatabaseInfo]:
    if not _is_schema_scoped_engine(engine):
        return [DatabaseInfo(name="main")]

    target_db = database_name or engine.url.database or "postgres"
    db_engine = _pg_engine(engine, target_db)
    is_temp = target_db != engine.url.database

    try:
        with db_engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT n.nspname, COALESCE(SUM(CASE WHEN GREATEST(COALESCE(c.reltuples, 0)::bigint, 0) > 0 THEN GREATEST(COALESCE(c.reltuples, 0)::bigint, 0) * COALESCE(a.estimated_row_bytes, 64) ELSE pg_relation_size(c.oid) END), 0) AS data_size_bytes, "
                    "COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS storage_size_bytes "
                    "FROM pg_namespace n "
                    "LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'm') "
                    "LEFT JOIN ("
                    "SELECT attrelid, GREATEST(SUM(CASE "
                    "WHEN t.typname IN ('bool', 'char') THEN 1 "
                    "WHEN t.typname IN ('int2') THEN 2 "
                    "WHEN t.typname IN ('int4', 'float4', 'date') THEN 4 "
                    "WHEN t.typname IN ('int8', 'float8', 'timestamp', 'timestamptz', 'time', 'timetz') THEN 8 "
                    "WHEN t.typname IN ('numeric') THEN 16 "
                    "WHEN t.typname IN ('varchar', 'bpchar') THEN LEAST(COALESCE(NULLIF(a.atttypmod, -1) - 4, 32), 256) "
                    "WHEN t.typname IN ('text', 'json', 'jsonb', 'bytea') THEN 256 "
                    "ELSE 64 END), 1) AS estimated_row_bytes "
                    "FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid "
                    "WHERE a.attnum > 0 AND NOT a.attisdropped GROUP BY attrelid"
                    ") a ON a.attrelid = c.oid "
                    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%' "
                    "GROUP BY n.nspname ORDER BY n.nspname"
                )
            ).fetchall()
        return [
            DatabaseInfo(
                name=str(row[0]),
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[2] or 0),
                storage_size_display=format_size(int(row[2] or 0)),
            )
            for row in rows
        ]
    finally:
        if is_temp:
            db_engine.dispose()


def create_database(engine: Engine, database_name: str) -> DatabaseInfo:
    if is_mongo_client(engine):
        engine[database_name].create_collection("__datadjinn_init__")
        return DatabaseInfo(name=database_name)

    if is_redis_client(engine):
        index = parse_redis_database_name(database_name)
        target = redis_client_for_database(engine, redis_database_name(index))
        try:
            target.ping()
        finally:
            if target is not engine:
                target.close()
        return DatabaseInfo(name=redis_database_name(index))

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = database_name.upper()
        preparer = engine.dialect.identifier_preparer
        quoted = preparer.quote(schema_name)
        with engine.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {quoted}"))
        return DatabaseInfo(name=schema_name)

    if _is_oracle_engine(engine):
        raise ValueError("Oracle 当前不支持在客户端内直接创建 Schema / 用户")

    if _is_clickhouse_engine(engine):
        quoted = engine.dialect.identifier_preparer.quote(database_name)
        with engine.begin() as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))
        return DatabaseInfo(name=str(database_name))

    if engine.dialect.name not in {"mysql", "postgresql", "gaussdb"}:
        raise ValueError("SQLite 请通过新增文件连接创建数据库")

    preparer = engine.dialect.identifier_preparer
    quoted = preparer.quote(database_name)

    if _is_schema_scoped_engine(engine):
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))
    else:
        with engine.begin() as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))

    return DatabaseInfo(name=str(database_name))


def create_oracle_user(engine: Engine, user_name: str, password: str) -> DatabaseInfo:
    if not _is_oracle_engine(engine):
        raise ValueError("当前连接不是 Oracle")

    normalized_user = user_name.strip().upper()
    normalized_password = password.strip()
    if not normalized_user:
        raise ValueError("Oracle 用户名不能为空")
    if not normalized_password:
        raise ValueError("Oracle 用户密码不能为空")

    preparer = engine.dialect.identifier_preparer
    quoted_user = preparer.quote(normalized_user)
    escaped_password = normalized_password.replace('"', '""')
    grants = [
        "CREATE SESSION",
        "CREATE TABLE",
        "CREATE VIEW",
        "CREATE SEQUENCE",
        "CREATE TRIGGER",
        "CREATE PROCEDURE",
    ]

    with engine.begin() as connection:
        connection.execute(text(f'CREATE USER {quoted_user} IDENTIFIED BY "{escaped_password}"'))
        for grant in grants:
            connection.execute(text(f"GRANT {grant} TO {quoted_user}"))

    return DatabaseInfo(name=normalized_user)


def drop_database(engine: Engine, database_name: str) -> None:
    if is_mongo_client(engine):
        engine.drop_database(database_name)
        return

    if is_redis_client(engine):
        target = redis_client_for_database(engine, database_name)
        try:
            target.flushdb()
        finally:
            if target is not engine:
                target.close()
        return

    if _is_schema_scoped_engine(engine):
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f"DROP DATABASE {engine.dialect.identifier_preparer.quote(database_name)}"))
        return

    if engine.dialect.name == "mysql":
        with engine.begin() as connection:
            connection.execute(text(f"DROP DATABASE {engine.dialect.identifier_preparer.quote(database_name)}"))
        return

    if _is_clickhouse_engine(engine):
        with engine.begin() as connection:
            connection.execute(text(f"DROP DATABASE {engine.dialect.identifier_preparer.quote(database_name)}"))
        return

    raise ValueError("当前数据库类型不支持删除数据库")


def create_schema(engine: Engine, database_name: str, schema_name: str) -> DatabaseInfo:
    if not _is_schema_scoped_engine(engine):
        raise ValueError("仅 PostgreSQL / 高斯数据库支持新建 Schema")

    db_engine = _pg_engine(engine, database_name)

    preparer = db_engine.dialect.identifier_preparer

    try:
        with db_engine.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {preparer.quote(schema_name)}"))
    finally:
        if db_engine is not engine:
            db_engine.dispose()

    return DatabaseInfo(name=schema_name)


def list_tables(engine: Engine, database_name: str | None = None, pg_database: str | None = None) -> list[TableInfo]:
    if is_mongo_client(engine):
        target_db = database_name or mongo_default_database(engine)
        if not target_db:
            return []
        tables = []
        for name in engine[target_db].list_collection_names():
            stats = engine[target_db].command("collStats", name)
            tables.append(TableInfo(
                name=name,
                row_count=int(stats.get("count", 0) or 0),
                size_bytes=int(stats.get("size", 0) or 0),
                size_display=format_size(int(stats.get("size", 0) or 0)),
                storage_size_bytes=int(stats.get("storageSize", 0) or 0),
                storage_size_display=format_size(int(stats.get("storageSize", 0) or 0)),
            ))
        return tables

    if is_redis_client(engine):
        target = redis_client_for_database(engine, database_name)
        try:
            tables = []
            for key in redis_scan_keys(target):
                key_type = redis_key_type(target, key)
                memory = redis_memory_usage(target, key)
                tables.append(TableInfo(
                    name=key,
                    row_count=redis_key_length(target, key, key_type),
                    size_bytes=memory,
                    size_display=format_size(memory),
                    storage_size_bytes=memory,
                    storage_size_display=format_size(memory),
                ))
            return tables
        finally:
            if target is not engine:
                target.close()

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        engine = _pg_engine(engine, pg_database)

    if engine.dialect.name == "mysql":
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT t.TABLE_NAME, COALESCE(t.TABLE_ROWS, 0) AS TABLE_ROWS, "
                    "CASE WHEN COALESCE(t.TABLE_ROWS, 0) = 0 THEN 0 ELSE COALESCE(t.TABLE_ROWS, 0) * COALESCE(c.ESTIMATED_ROW_BYTES, 64) END AS DATA_SIZE_BYTES, "
                    "COALESCE(t.DATA_LENGTH + t.INDEX_LENGTH, 0) AS STORAGE_SIZE_BYTES "
                    "FROM information_schema.TABLES t "
                    "LEFT JOIN ("
                    "SELECT TABLE_SCHEMA, TABLE_NAME, GREATEST(SUM(CASE "
                    "WHEN DATA_TYPE IN ('tinyint') THEN 1 "
                    "WHEN DATA_TYPE IN ('smallint') THEN 2 "
                    "WHEN DATA_TYPE IN ('mediumint') THEN 3 "
                    "WHEN DATA_TYPE IN ('int', 'integer', 'float', 'date', 'year') THEN 4 "
                    "WHEN DATA_TYPE IN ('bigint', 'double', 'datetime', 'timestamp', 'time') THEN 8 "
                    "WHEN DATA_TYPE IN ('decimal', 'numeric') THEN 16 "
                    "WHEN DATA_TYPE IN ('char', 'varchar', 'binary', 'varbinary') THEN LEAST(COALESCE(CHARACTER_MAXIMUM_LENGTH, 32), 256) "
                    "WHEN DATA_TYPE IN ('text', 'tinytext', 'mediumtext', 'longtext', 'blob', 'tinyblob', 'mediumblob', 'longblob', 'json') THEN 256 "
                    "WHEN DATA_TYPE IN ('enum', 'set') THEN 32 "
                    "ELSE 64 END), 1) AS ESTIMATED_ROW_BYTES "
                    "FROM information_schema.COLUMNS GROUP BY TABLE_SCHEMA, TABLE_NAME"
                    ") c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME "
                    "WHERE t.TABLE_SCHEMA = :database_name ORDER BY t.TABLE_NAME"
                ),
                {"database_name": database_name or engine.url.database},
            ).fetchall()
        return [
            TableInfo(
                name=str(row[0]),
                row_count=int(row[1] or 0),
                size_bytes=0 if int(row[1] or 0) == 0 else int(row[2] or 0),
                size_display=format_size(0 if int(row[1] or 0) == 0 else int(row[2] or 0)),
                storage_size_bytes=int(row[3] or 0),
                storage_size_display=format_size(int(row[3] or 0)),
            )
            for row in rows
        ]

    if _is_schema_scoped_engine(engine):
        schema_name = database_name or "public"
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT c.relname, GREATEST(COALESCE(c.reltuples, 0)::bigint, 0) AS row_count, "
                    "CASE WHEN GREATEST(COALESCE(c.reltuples, 0)::bigint, 0) > 0 THEN GREATEST(COALESCE(c.reltuples, 0)::bigint, 0) * COALESCE(a.estimated_row_bytes, 64) ELSE pg_relation_size(c.oid) END AS data_size_bytes, "
                    "pg_total_relation_size(c.oid) AS storage_size_bytes "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "LEFT JOIN ("
                    "SELECT attrelid, GREATEST(SUM(CASE "
                    "WHEN t.typname IN ('bool', 'char') THEN 1 "
                    "WHEN t.typname IN ('int2') THEN 2 "
                    "WHEN t.typname IN ('int4', 'float4', 'date') THEN 4 "
                    "WHEN t.typname IN ('int8', 'float8', 'timestamp', 'timestamptz', 'time', 'timetz') THEN 8 "
                    "WHEN t.typname IN ('numeric') THEN 16 "
                    "WHEN t.typname IN ('varchar', 'bpchar') THEN LEAST(COALESCE(NULLIF(a.atttypmod, -1) - 4, 32), 256) "
                    "WHEN t.typname IN ('text', 'json', 'jsonb', 'bytea') THEN 256 "
                    "ELSE 64 END), 1) AS estimated_row_bytes "
                    "FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid "
                    "WHERE a.attnum > 0 AND NOT a.attisdropped GROUP BY attrelid"
                    ") a ON a.attrelid = c.oid "
                    "WHERE n.nspname = :schema_name AND c.relkind IN ('r', 'p', 'm') ORDER BY c.relname"
                ),
                {"schema_name": schema_name},
            ).fetchall()
        return [
            TableInfo(
                name=str(row[0]),
                row_count=int(row[1] or 0),
                size_bytes=int(row[2] or 0),
                size_display=format_size(int(row[2] or 0)),
                storage_size_bytes=int(row[3] or 0),
                storage_size_display=format_size(int(row[3] or 0)),
            )
            for row in rows
        ]

    if _is_clickhouse_engine(engine):
        target_db = database_name or engine.url.database or "default"
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT name, COALESCE(total_rows, 0) AS row_count, COALESCE(total_bytes, 0) AS storage_size_bytes "
                    "FROM system.tables WHERE database = :database_name AND is_temporary = 0 AND engine NOT LIKE '%View' ORDER BY name"
                ),
                {"database_name": target_db},
            ).fetchall()
        return [
            TableInfo(
                name=str(row[0]),
                row_count=int(row[1] or 0),
                size_bytes=int(row[2] or 0),
                size_display=format_size(int(row[2] or 0)),
                storage_size_bytes=int(row[2] or 0),
                storage_size_display=format_size(int(row[2] or 0)),
            )
            for row in rows
        ]

    if _is_oracle_engine(engine):
        schema_name = (database_name or engine.url.username or "").upper()
        with engine.connect() as connection:
            current_user = _oracle_current_user(connection)
            segment_sizes = _oracle_table_segment_sizes(connection, schema_name, current_user)
            rows = connection.execute(
                text(
                    "SELECT t.TABLE_NAME, COALESCE(t.NUM_ROWS, 0) AS ROW_COUNT, c.COMMENTS "
                    "FROM ALL_TABLES t "
                    "LEFT JOIN ALL_TAB_COMMENTS c "
                    "  ON c.OWNER = t.OWNER AND c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_TYPE = 'TABLE' "
                    "WHERE t.OWNER = :schema_name "
                    "ORDER BY t.TABLE_NAME"
                ),
                {"schema_name": schema_name},
            ).fetchall()

        return [
            TableInfo(
                name=str(row[0]),
                comment=_clean_optional_text(_db_text(row[2])) if len(row) > 2 else None,
                row_count=int(row[1] or 0),
                size_bytes=segment_sizes.get(str(row[0]).upper(), 0),
                size_display=format_size(segment_sizes.get(str(row[0]).upper(), 0)),
                storage_size_bytes=segment_sizes.get(str(row[0]).upper(), 0),
                storage_size_display=format_size(segment_sizes.get(str(row[0]).upper(), 0)),
            )
            for row in rows
        ]

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = (database_name or engine.url.username or "SYSDBA").upper()

        with engine.connect() as connection:
            current_user = _dm_current_user(connection)
            segment_sizes = _dm_table_segment_sizes(connection, schema_name, current_user)
            rows = connection.execute(
                text(
                    "SELECT t.TABLE_NAME, COALESCE(t.NUM_ROWS, 0) AS ROW_COUNT "
                    "FROM ALL_TABLES t WHERE t.OWNER = :schema_name ORDER BY t.TABLE_NAME"
                ),
                {"schema_name": schema_name},
            ).fetchall()

        return [
            TableInfo(
                name=str(row[0]),
                row_count=int(row[1] or 0),
                size_bytes=segment_sizes.get(str(row[0]).upper(), 0),
                size_display=format_size(segment_sizes.get(str(row[0]).upper(), 0)),
                storage_size_bytes=segment_sizes.get(str(row[0]).upper(), 0),
                storage_size_display=format_size(segment_sizes.get(str(row[0]).upper(), 0)),
            )
            for row in rows
        ]

    inspector = inspect(engine)
    return [TableInfo(name=table_name) for table_name in inspector.get_table_names(schema=database_name)]


def list_db_objects(engine: Engine, database_name: str | None = None, pg_database: str | None = None, object_type: str | None = None) -> list[DbObjectInfo]:
    objects: list[DbObjectInfo] = []

    if is_mongo_client(engine):
        if object_type not in {None, "table"}:
            return []
        return [DbObjectInfo(type="table", **table.model_dump()) for table in list_tables(engine, database_name, pg_database)]

    if is_redis_client(engine):
        if object_type not in {None, "table"}:
            return []
        return [DbObjectInfo(type="table", **table.model_dump()) for table in list_tables(engine, database_name, pg_database)]

    if object_type in {None, "table"}:
        objects.extend(DbObjectInfo(type="table", **table.model_dump()) for table in list_tables(engine, database_name, pg_database))

    if object_type not in {None, "view", "trigger", "procedure", "function", "sequence", "index"}:
        return objects

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        engine = _pg_engine(engine, pg_database)

    schema_name = database_name

    if engine.dialect.name == "mysql":
        target_db = database_name or engine.url.database
        with engine.connect() as connection:
            if object_type in {None, "view"}:
                rows = connection.execute(text("SELECT TABLE_NAME FROM information_schema.VIEWS WHERE TABLE_SCHEMA = :db ORDER BY TABLE_NAME"), {"db": target_db}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="view") for row in rows)
            if object_type in {None, "trigger"}:
                rows = connection.execute(text("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = :db ORDER BY TRIGGER_NAME"), {"db": target_db}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="trigger") for row in rows)
            if object_type in {None, "procedure"}:
                rows = connection.execute(text("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = :db AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME"), {"db": target_db}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="procedure") for row in rows)
            if object_type in {None, "function"}:
                rows = connection.execute(text("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = :db AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME"), {"db": target_db}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="function") for row in rows)
            if object_type in {None, "index"}:
                rows = connection.execute(text("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = :db AND INDEX_NAME <> 'PRIMARY' GROUP BY INDEX_NAME ORDER BY INDEX_NAME"), {"db": target_db}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="index") for row in rows)
        return objects

    if _is_schema_scoped_engine(engine):
        target_schema = schema_name or "public"
        with engine.connect() as connection:
            if object_type in {None, "view"}:
                rows = connection.execute(text("SELECT table_name FROM information_schema.views WHERE table_schema = :schema ORDER BY table_name"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="view") for row in rows)
            if object_type in {None, "trigger"}:
                rows = connection.execute(text("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = :schema ORDER BY trigger_name"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="trigger") for row in rows)
            if object_type in {None, "procedure", "function"}:
                rows = connection.execute(text("SELECT p.proname, CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = :schema AND p.prokind IN ('p', 'f') ORDER BY p.proname"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type=row[1]) for row in rows if object_type is None or row[1] == object_type)
            if object_type in {None, "sequence"}:
                rows = connection.execute(text("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = :schema ORDER BY sequence_name"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="sequence") for row in rows)
            if object_type in {None, "index"}:
                rows = connection.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = :schema ORDER BY indexname"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="index") for row in rows)
        return objects

    if _is_clickhouse_engine(engine):
        target_db = database_name or engine.url.database or "default"
        if object_type in {None, "view"}:
            with engine.connect() as connection:
                rows = connection.execute(
                    text("SELECT name FROM system.tables WHERE database = :database_name AND engine LIKE '%View' ORDER BY name"),
                    {"database_name": target_db},
                ).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="view") for row in rows)
        return objects

    if _is_oracle_engine(engine):
        target_schema = (schema_name or engine.url.username or "").upper()
        with engine.connect() as connection:
            if object_type in {None, "view"}:
                rows = connection.execute(text("SELECT VIEW_NAME FROM ALL_VIEWS WHERE OWNER = :schema ORDER BY VIEW_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="view") for row in rows)
            if object_type in {None, "trigger"}:
                rows = connection.execute(text("SELECT TRIGGER_NAME FROM ALL_TRIGGERS WHERE OWNER = :schema ORDER BY TRIGGER_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="trigger") for row in rows)
            if object_type in {None, "procedure", "function"}:
                rows = connection.execute(
                    text(
                        "SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS "
                        "WHERE OWNER = :schema AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION') "
                        "ORDER BY OBJECT_NAME"
                    ),
                    {"schema": target_schema},
                ).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type=str(row[1]).lower()) for row in rows if object_type is None or str(row[1]).lower() == object_type)
            if object_type in {None, "sequence"}:
                rows = connection.execute(text("SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = :schema ORDER BY SEQUENCE_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="sequence") for row in rows)
            if object_type in {None, "index"}:
                rows = connection.execute(text("SELECT INDEX_NAME FROM ALL_INDEXES WHERE OWNER = :schema ORDER BY INDEX_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="index") for row in rows)
        return objects

    if engine.dialect.name in {"dm", "dmPython"}:
        target_schema = (schema_name or engine.url.username or "SYSDBA").upper()
        with engine.connect() as connection:
            if object_type in {None, "view"}:
                rows = connection.execute(text("SELECT VIEW_NAME FROM ALL_VIEWS WHERE OWNER = :schema ORDER BY VIEW_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="view") for row in rows)
            if object_type in {None, "trigger"}:
                rows = connection.execute(text("SELECT TRIGGER_NAME FROM ALL_TRIGGERS WHERE OWNER = :schema ORDER BY TRIGGER_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="trigger") for row in rows)
            if object_type in {None, "procedure", "function"}:
                rows = connection.execute(text("SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION') ORDER BY OBJECT_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type=str(row[1]).lower()) for row in rows if object_type is None or str(row[1]).lower() == object_type)
            if object_type in {None, "sequence"}:
                rows = connection.execute(text("SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = :schema ORDER BY SEQUENCE_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="sequence") for row in rows)
            if object_type in {None, "index"}:
                rows = connection.execute(text("SELECT INDEX_NAME FROM ALL_INDEXES WHERE OWNER = :schema ORDER BY INDEX_NAME"), {"schema": target_schema}).fetchall()
                objects.extend(DbObjectInfo(name=str(row[0]), type="index") for row in rows)
        return objects

    inspector = inspect(engine)
    if object_type in {None, "view"}:
        objects.extend(DbObjectInfo(name=name, type="view") for name in inspector.get_view_names(schema=schema_name))
    if object_type in {None, "trigger"}:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")).fetchall()
            objects.extend(DbObjectInfo(name=str(row[0]), type="trigger") for row in rows)
    if object_type in {None, "index"}:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")).fetchall()
            objects.extend(DbObjectInfo(name=str(row[0]), type="index") for row in rows)
    return objects


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _constraint_name(prefix: str, table_name: str, column_name: str) -> str:
    raw = re.sub(r"[^A-Za-z0-9_]+", "_", f"{prefix}_{table_name}_{column_name}").strip("_")
    return raw[:60] or f"{prefix}_constraint"


def _normalize_bound(value: str | None, label: str) -> str | None:
    cleaned = _clean_optional_text(value)
    if cleaned is None:
        return None
    if not NUMERIC_LITERAL_PATTERN.fullmatch(cleaned):
        raise ValueError(f"{label} 必须是数字")
    try:
        Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"{label} 必须是有效数字") from exc
    return cleaned


def _is_integer_type(type_name: str) -> bool:
    normalized = type_name.strip().lower()
    if normalized.startswith(("int", "integer", "bigint", "smallint", "tinyint", "mediumint", "serial", "bigserial", "smallserial")):
        return True

    match = re.fullmatch(r"(number|numeric|decimal)(?:\((\d+)(?:\s*,\s*(\d+))?\))?", normalized)
    if not match:
        return False

    scale = match.group(3)
    return scale is None or scale == "0"


def _is_numeric_type(type_name: str) -> bool:
    normalized = type_name.strip().lower()
    return normalized.startswith((
        "int", "integer", "bigint", "smallint", "tinyint", "mediumint",
        "decimal", "numeric", "number", "float", "double", "real", "serial", "bigserial", "smallserial",
    ))


def _column_comment_sql(column: TableUpdateColumn) -> str | None:
    return _clean_optional_text(column.comment)


def _column_minimum(column: TableUpdateColumn) -> str | None:
    return _normalize_bound(column.minimum, f"字段 {column.name} 的最小值")


def _column_maximum(column: TableUpdateColumn) -> str | None:
    return _normalize_bound(column.maximum, f"字段 {column.name} 的最大值")


def _gaussdb_serial_type(type_name: str) -> str | None:
    normalized = type_name.strip().lower()
    if normalized in {"smallint", "int2", "smallserial"}:
        return "SMALLSERIAL"
    if normalized in {"integer", "int", "int4", "serial"}:
        return "SERIAL"
    if normalized in {"bigint", "int8", "bigserial", "largeserial"}:
        return "BIGSERIAL"
    return None


def _validate_table_columns(next_columns: list[TableUpdateColumn], dialect_name: str) -> None:
    if not next_columns:
        raise ValueError("至少需要一个字段")

    seen_names: set[str] = set()
    primary_key_columns = [column.name.strip() for column in next_columns if column.primary_key]
    auto_increment_columns = [column for column in next_columns if column.auto_increment]

    for column in next_columns:
        column_name = column.name.strip()
        if not column_name:
            raise ValueError("字段名不能为空")
        if column_name in seen_names:
            raise ValueError(f"字段 {column_name} 重复")
        seen_names.add(column_name)
        if not COLUMN_TYPE_PATTERN.fullmatch(column.type.strip()):
            raise ValueError(f"字段 {column_name} 的类型不合法")

        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if minimum is not None or maximum is not None:
            if not _is_numeric_type(column.type):
                raise ValueError(f"字段 {column_name} 只有数值类型才能设置最小值和最大值")
            if minimum is not None and maximum is not None and Decimal(minimum) > Decimal(maximum):
                raise ValueError(f"字段 {column_name} 的最小值不能大于最大值")

        if column.auto_increment:
            if not _is_integer_type(column.type):
                raise ValueError(f"字段 {column_name} 只有整数类型才能设置自增")
            if dialect_name in {"mysql", "sqlite"} and column.auto_increment_step is not None:
                raise ValueError(f"{dialect_name} 不支持列级自增步长")
            if dialect_name == "gaussdb" and column.auto_increment_step not in {None, 1}:
                raise ValueError("高斯数据库当前仅支持自增步长为 1")
        if column.auto_increment_step is not None and column.auto_increment_step < 1:
            raise ValueError(f"字段 {column_name} 的自增步长必须大于 0")

    if dialect_name == "sqlite" and len(primary_key_columns) > 1:
        raise ValueError("SQLite 暂不支持复合主键修改")
    if dialect_name == "sqlite" and auto_increment_columns:
        if len(auto_increment_columns) > 1:
            raise ValueError("SQLite 只能有一个自增字段")
        if not auto_increment_columns[0].primary_key:
            raise ValueError("SQLite 自增字段必须是主键")


def _extract_bounds_from_clause(clause: str, column_name: str) -> tuple[str | None, str | None]:
    identifier_pattern = rf"(?:`|\"|\[)?{re.escape(column_name)}(?:`|\"|\])?"
    minimum_match = re.search(rf"{identifier_pattern}\s*>=\s*(-?\d+(?:\.\d+)?)", clause, flags=re.IGNORECASE)
    maximum_match = re.search(rf"{identifier_pattern}\s*<=\s*(-?\d+(?:\.\d+)?)", clause, flags=re.IGNORECASE)
    return (minimum_match.group(1) if minimum_match else None, maximum_match.group(1) if maximum_match else None)


def _unique_constraint_name(table_name: str, column_name: str) -> str:
    return _constraint_name("uq", table_name, column_name)


def _min_constraint_name(table_name: str, column_name: str) -> str:
    return _constraint_name("chk", table_name, f"{column_name}_min")


def _max_constraint_name(table_name: str, column_name: str) -> str:
    return _constraint_name("chk", table_name, f"{column_name}_max")


def _quote_table(preparer, table_name: str, database_name: str | None = None) -> str:
    if database_name:
        return f"{preparer.quote(database_name)}.{preparer.quote(table_name)}"
    return preparer.quote(table_name)


def _mysql_single_column_unique_indexes(engine: Engine, table_name: str, database_name: str | None) -> dict[str, str]:
    target_db = database_name or engine.url.database
    if not target_db:
        return {}

    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT INDEX_NAME, COLUMN_NAME, COUNT(*) OVER (PARTITION BY INDEX_NAME) AS COLUMN_COUNT "
                "FROM information_schema.STATISTICS "
                "WHERE TABLE_SCHEMA = :database_name AND TABLE_NAME = :table_name "
                "AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'"
            ),
            {"database_name": target_db, "table_name": table_name},
        ).fetchall()

    result: dict[str, str] = {}
    for row in rows:
        if int(row[2] or 0) == 1:
            result[str(row[1])] = str(row[0])
    return result


def _pg_single_column_unique_constraints(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT kcu.column_name, tc.constraint_name, COUNT(*) OVER (PARTITION BY tc.constraint_name) AS column_count "
                "FROM information_schema.table_constraints tc "
                "JOIN information_schema.key_column_usage kcu "
                "ON tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name "
                "WHERE tc.table_schema = :schema_name AND tc.table_name = :table_name "
                "AND tc.constraint_type = 'UNIQUE'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    result: dict[str, str] = {}
    for row in rows:
        if int(row[2] or 0) == 1:
            result[str(row[0])] = str(row[1])
    return result


def _pg_check_constraints(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT ccu.column_name, cc.check_clause "
                "FROM information_schema.table_constraints tc "
                "JOIN information_schema.check_constraints cc "
                "  ON cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name "
                "JOIN information_schema.constraint_column_usage ccu "
                "  ON ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name "
                "WHERE tc.table_schema = :schema_name AND tc.table_name = :table_name "
                "AND tc.constraint_type = 'CHECK'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    return {str(row[0]): _db_text(row[1]) for row in rows if row[0] is not None and row[1] is not None}


def _pg_table_comment(engine: Engine, table_name: str, schema_name: str) -> str | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT d.description "
                "FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0 "
                "WHERE n.nspname = :schema_name AND c.relname = :table_name "
                "AND c.relkind IN ('r', 'p', 'v', 'm', 'f')"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchone()
    return _clean_optional_text(_db_text(row[0])) if row and row[0] is not None else None


def _pg_column_comments(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT a.attname, d.description "
                "FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "JOIN pg_attribute a ON a.attrelid = c.oid "
                "LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum "
                "WHERE n.nspname = :schema_name AND c.relname = :table_name "
                "AND a.attnum > 0 AND NOT a.attisdropped"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    return {
        str(row[0]): _clean_optional_text(_db_text(row[1])) or ""
        for row in rows
        if row[0] is not None and row[1] is not None
    }


def _oracle_single_column_unique_constraints(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT acc.COLUMN_NAME, ac.CONSTRAINT_NAME, COUNT(*) OVER (PARTITION BY ac.CONSTRAINT_NAME) AS COLUMN_COUNT "
                "FROM ALL_CONSTRAINTS ac "
                "JOIN ALL_CONS_COLUMNS acc "
                "  ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME "
                "WHERE ac.OWNER = :schema_name AND ac.TABLE_NAME = :table_name "
                "AND ac.CONSTRAINT_TYPE = 'U'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    result: dict[str, str] = {}
    for row in rows:
        if int(row[2] or 0) == 1:
            result[str(row[0])] = str(row[1])
    return result


def _oracle_check_constraints(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT acc.COLUMN_NAME, ac.SEARCH_CONDITION "
                "FROM ALL_CONSTRAINTS ac "
                "JOIN ALL_CONS_COLUMNS acc "
                "  ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME "
                "WHERE ac.OWNER = :schema_name AND ac.TABLE_NAME = :table_name "
                "AND ac.CONSTRAINT_TYPE = 'C'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    return {str(row[0]): _db_text(row[1]) for row in rows if row[0] is not None and row[1] is not None}


def _oracle_table_comment(engine: Engine, table_name: str, schema_name: str) -> str | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT COMMENTS FROM ALL_TAB_COMMENTS "
                "WHERE OWNER = :schema_name AND TABLE_NAME = :table_name AND TABLE_TYPE = 'TABLE'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchone()
    return _clean_optional_text(_db_text(row[0])) if row and row[0] is not None else None


def _oracle_column_comments(engine: Engine, table_name: str, schema_name: str) -> dict[str, str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS "
                "WHERE OWNER = :schema_name AND TABLE_NAME = :table_name"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()

    return {
        str(row[0]): _clean_optional_text(_db_text(row[1])) or ""
        for row in rows
        if row[0] is not None and row[1] is not None
    }


def _oracle_identity_step(identity_options: str | None) -> int | None:
    if not identity_options:
        return 1

    match = re.search(r"INCREMENT BY[:\s]+(-?\d+)", identity_options, flags=re.IGNORECASE)
    if not match:
        return 1

    try:
        return int(match.group(1))
    except ValueError:
        return 1


def _sqlite_unique_columns(engine: Engine, table_name: str) -> set[str]:
    escaped_table = table_name.replace('"', '""')
    result: set[str] = set()

    with engine.connect() as connection:
        index_rows = connection.execute(text(f'PRAGMA index_list("{escaped_table}")')).fetchall()
        for row in index_rows:
            if len(row) < 3 or not bool(row[2]):
                continue
            index_name = str(row[1])
            index_rows_inner = connection.execute(text(f'PRAGMA index_info("{index_name.replace("\"", "\"\"")}")')).fetchall()
            if len(index_rows_inner) == 1:
                result.add(str(index_rows_inner[0][2]))

    return result


def _pg_sequence_increment(engine: Engine, table_name: str, column_name: str, schema_name: str) -> int | None:
    sequence_name = _pg_sequence_name(engine, table_name, column_name, schema_name)
    if not sequence_name:
        return None

    cleaned = sequence_name.replace('"', "")
    if "." in cleaned:
        seq_schema, seq_name = cleaned.split(".", 1)
    else:
        seq_schema, seq_name = schema_name, cleaned

    with engine.connect() as connection:
        try:
            row = connection.execute(
                text("SELECT increment_by FROM pg_sequences WHERE schemaname = :schema_name AND sequencename = :sequence_name"),
                {"schema_name": seq_schema, "sequence_name": seq_name},
            ).fetchone()
        except Exception:
            return None
    return int(row[0]) if row and row[0] is not None else None


def get_table_comment(engine: Engine, table_name: str, database_name: str | None = None, pg_database: str | None = None) -> str | None:
    if is_mongo_client(engine) or is_redis_client(engine) or _is_clickhouse_engine(engine):
        return None

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            return get_table_comment(db_engine, table_name, database_name, None)
        finally:
            if db_engine is not engine:
                db_engine.dispose()

    if engine.dialect.name == "mysql":
        target_db = database_name or engine.url.database
        if not target_db:
            return None
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = :database_name AND TABLE_NAME = :table_name"),
                {"database_name": target_db, "table_name": table_name},
            ).fetchone()
        return _clean_optional_text(_db_text(row[0])) if row and row[0] is not None else None

    if _is_schema_scoped_engine(engine):
        schema_name = database_name or "public"
        return _pg_table_comment(engine, table_name, schema_name)

    if _is_oracle_engine(engine):
        schema_name = (database_name or engine.url.username or "").upper()
        return _oracle_table_comment(engine, table_name, schema_name)

    return None


def list_columns(engine: Engine, table_name: str, database_name: str | None = None, pg_database: str | None = None) -> list[ColumnInfo]:
    if is_mongo_client(engine):
        target_db = database_name or mongo_default_database(engine)
        if not target_db:
            return []
        fields: dict[str, str] = {}
        for document in engine[target_db][table_name].find({}, limit=100):
            for key, value in document.items():
                fields.setdefault(str(key), mongo_value_type(value))
        return [ColumnInfo(name=name, type=value_type, nullable=True, primary_key=name == "_id") for name, value_type in fields.items()]

    if is_redis_client(engine):
        target = redis_client_for_database(engine, database_name)
        try:
            key_type = redis_key_type(target, table_name)
            if key_type == "hash":
                fields = target.hkeys(table_name)
                return [ColumnInfo(name=str(field.decode("utf-8") if isinstance(field, bytes) else field), type="hash field", nullable=True, primary_key=False) for field in fields]
            if key_type == "zset":
                return [ColumnInfo(name="member", type="string", nullable=False, primary_key=True), ColumnInfo(name="score", type="float", nullable=False, primary_key=False)]
            if key_type in {"list", "set", "stream"}:
                return [ColumnInfo(name="index", type="int", nullable=False, primary_key=True), ColumnInfo(name="value", type=key_type, nullable=True, primary_key=False)]
            return [ColumnInfo(name="key", type="string", nullable=False, primary_key=True), ColumnInfo(name="value", type=key_type, nullable=True, primary_key=False)]
        finally:
            if target is not engine:
                target.close()

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            return list_columns(db_engine, table_name, database_name, None)
        finally:
            if db_engine is not engine:
                db_engine.dispose()

    if _is_clickhouse_engine(engine):
        target_db = database_name or engine.url.database or "default"
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT name, type, COALESCE(is_in_sorting_key, 0) AS primary_key "
                    "FROM system.columns WHERE database = :database_name AND table = :table_name ORDER BY position"
                ),
                {"database_name": target_db, "table_name": table_name},
            ).fetchall()
        return [
            ColumnInfo(
                name=str(row[0]),
                type=str(row[1]),
                nullable="Nullable(" in str(row[1]),
                primary_key=bool(row[2]),
            )
            for row in rows
        ]

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = database_name or engine.url.username.upper() or "SYSDBA"
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, "
                    "CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS PRIMARY_KEY "
                    "FROM ALL_TAB_COLUMNS c "
                    "LEFT JOIN ("
                    "  SELECT acc.COLUMN_NAME FROM ALL_CONSTRAINTS ac "
                    "  JOIN ALL_CONS_COLUMNS acc ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME "
                    "  WHERE ac.CONSTRAINT_TYPE = 'P' AND ac.OWNER = :schema_name AND ac.TABLE_NAME = :table_name"
                    ") pk ON pk.COLUMN_NAME = c.COLUMN_NAME "
                    "WHERE c.OWNER = :schema_name AND c.TABLE_NAME = :table_name "
                    "ORDER BY c.COLUMN_ID"
                ),
                {"schema_name": schema_name, "table_name": table_name},
            ).fetchall()
        primary_keys = {str(row[0]) for row in rows if row[3] == 1}
        return [
            ColumnInfo(
                name=str(row[0]),
                type=str(row[1]),
                nullable=row[2] == "Y",
                primary_key=str(row[0]) in primary_keys,
            )
            for row in rows
        ]

    if _is_oracle_engine(engine):
        schema_name = (database_name or engine.url.username or "").upper()
        unique_columns = _oracle_single_column_unique_constraints(engine, table_name, schema_name)
        check_constraints = _oracle_check_constraints(engine, table_name, schema_name)
        column_comments = _oracle_column_comments(engine, table_name, schema_name)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT c.COLUMN_NAME, "
                    "CASE "
                    "  WHEN c.DATA_TYPE IN ('CHAR', 'NCHAR', 'VARCHAR2', 'NVARCHAR2') AND c.CHAR_LENGTH IS NOT NULL THEN c.DATA_TYPE || '(' || c.CHAR_LENGTH || ')' "
                    "  WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL AND NVL(c.DATA_SCALE, 0) > 0 THEN c.DATA_TYPE || '(' || c.DATA_PRECISION || ',' || c.DATA_SCALE || ')' "
                    "  WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL THEN c.DATA_TYPE || '(' || c.DATA_PRECISION || ')' "
                    "  WHEN c.DATA_TYPE LIKE 'TIMESTAMP%' AND c.DATA_SCALE IS NOT NULL THEN c.DATA_TYPE || '(' || c.DATA_SCALE || ')' "
                    "  ELSE c.DATA_TYPE "
                    "END AS DATA_TYPE_DISPLAY, "
                    "c.NULLABLE, "
                    "CASE WHEN pk.COLUMN_NAME IS NULL THEN 0 ELSE 1 END AS PRIMARY_KEY, "
                    "c.DATA_DEFAULT, "
                    "i.GENERATION_TYPE, "
                    "i.IDENTITY_OPTIONS "
                    "FROM ALL_TAB_COLUMNS c "
                    "LEFT JOIN ("
                    "  SELECT acc.COLUMN_NAME FROM ALL_CONSTRAINTS ac "
                    "  JOIN ALL_CONS_COLUMNS acc ON ac.OWNER = acc.OWNER AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME "
                    "  WHERE ac.CONSTRAINT_TYPE = 'P' AND ac.OWNER = :schema_name AND ac.TABLE_NAME = :table_name"
                    ") pk ON pk.COLUMN_NAME = c.COLUMN_NAME "
                    "LEFT JOIN ALL_TAB_IDENTITY_COLS i "
                    "  ON i.OWNER = c.OWNER AND i.TABLE_NAME = c.TABLE_NAME AND i.COLUMN_NAME = c.COLUMN_NAME "
                    "WHERE c.OWNER = :schema_name AND c.TABLE_NAME = :table_name "
                    "ORDER BY c.COLUMN_ID"
                ),
                {"schema_name": schema_name, "table_name": table_name},
            ).fetchall()
        columns: list[ColumnInfo] = []
        for row in rows:
            column_name = str(row[0])
            default_value = _clean_optional_text(_db_text(row[4]))
            identity_options = _db_text(row[6]) if len(row) > 6 and row[6] is not None else ""
            minimum, maximum = _extract_bounds_from_clause(check_constraints.get(column_name, ""), column_name)
            auto_increment = row[5] is not None
            columns.append(
                ColumnInfo(
                    name=column_name,
                    type=str(row[1]),
                    nullable=str(row[2]).upper() == "Y",
                    primary_key=bool(row[3]),
                    default_value=default_value,
                    comment=column_comments.get(column_name) or None,
                    unique=column_name in unique_columns,
                    auto_increment=auto_increment,
                    auto_increment_step=_oracle_identity_step(identity_options) if auto_increment else None,
                    minimum=minimum,
                    maximum=maximum,
                )
            )
        return columns

    if _is_schema_scoped_engine(engine):
        schema_name = database_name or "public"
        unique_columns = _pg_single_column_unique_constraints(engine, table_name, schema_name)
        check_constraints = _pg_check_constraints(engine, table_name, schema_name)
        column_comments = _pg_column_comments(engine, table_name, schema_name)
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT c.column_name, c.data_type, c.is_nullable, "
                    "CASE WHEN kcu.column_name IS NULL THEN 0 ELSE 1 END AS primary_key, "
                    "c.column_default "
                    "FROM information_schema.columns c "
                    "LEFT JOIN information_schema.table_constraints tc "
                    "  ON tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' "
                    "LEFT JOIN information_schema.key_column_usage kcu "
                    "  ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name "
                    " AND kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name "
                    "WHERE c.table_schema = :schema_name AND c.table_name = :table_name "
                    "ORDER BY c.ordinal_position"
                ),
                {"schema_name": schema_name, "table_name": table_name},
            ).fetchall()
        columns: list[ColumnInfo] = []
        for row in rows:
            column_name = str(row[0])
            default_value = _clean_optional_text(_db_text(row[4]))
            minimum, maximum = _extract_bounds_from_clause(check_constraints.get(column_name, ""), column_name)
            columns.append(
                ColumnInfo(
                    name=column_name,
                    type=str(row[1]),
                    nullable=str(row[2]).upper() == "YES",
                    primary_key=bool(row[3]),
                    default_value=default_value,
                    comment=column_comments.get(column_name) or None,
                    unique=column_name in unique_columns,
                    auto_increment=bool(default_value and ("nextval(" in default_value or "generated" in default_value.lower())),
                    auto_increment_step=_pg_sequence_increment(engine, table_name, column_name, schema_name) if default_value and ("nextval(" in default_value or "generated" in default_value.lower()) else None,
                    minimum=minimum,
                    maximum=maximum,
                )
            )
        return columns

    inspector = inspect(engine)
    primary_keys = set(inspector.get_pk_constraint(table_name, schema=database_name).get("constrained_columns") or [])

    return [
        ColumnInfo(
            name=column["name"],
            type=str(column["type"]),
            nullable=bool(column.get("nullable", True)),
            primary_key=column["name"] in primary_keys,
            default_value=_clean_optional_text(_db_text(column.get("default"))),
            comment=_clean_optional_text(_db_text(column.get("comment"))),
            auto_increment=bool(column.get("autoincrement")) and str(column.get("autoincrement")).lower() != "false",
        )
        for column in inspector.get_columns(table_name, schema=database_name)
    ]


def get_object_ddl(engine: Engine, object_name: str, object_type: str, database_name: str | None = None, pg_database: str | None = None) -> str:
    object_type = object_type.strip().lower()

    if is_mongo_client(engine):
        if object_type != "table":
            raise ValueError("MongoDB 当前仅支持查看集合信息")
        columns = list_columns(engine, object_name, database_name)
        fields = ",\n  ".join(f"{column.name}: {column.type}" for column in columns)
        return f"db.{object_name}.find()\n\n// 推断字段（基于前 100 条文档）：\n{{\n  {fields}\n}}" if fields else f"db.{object_name}.find()"

    if is_redis_client(engine):
        if object_type != "table":
            raise ValueError("Redis 当前仅支持查看 Key 信息")
        target = redis_client_for_database(engine, database_name)
        try:
            key_type = redis_key_type(target, object_name)
            ttl = target.ttl(object_name)
            length = redis_key_length(target, object_name, key_type)
            memory = redis_memory_usage(target, object_name)
            return "\n".join([
                f"GET {object_name}" if key_type == "string" else f"TYPE {object_name}",
                "",
                "# Redis Key 信息",
                f"type: {key_type}",
                f"ttl: {ttl}",
                f"length: {length}",
                f"memory_usage: {memory}",
            ])
        finally:
            if target is not engine:
                target.close()

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            return get_object_ddl(db_engine, object_name, object_type, database_name, None)
        finally:
            if db_engine is not engine:
                db_engine.dispose()

    preparer = engine.dialect.identifier_preparer

    if engine.dialect.name == "mysql":
        target_db = database_name or engine.url.database
        quoted_object = _quote_table(preparer, object_name, target_db)
        with engine.connect() as connection:
            if object_type == "table":
                row = connection.execute(text(f"SHOW CREATE TABLE {quoted_object}")).fetchone()
                return row[1] if row and len(row) > 1 else ""
            if object_type == "view":
                row = connection.execute(text(f"SHOW CREATE VIEW {quoted_object}")).fetchone()
                return row[1] if row and len(row) > 1 else ""
            if object_type == "trigger":
                row = connection.execute(text(f"SHOW CREATE TRIGGER {quoted_object}")).fetchone()
                return row[2] if row and len(row) > 2 else ""
            if object_type == "procedure":
                row = connection.execute(text(f"SHOW CREATE PROCEDURE {quoted_object}")).fetchone()
                return row[2] if row and len(row) > 2 else ""
            if object_type == "function":
                row = connection.execute(text(f"SHOW CREATE FUNCTION {quoted_object}")).fetchone()
                return row[2] if row and len(row) > 2 else ""
        raise ValueError("当前对象类型不支持查看 DDL")

    if _is_schema_scoped_engine(engine):
        schema_name = database_name or "public"
        with engine.connect() as connection:
            if object_type in {"table", "view"}:
                if object_type == "view":
                    row = connection.execute(
                        text(
                            "SELECT pg_get_viewdef(c.oid, true) "
                            "FROM pg_class c "
                            "JOIN pg_namespace n ON n.oid = c.relnamespace "
                            "WHERE n.nspname = :schema AND c.relname = :name "
                            "AND c.relkind IN ('v', 'm') "
                            "LIMIT 1"
                        ),
                        {"schema": schema_name, "name": object_name},
                    ).fetchone()
                    body = row[0] if row else ""
                    return f"CREATE OR REPLACE VIEW {preparer.quote(schema_name)}.{preparer.quote(object_name)} AS\n{body};" if body else ""

                return _build_pg_table_ddl(engine, object_name, schema_name)

            if object_type in {"function", "procedure"}:
                row = connection.execute(
                    text(
                        "SELECT pg_get_functiondef(p.oid) FROM pg_proc p "
                        "JOIN pg_namespace n ON n.oid = p.pronamespace "
                        "WHERE n.nspname = :schema AND p.proname = :name "
                        "AND p.prokind = CASE WHEN :type = 'procedure' THEN 'p' ELSE 'f' END LIMIT 1"
                    ),
                    {"schema": schema_name, "name": object_name, "type": object_type},
                ).fetchone()
                return row[0] if row else ""

            if object_type == "trigger":
                row = connection.execute(
                    text(
                        "SELECT pg_get_triggerdef(t.oid, true), pg_get_functiondef(p.oid) "
                        "FROM pg_trigger t "
                        "JOIN pg_class c ON c.oid = t.tgrelid "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "JOIN pg_proc p ON p.oid = t.tgfoid "
                        "WHERE n.nspname = :schema AND t.tgname = :name "
                        "AND NOT t.tgisinternal "
                        "LIMIT 1"
                    ),
                    {"schema": schema_name, "name": object_name},
                ).fetchone()
                if not row or not row[0]:
                    return ""
                trigger_ddl = f"{row[0]};"
                function_ddl = row[1] if len(row) > 1 and row[1] else ""
                return f"{trigger_ddl}\n\n{function_ddl}".strip()

            if object_type == "sequence":
                return f"CREATE SEQUENCE {preparer.quote(schema_name)}.{preparer.quote(object_name)};"

            if object_type == "index":
                row = connection.execute(
                    text("SELECT indexdef FROM pg_indexes WHERE schemaname = :schema AND indexname = :name"),
                    {"schema": schema_name, "name": object_name},
                ).fetchone()
                return row[0] if row else ""
        raise ValueError("当前对象类型不支持查看 DDL")

    if _is_clickhouse_engine(engine):
        if object_type not in {"table", "view"}:
            raise ValueError("当前对象类型不支持查看 DDL")
        target_db = database_name or engine.url.database or "default"
        quoted_object = _quote_table(preparer, object_name, target_db)
        with engine.connect() as connection:
            row = connection.execute(text(f"SHOW CREATE TABLE {quoted_object}")).fetchone()
            return _db_text(row[0]).strip() if row and row[0] is not None else ""

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = (database_name or engine.url.username or "SYSDBA").upper()
        object_upper = object_name.upper()
        dm_object_types = {
            "table": "TABLE",
            "view": "VIEW",
            "trigger": "TRIGGER",
            "procedure": "PROCEDURE",
            "function": "FUNCTION",
        }
        object_kind = dm_object_types.get(object_type)
        if not object_kind:
            raise ValueError("当前对象类型不支持查看 DDL")

        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT DBMS_METADATA.GET_DDL(:type, :name, :schema) FROM DUAL"),
                {"type": object_kind, "name": object_upper, "schema": schema_name},
            ).fetchone()
            return _db_text(row[0]).strip() if row and row[0] is not None else ""

    if _is_oracle_engine(engine):
        schema_name = (database_name or engine.url.username or "").upper()
        object_upper = object_name.upper()
        oracle_object_types = {
            "table": "TABLE",
            "view": "VIEW",
            "trigger": "TRIGGER",
            "procedure": "PROCEDURE",
            "function": "FUNCTION",
            "sequence": "SEQUENCE",
            "index": "INDEX",
        }
        object_kind = oracle_object_types.get(object_type)
        if not object_kind:
            raise ValueError("当前对象类型不支持查看 DDL")

        if object_type == "table":
            return _build_oracle_table_ddl(engine, object_upper, schema_name)

        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT DBMS_METADATA.GET_DDL(:type, :name, :schema) FROM DUAL"),
                {"type": object_kind, "name": object_upper, "schema": schema_name},
            ).fetchone()
            return _db_text(row[0]).strip() if row and row[0] is not None else ""

    if engine.dialect.name == "sqlite":
        sqlite_type = "table" if object_type == "table" else object_type
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT sql FROM sqlite_master WHERE type = :type AND name = :name"),
                {"type": sqlite_type, "name": object_name},
            ).fetchone()
            return row[0] if row and row[0] else ""

    raise ValueError("当前数据库类型不支持查看 DDL")


def drop_db_object(engine: Engine, object_name: str, object_type: str, database_name: str | None = None, pg_database: str | None = None) -> None:
    if is_mongo_client(engine):
        if object_type != "table":
            raise ValueError("MongoDB 当前仅支持删除集合")
        target_db = database_name or mongo_default_database(engine)
        if not target_db:
            raise ValueError("请选择 MongoDB 数据库")
        engine[target_db].drop_collection(object_name)
        return

    if is_redis_client(engine):
        if object_type != "table":
            raise ValueError("Redis 当前仅支持删除 Key")
        target = redis_client_for_database(engine, database_name)
        try:
            target.delete(object_name)
        finally:
            if target is not engine:
                target.close()
        return

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            drop_db_object(db_engine, object_name, object_type, database_name, None)
        finally:
            if db_engine is not engine:
                db_engine.dispose()
        return

    if object_type not in {"table", "view"}:
        raise ValueError("当前仅支持删除表和视图")

    preparer = engine.dialect.identifier_preparer
    quoted_object = _quote_table(preparer, object_name, database_name)
    keyword = "TABLE" if object_type == "table" else "VIEW"

    with engine.begin() as connection:
        connection.execute(text(f"DROP {keyword} {quoted_object}"))


def create_table(engine: Engine, request: Any) -> None:
    table_name = request.name.strip()
    if not table_name:
        raise ValueError("表名不能为空")

    if is_mongo_client(engine):
        target_db = request.database or mongo_default_database(engine)
        if not target_db:
            raise ValueError("请选择 MongoDB 数据库")
        engine[target_db].create_collection(table_name)
        return

    if is_redis_client(engine):
        raise ValueError("Redis 不支持创建表")

    if request.pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, request.pg_database)
        try:
            if hasattr(request, "model_copy"):
                shadow_request = request.model_copy(deep=True, update={"pg_database": None})
            else:
                shadow_request = type("TableCreateShadow", (), dict(vars(request)))()
                shadow_request.pg_database = None
            create_table(db_engine, shadow_request)
        finally:
            if db_engine is not engine:
                db_engine.dispose()
        return

    if not _is_clickhouse_engine(engine):
        _validate_table_columns(request.columns, engine.dialect.name)

    statements = _build_create_table_statements(
        engine,
        table_name,
        request.columns,
        request.database,
        _clean_optional_text(request.table_comment),
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def update_table_columns(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    pg_database: str | None = None,
    table_comment: str | None = None,
) -> None:
    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            update_table_columns(db_engine, table_name, next_columns, database_name, None, table_comment)
        finally:
            if db_engine is not engine:
                db_engine.dispose()
        return

    _validate_update_columns_v2(engine, table_name, next_columns, database_name)

    if engine.dialect.name == "sqlite":
        _update_sqlite_table_columns_v2(engine, table_name, next_columns)
        return

    if engine.dialect.name == "mysql":
        _update_mysql_table_columns_v2(engine, table_name, next_columns, database_name, table_comment)
        return

    if engine.dialect.name in {"postgresql", "gaussdb"}:
        _update_postgresql_table_columns_v2(engine, table_name, next_columns, database_name, table_comment)
        return

    if _is_oracle_engine(engine):
        _update_oracle_table_columns_v2(engine, table_name, next_columns, database_name, table_comment)
        return

    raise ValueError(f"当前不支持修改 {engine.dialect.name} 表结构")


def apply_table_data_changes(engine: Engine, table_name: str, changes: TableDataChangeRequest, database_name: str | None = None, pg_database: str | None = None) -> None:
    if is_mongo_client(engine):
        raise ValueError("MongoDB 当前暂不支持在表格中直接编辑文档")

    if is_redis_client(engine):
        raise ValueError("Redis 请使用 Redis 浏览页编辑 Key")

    if pg_database and engine.dialect.name in {"postgresql", "gaussdb"}:
        db_engine = _pg_engine(engine, pg_database)
        try:
            apply_table_data_changes(db_engine, table_name, changes, database_name, None)
        finally:
            if db_engine is not engine:
                db_engine.dispose()
        return

    columns = list_columns(engine, table_name, database_name, pg_database)
    column_names = {column.name for column in columns}
    primary_keys = [column.name for column in columns if column.primary_key]

    if not primary_keys:
        raise ValueError("当前只支持编辑有主键的表数据")

    preparer = engine.dialect.identifier_preparer
    quoted_table = _quote_table(preparer, table_name, database_name)

    with engine.begin() as connection:
        for row in changes.deleted:
            where_sql, params = _primary_key_where(primary_keys, row, "delete", preparer)
            connection.execute(text(f"DELETE FROM {quoted_table} WHERE {where_sql}"), params)

        for row in changes.updated:
            values = _filter_known_values(row.values, column_names)
            set_columns = [column for column in values if column not in primary_keys]
            if not set_columns:
                continue

            where_sql, params = _primary_key_where(primary_keys, row.original, "update", preparer)
            set_clauses: list[str] = []
            for column in set_columns:
                if _is_default_value_marker(values[column]):
                    set_clauses.append(f"{preparer.quote(column)} = DEFAULT")
                    continue
                set_clauses.append(f"{preparer.quote(column)} = :set_{column}")
                params[f"set_{column}"] = values[column]
            set_sql = ", ".join(set_clauses)
            connection.execute(text(f"UPDATE {quoted_table} SET {set_sql} WHERE {where_sql}"), params)

        for row in changes.inserted:
            values = _filter_known_values(row, column_names)
            if not values:
                continue

            insert_columns = list(values.keys())
            columns_sql = ", ".join(preparer.quote(column) for column in insert_columns)
            insert_values_sql: list[str] = []
            params: dict[str, Any] = {}
            for column in insert_columns:
                if _is_default_value_marker(values[column]):
                    insert_values_sql.append("DEFAULT")
                    continue
                insert_values_sql.append(f":insert_{column}")
                params[f"insert_{column}"] = values[column]
            values_sql = ", ".join(insert_values_sql)
            connection.execute(text(f"INSERT INTO {quoted_table} ({columns_sql}) VALUES ({values_sql})"), params)


def apply_redis_data_changes(engine: Engine, changes: RedisDataChangeRequest, database_name: str | None = None) -> None:
    if not is_redis_client(engine):
        raise ValueError("当前连接不是 Redis")

    target = redis_client_for_database(engine, database_name)
    try:
        for key in changes.deleted:
            if key:
                target.delete(key)

        for item in changes.updated:
            _apply_redis_key_update(target, item, True)

        for item in changes.inserted:
            _apply_redis_key_update(target, item, False)
    finally:
        if target is not engine:
            target.close()


def _apply_redis_key_update(target: Any, item: RedisKeyUpdate, replace_existing: bool) -> None:
    key = item.key.strip()
    if not key:
        raise ValueError("Redis Key 不能为空")

    key_type = item.type.strip().lower()
    if key_type not in {"string", "hash", "list", "set", "zset"}:
        raise ValueError("Redis 当前支持编辑 string、hash、list、set、zset 类型")

    original_key = item.original_key.strip() if item.original_key else key
    if replace_existing and original_key != key:
        target.delete(original_key)

    target.delete(key)
    _write_redis_key_value(target, key, key_type, item.value)
    if item.ttl is not None and item.ttl > 0:
        target.expire(key, item.ttl)


def _write_redis_key_value(target: Any, key: str, key_type: str, value: Any) -> None:
    if key_type == "string":
        target.set(key, "" if value is None else _redis_scalar(value))
        return

    if key_type == "hash":
        mapping = _redis_hash_mapping(value)
        if not mapping:
            raise ValueError("Redis hash 至少需要一个 field")
        target.hset(key, mapping=mapping)
        return

    if key_type == "list":
        values = [_redis_scalar(item) for item in _redis_list(value)]
        if not values:
            raise ValueError("Redis list 至少需要一个元素")
        target.rpush(key, *values)
        return

    if key_type == "set":
        values = [_redis_scalar(item) for item in _redis_list(value)]
        if not values:
            raise ValueError("Redis set 至少需要一个成员")
        target.sadd(key, *values)
        return

    values = _redis_zset_mapping(value)
    if not values:
        raise ValueError("Redis zset 至少需要一个成员")
    target.zadd(key, values)


def _redis_scalar(value: Any) -> str:
    serialized = serialize_redis_value(value)
    if isinstance(serialized, (dict, list)):
        return json.dumps(serialized, ensure_ascii=False)
    return "" if serialized is None else str(serialized)


def _redis_list(value: Any) -> list[Any]:
    parsed = _parse_redis_json(value)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, tuple) or isinstance(parsed, set):
        return list(parsed)
    if parsed is None or parsed == "":
        return []
    return [parsed]


def _redis_hash_mapping(value: Any) -> dict[str, str]:
    parsed = _parse_redis_json(value)
    if not isinstance(parsed, dict):
        raise ValueError("Redis hash 的值必须是 JSON 对象")
    return {redis_text(key): _redis_scalar(item) for key, item in parsed.items()}


def _redis_zset_mapping(value: Any) -> dict[str, float]:
    parsed = _parse_redis_json(value)
    if isinstance(parsed, dict):
        return {redis_text(member): float(score) for member, score in parsed.items()}
    if isinstance(parsed, list):
        result = {}
        for item in parsed:
            if isinstance(item, dict):
                member = item.get("member")
                score = item.get("score")
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                member, score = item[0], item[1]
            else:
                raise ValueError("Redis zset 数组元素应包含 member 和 score")
            if member is None or score is None:
                raise ValueError("Redis zset 成员和分数不能为空")
            result[_redis_scalar(member)] = float(score)
        return result
    raise ValueError("Redis zset 的值必须是对象或数组")


def _parse_redis_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    stripped = value.strip()
    if not stripped:
        return ""

    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def _build_mysql_constraints_sql(columns: list[TableUpdateColumn], table_name: str, preparer) -> list[str]:
    constraints: list[str] = []
    primary_keys = [column.name.strip() for column in columns if column.primary_key]
    if primary_keys:
        constraints.append(f"PRIMARY KEY ({', '.join(preparer.quote(column) for column in primary_keys)})")
    for column in columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column.unique and not column.primary_key:
            constraints.append(f"CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})")
        if minimum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})")
    return constraints


def _build_postgresql_constraints_sql(columns: list[TableUpdateColumn], table_name: str, preparer) -> list[str]:
    constraints: list[str] = []
    primary_keys = [column.name.strip() for column in columns if column.primary_key]
    if primary_keys:
        constraints.append(f"PRIMARY KEY ({', '.join(preparer.quote(column) for column in primary_keys)})")
    for column in columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column.unique and not column.primary_key:
            constraints.append(f"CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})")
        if minimum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})")
    return constraints


def _build_oracle_constraints_sql(columns: list[TableUpdateColumn], table_name: str, preparer) -> list[str]:
    constraints: list[str] = []
    primary_keys = [column.name.strip() for column in columns if column.primary_key]
    if primary_keys:
        constraints.append(f"PRIMARY KEY ({', '.join(preparer.quote(column) for column in primary_keys)})")
    for column in columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column.unique and not column.primary_key:
            constraints.append(f"CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})")
        if minimum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            constraints.append(f"CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})")
    return constraints


def _build_sqlite_constraints_sql(columns: list[TableUpdateColumn], table_name: str, preparer) -> list[str]:
    constraints: list[str] = []
    primary_keys = [column.name.strip() for column in columns if column.primary_key and not column.auto_increment]
    if primary_keys:
        constraints.append(f"PRIMARY KEY ({', '.join(preparer.quote(column) for column in primary_keys)})")
    for column in columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column.unique and not column.primary_key:
            constraints.append(f"UNIQUE ({quoted_column})")
        if minimum is not None:
            constraints.append(f"CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            constraints.append(f"CHECK ({quoted_column} <= {maximum})")
    return constraints


def _build_create_table_statements(
    engine: Engine,
    table_name: str,
    columns: list[TableUpdateColumn],
    database_name: str | None,
    table_comment: str | None,
) -> list[str]:
    preparer = engine.dialect.identifier_preparer

    if _is_clickhouse_engine(engine):
        column_defs: list[str] = []
        for column in columns:
            column_name = column.name.strip()
            type_name = column.type.strip()
            if column.nullable and not type_name.startswith("Nullable("):
                type_name = f"Nullable({type_name})"
            column_defs.append(f"{preparer.quote(column_name)} {type_name}")
        quoted_table = _quote_table(preparer, table_name, database_name or engine.url.database or "default")
        body = ",\n  ".join(column_defs)
        return [f"CREATE TABLE {quoted_table} (\n  {body}\n)\nENGINE = MergeTree\nORDER BY tuple();"]

    if engine.dialect.name in {"dm", "dmPython"}:
        quoted_table = _quote_table(preparer, table_name, database_name)
        column_defs = [_dm_or_basic_column_definition(column, preparer) for column in columns]
        primary_keys = [preparer.quote(column.name.strip()) for column in columns if column.primary_key]
        if primary_keys:
            column_defs.append(f"PRIMARY KEY ({', '.join(primary_keys)})")
        body = ",\n  ".join(column_defs)
        return [f"CREATE TABLE {quoted_table} (\n  {body}\n)"]

    if engine.dialect.name == "mysql":
        quoted_table = _quote_table(preparer, table_name, database_name)
        column_defs = [_mysql_column_definition(column, preparer) for column in columns]
        column_defs.extend(_build_mysql_constraints_sql(columns, table_name, preparer))
        body = ",\n  ".join(column_defs)
        suffix = f" COMMENT = {_sql_string(table_comment)}" if table_comment else ""
        return [f"CREATE TABLE {quoted_table} (\n  {body}\n){suffix};"]

    if engine.dialect.name in {"postgresql", "gaussdb"}:
        schema_name = database_name or "public"
        quoted_table = _quote_table(preparer, table_name, schema_name)
        column_defs = [_postgresql_column_definition(engine, column, preparer) for column in columns]
        column_defs.extend(_build_postgresql_constraints_sql(columns, table_name, preparer))
        body = ",\n  ".join(column_defs)
        statements = [f"CREATE TABLE {quoted_table} (\n  {body}\n);"]
        if table_comment:
            statements.append(f"COMMENT ON TABLE {quoted_table} IS {_sql_string(table_comment)};")
        for column in columns:
            comment = _column_comment_sql(column)
            if comment:
                statements.append(f"COMMENT ON COLUMN {quoted_table}.{preparer.quote(column.name.strip())} IS {_sql_string(comment)};")
        return statements

    if _is_oracle_engine(engine):
        schema_name = database_name or (engine.url.username or "").upper()
        quoted_table = _quote_table(preparer, table_name, schema_name)
        column_defs = [_oracle_column_definition(column, preparer) for column in columns]
        column_defs.extend(_build_oracle_constraints_sql(columns, table_name, preparer))
        body = ",\n  ".join(column_defs)
        statements = [f"CREATE TABLE {quoted_table} (\n  {body}\n)"]
        if table_comment:
            statements.append(f"COMMENT ON TABLE {quoted_table} IS {_sql_string(table_comment)}")
        for column in columns:
            comment = _column_comment_sql(column)
            if comment:
                statements.append(f"COMMENT ON COLUMN {quoted_table}.{preparer.quote(column.name.strip())} IS {_sql_string(comment)}")
        return statements

    if engine.dialect.name == "sqlite":
        quoted_table = _quote_table(preparer, table_name, database_name)
        column_defs = [_sqlite_column_definition(column, preparer) for column in columns]
        column_defs.extend(_build_sqlite_constraints_sql(columns, table_name, preparer))
        body = ",\n  ".join(column_defs)
        return [f"CREATE TABLE {quoted_table} (\n  {body}\n);"]

    raise ValueError(f"当前不支持创建 {engine.dialect.name} 表")


def build_mysql_update_statements(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> list[str]:
    current_columns = list_columns(engine, table_name, database_name)
    current_column_map = {column.name: column for column in current_columns}
    current_primary_keys = {column.name for column in current_columns if column.primary_key}
    next_primary_keys = {column.name.strip() for column in next_columns if column.primary_key}
    current_unique = _mysql_single_column_unique_indexes(engine, table_name, database_name)
    next_unique = {column.name.strip() for column in next_columns if column.unique and not column.primary_key}
    preparer = engine.dialect.identifier_preparer
    quoted_table = _quote_table(preparer, table_name, database_name)
    statements: list[str] = []

    for column_name, index_name in current_unique.items():
        if column_name not in next_unique:
            statements.append(f"ALTER TABLE {quoted_table} DROP INDEX {preparer.quote(index_name)}")

    if current_primary_keys != next_primary_keys and current_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} DROP PRIMARY KEY")

    for column in next_columns:
        column_name = column.name.strip()
        current = current_column_map[column_name]
        if current.minimum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CHECK {preparer.quote(_min_constraint_name(table_name, column_name))}")
        if current.maximum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CHECK {preparer.quote(_max_constraint_name(table_name, column_name))}")
        statements.append(f"ALTER TABLE {quoted_table} MODIFY COLUMN {_mysql_column_definition(column, preparer)}")

    if current_primary_keys != next_primary_keys and next_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} ADD PRIMARY KEY ({', '.join(preparer.quote(column) for column in next_primary_keys)})")

    for column in next_columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column_name in next_unique and column_name not in current_unique:
            statements.append(
                f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})"
            )
        if minimum is not None:
            statements.append(
                f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})"
            )
        if maximum is not None:
            statements.append(
                f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})"
            )

    if table_comment is not None:
        statements.append(f"ALTER TABLE {quoted_table} COMMENT = {_sql_string(_clean_optional_text(table_comment) or '')}")

    return statements


def _filter_known_values(row: dict, column_names: set[str]) -> dict:
    return {key: value for key, value in row.items() if key in column_names}


def _primary_key_where(primary_keys: list[str], row: dict, prefix: str, preparer) -> tuple[str, dict]:
    params = {}
    clauses = []

    for primary_key in primary_keys:
        if primary_key not in row:
            raise ValueError(f"缺少主键字段 {primary_key}")

        param_name = f"{prefix}_pk_{primary_key}"
        clauses.append(f"{preparer.quote(primary_key)} = :{param_name}")
        params[param_name] = row[primary_key]

    return " AND ".join(clauses), params


def _validate_update_columns_v2(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn], database_name: str | None = None) -> None:
    current_columns = list_columns(engine, table_name, database_name)
    current_names = [column.name for column in current_columns]
    next_names = [column.name.strip() for column in next_columns]

    if current_names != next_names:
        raise ValueError("当前只支持修改已有字段属性，不支持新增、删除或重命名字段")

    _validate_table_columns(next_columns, engine.dialect.name)


def _update_sqlite_table_columns_v2(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn]) -> None:
    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(table_name)
    temp_table = f"__datadjinn_tmp_{table_name}"
    quoted_temp_table = preparer.quote(temp_table)
    quoted_columns = [preparer.quote(column.name.strip()) for column in next_columns]
    column_definitions = [_sqlite_column_definition(column, preparer) for column in next_columns]
    column_definitions.extend(_build_sqlite_constraints_sql(next_columns, table_name, preparer))

    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {quoted_temp_table}"))
        connection.execute(text(f"CREATE TABLE {quoted_temp_table} ({', '.join(column_definitions)})"))
        connection.execute(text(f"INSERT INTO {quoted_temp_table} ({', '.join(quoted_columns)}) SELECT {', '.join(quoted_columns)} FROM {quoted_table}"))
        connection.execute(text(f"DROP TABLE {quoted_table}"))
        connection.execute(text(f"ALTER TABLE {quoted_temp_table} RENAME TO {preparer.quote(table_name)}"))


def _update_mysql_table_columns_v2(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> None:
    statements = build_mysql_update_statements(engine, table_name, next_columns, database_name, table_comment)
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _pg_primary_key_constraint_name(engine: Engine, table_name: str, schema_name: str) -> str | None:
    inspector = inspect(engine)
    constraint = inspector.get_pk_constraint(table_name, schema=schema_name)
    return constraint.get("name")


def _oracle_primary_key_constraint_name(engine: Engine, table_name: str, schema_name: str) -> str | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS "
                "WHERE OWNER = :schema_name AND TABLE_NAME = :table_name AND CONSTRAINT_TYPE = 'P'"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchone()
    return str(row[0]) if row and row[0] is not None else None


def _pg_sequence_name(engine: Engine, table_name: str, column_name: str, schema_name: str) -> str | None:
    with engine.connect() as connection:
        try:
            row = connection.execute(
                text(
                    "SELECT pg_get_serial_sequence(quote_ident(:schema_name) || '.' || quote_ident(:table_name), :column_name)"
                ),
                {"schema_name": schema_name, "table_name": table_name, "column_name": column_name},
            ).fetchone()
        except Exception:
            return None
    return str(row[0]) if row and row[0] is not None else None


def _pg_table_constraints(engine: Engine, table_name: str, schema_name: str) -> list[tuple[str, str, str]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT c.conname, c.contype, pg_get_constraintdef(c.oid, true) "
                "FROM pg_constraint c "
                "JOIN pg_class t ON t.oid = c.conrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "WHERE n.nspname = :schema_name AND t.relname = :table_name "
                "AND c.contype IN ('p', 'u', 'f', 'c') "
                "ORDER BY CASE c.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'f' THEN 2 ELSE 3 END, c.conname"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()
    return [
        (str(row[0]), str(row[1]), _db_text(row[2]).strip())
        for row in rows
        if row[0] is not None and row[1] is not None and row[2] is not None
    ]


def _pg_non_constraint_indexes(engine: Engine, table_name: str, schema_name: str) -> list[str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT pg_get_indexdef(i.indexrelid) "
                "FROM pg_index i "
                "JOIN pg_class t ON t.oid = i.indrelid "
                "JOIN pg_namespace n ON n.oid = t.relnamespace "
                "JOIN pg_class idx ON idx.oid = i.indexrelid "
                "WHERE n.nspname = :schema_name AND t.relname = :table_name "
                "AND NOT i.indisprimary "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM pg_constraint c "
                "  WHERE c.conrelid = i.indrelid AND c.conindid = i.indexrelid AND c.contype IN ('p', 'u')"
                ") "
                "ORDER BY idx.relname"
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).fetchall()
    return [_db_text(row[0]).strip() for row in rows if row and row[0] is not None]


def _build_pg_table_ddl(engine: Engine, table_name: str, schema_name: str) -> str:
    preparer = engine.dialect.identifier_preparer
    quoted_table = f"{preparer.quote(schema_name)}.{preparer.quote(table_name)}"
    columns = list_columns(engine, table_name, schema_name)
    if not columns:
        return ""

    constraint_lines = [
        f"  CONSTRAINT {preparer.quote(constraint_name)} {definition}"
        for constraint_name, _constraint_type, definition in _pg_table_constraints(engine, table_name, schema_name)
        if definition
    ]

    column_lines: list[str] = []
    for column in columns:
        line = f"  {preparer.quote(column.name)} {column.type}"
        if column.default_value:
            line += f" DEFAULT {column.default_value}"
        if not column.nullable:
            line += " NOT NULL"
        column_lines.append(line)

    body = ",\n".join([*column_lines, *constraint_lines])
    statements = [f"CREATE TABLE {quoted_table} (\n{body}\n);"]

    for index_ddl in _pg_non_constraint_indexes(engine, table_name, schema_name):
        if index_ddl:
            statements.append(f"{index_ddl};")

    table_comment = get_table_comment(engine, table_name, schema_name)
    if table_comment:
        statements.append(f"COMMENT ON TABLE {quoted_table} IS {_sql_string(table_comment)};")

    for column in columns:
        comment = _clean_optional_text(column.comment)
        if comment:
            statements.append(
                f"COMMENT ON COLUMN {quoted_table}.{preparer.quote(column.name)} IS {_sql_string(comment)};"
            )

    return "\n\n".join(statements)


def _build_oracle_table_ddl(engine: Engine, table_name: str, schema_name: str) -> str:
    preparer = engine.dialect.identifier_preparer
    quoted_table = f"{preparer.quote(schema_name)}.{preparer.quote(table_name)}"

    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT DBMS_METADATA.GET_DDL('TABLE', :name, :schema) FROM DUAL"),
            {"name": table_name, "schema": schema_name},
        ).fetchone()

    table_ddl = _db_text(row[0]).strip() if row and row[0] is not None else ""
    if not table_ddl:
        return ""

    statements = [table_ddl]
    table_comment = get_table_comment(engine, table_name, schema_name)
    if table_comment:
        statements.append(f"COMMENT ON TABLE {quoted_table} IS {_sql_string(table_comment)};")

    for column in list_columns(engine, table_name, schema_name):
        comment = _clean_optional_text(column.comment)
        if comment:
            statements.append(
                f"COMMENT ON COLUMN {quoted_table}.{preparer.quote(column.name)} IS {_sql_string(comment)};"
            )

    return "\n\n".join(statements)


def _build_postgresql_update_statements_v2(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> list[str]:
    schema_name = database_name or "public"
    preparer = engine.dialect.identifier_preparer
    quoted_table = _quote_table(preparer, table_name, schema_name)
    current_columns = list_columns(engine, table_name, schema_name)
    current_column_map = {column.name: column for column in current_columns}
    current_unique = _pg_single_column_unique_constraints(engine, table_name, schema_name)
    next_unique = {column.name.strip() for column in next_columns if column.unique and not column.primary_key}
    current_primary_keys = {column.name for column in current_columns if column.primary_key}
    next_primary_keys = {column.name.strip() for column in next_columns if column.primary_key}
    pk_name = _pg_primary_key_constraint_name(engine, table_name, schema_name)
    statements: list[str] = []

    if pk_name and current_primary_keys != next_primary_keys and current_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(pk_name)}")

    for column_name, constraint_name in current_unique.items():
        if column_name not in next_unique:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(constraint_name)}")

    for column in next_columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        current = current_column_map[column_name]

        if current.minimum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT IF EXISTS {preparer.quote(_min_constraint_name(table_name, column_name))}")
        if current.maximum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT IF EXISTS {preparer.quote(_max_constraint_name(table_name, column_name))}")

        statements.append(f"ALTER TABLE {quoted_table} ALTER COLUMN {quoted_column} TYPE {column.type.strip()}")
        statements.append(
            f"ALTER TABLE {quoted_table} ALTER COLUMN {quoted_column} {'DROP' if column.nullable and not column.primary_key else 'SET'} NOT NULL"
        )

        if engine.dialect.name == "gaussdb" and current.auto_increment != column.auto_increment:
            raise ValueError("高斯数据库当前暂不支持修改已有字段的自增属性，请通过新建表时配置自增")
        if current.auto_increment and not column.auto_increment:
            statements.append(f"ALTER TABLE {quoted_table} ALTER COLUMN {quoted_column} DROP IDENTITY IF EXISTS")
        elif not current.auto_increment and column.auto_increment:
            identity_options = _postgresql_identity_options(engine, column.auto_increment_step)
            statements.append(f"ALTER TABLE {quoted_table} ALTER COLUMN {quoted_column} ADD GENERATED BY DEFAULT AS IDENTITY{identity_options}")
        elif current.auto_increment and column.auto_increment and column.auto_increment_step and current.auto_increment_step != column.auto_increment_step:
            sequence_name = _pg_sequence_name(engine, table_name, column_name, schema_name)
            if sequence_name:
                statements.append(f"ALTER SEQUENCE {sequence_name} INCREMENT BY {column.auto_increment_step}")

    if current_primary_keys != next_primary_keys and next_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} ADD PRIMARY KEY ({', '.join(preparer.quote(column) for column in next_primary_keys)})")

    for column in next_columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column_name in next_unique and column_name not in current_unique:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})")
        if minimum is not None:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})")
        comment = _column_comment_sql(column)
        statements.append(f"COMMENT ON COLUMN {quoted_table}.{quoted_column} IS {(_sql_string(comment) if comment else 'NULL')};")

    if table_comment is not None:
        clean_comment = _clean_optional_text(table_comment)
        statements.append(f"COMMENT ON TABLE {quoted_table} IS {(_sql_string(clean_comment) if clean_comment else 'NULL')};")

    return statements


def _update_postgresql_table_columns_v2(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> None:
    statements = _build_postgresql_update_statements_v2(engine, table_name, next_columns, database_name, table_comment)
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _build_oracle_update_statements_v2(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> list[str]:
    schema_name = (database_name or engine.url.username or "").upper()
    preparer = engine.dialect.identifier_preparer
    quoted_table = _quote_table(preparer, table_name, schema_name)
    current_columns = list_columns(engine, table_name, schema_name)
    current_column_map = {column.name: column for column in current_columns}
    current_unique = _oracle_single_column_unique_constraints(engine, table_name, schema_name)
    next_unique = {column.name.strip() for column in next_columns if column.unique and not column.primary_key}
    current_primary_keys = {column.name for column in current_columns if column.primary_key}
    next_primary_keys = {column.name.strip() for column in next_columns if column.primary_key}
    pk_name = _oracle_primary_key_constraint_name(engine, table_name, schema_name)
    statements: list[str] = []

    if pk_name and current_primary_keys != next_primary_keys and current_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(pk_name)}")

    for column_name, constraint_name in current_unique.items():
        if column_name not in next_unique:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(constraint_name)}")

    for column in next_columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        current = current_column_map[column_name]

        if current.minimum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))}")
        if current.maximum is not None:
            statements.append(f"ALTER TABLE {quoted_table} DROP CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))}")

        nullability = "NOT NULL" if (not column.nullable or column.primary_key) else "NULL"
        statements.append(f"ALTER TABLE {quoted_table} MODIFY ({quoted_column} {column.type.strip()} {nullability})")

        if current.auto_increment != column.auto_increment or (
            current.auto_increment and column.auto_increment and current.auto_increment_step != column.auto_increment_step
        ):
            raise ValueError("Oracle 当前暂不支持修改已有字段的自增属性，请通过新建表时配置")

    if current_primary_keys != next_primary_keys and next_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} ADD PRIMARY KEY ({', '.join(preparer.quote(column) for column in next_primary_keys)})")

    for column in next_columns:
        column_name = column.name.strip()
        quoted_column = preparer.quote(column_name)
        minimum = _column_minimum(column)
        maximum = _column_maximum(column)
        if column_name in next_unique and column_name not in current_unique:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_unique_constraint_name(table_name, column_name))} UNIQUE ({quoted_column})")
        if minimum is not None:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_min_constraint_name(table_name, column_name))} CHECK ({quoted_column} >= {minimum})")
        if maximum is not None:
            statements.append(f"ALTER TABLE {quoted_table} ADD CONSTRAINT {preparer.quote(_max_constraint_name(table_name, column_name))} CHECK ({quoted_column} <= {maximum})")
        comment = _column_comment_sql(column)
        comment_sql = _sql_string(comment) if comment else "''"
        statements.append(f"COMMENT ON COLUMN {quoted_table}.{quoted_column} IS {comment_sql}")

    if table_comment is not None:
        clean_comment = _clean_optional_text(table_comment)
        table_comment_sql = _sql_string(clean_comment) if clean_comment else "''"
        statements.append(f"COMMENT ON TABLE {quoted_table} IS {table_comment_sql}")

    return statements


def _update_oracle_table_columns_v2(
    engine: Engine,
    table_name: str,
    next_columns: list[TableUpdateColumn],
    database_name: str | None = None,
    table_comment: str | None = None,
) -> None:
    statements = _build_oracle_update_statements_v2(engine, table_name, next_columns, database_name, table_comment)
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _sqlite_column_definition(column: TableUpdateColumn, preparer) -> str:
    column_name = column.name.strip()
    if column.auto_increment:
        return f"{preparer.quote(column_name)} INTEGER PRIMARY KEY AUTOINCREMENT"

    parts = [preparer.quote(column_name), column.type.strip()]
    if not column.nullable and not column.primary_key:
        parts.append("NOT NULL")
    return " ".join(parts)


def _mysql_column_definition(column: TableUpdateColumn, preparer) -> str:
    parts = [preparer.quote(column.name.strip()), column.type.strip()]

    if not column.nullable or column.primary_key:
        parts.append("NOT NULL")
    else:
        parts.append("NULL")

    if column.auto_increment:
        parts.append("AUTO_INCREMENT")
    comment = _column_comment_sql(column)
    if comment:
        parts.append(f"COMMENT {_sql_string(comment)}")

    return " ".join(parts)


def _postgresql_identity_options(engine: Engine, step: int | None) -> str:
    if not step:
        return ""
    if engine.dialect.name == "gaussdb":
        return ""
    return f" (INCREMENT BY {step})"


def _postgresql_column_definition(engine: Engine, column: TableUpdateColumn, preparer) -> str:
    column_name = column.name.strip()
    type_name = column.type.strip()
    parts = [preparer.quote(column_name), type_name]
    if engine.dialect.name == "gaussdb" and column.auto_increment:
        serial_type = _gaussdb_serial_type(type_name)
        if serial_type is None:
            raise ValueError(f"高斯数据库字段 {column_name} 只有 smallint/integer/bigint 类型才能设置自增")
        parts = [preparer.quote(column_name), serial_type]
    elif column.auto_increment:
        options = _postgresql_identity_options(engine, column.auto_increment_step)
        parts.append(f"GENERATED BY DEFAULT AS IDENTITY{options}")
    if not column.nullable or column.primary_key:
        parts.append("NOT NULL")
    return " ".join(parts)


def _oracle_column_definition(column: TableUpdateColumn, preparer) -> str:
    column_name = column.name.strip()
    parts = [preparer.quote(column_name), column.type.strip()]
    if column.auto_increment:
        if column.auto_increment_step and column.auto_increment_step != 1:
            parts.append(f"GENERATED BY DEFAULT AS IDENTITY (INCREMENT BY {column.auto_increment_step})")
        else:
            parts.append("GENERATED BY DEFAULT AS IDENTITY")
    if not column.nullable or column.primary_key:
        parts.append("NOT NULL")
    return " ".join(parts)


def _dm_or_basic_column_definition(column: TableUpdateColumn, preparer) -> str:
    parts = [preparer.quote(column.name.strip()), column.type.strip()]
    if not column.nullable or column.primary_key:
        parts.append("NOT NULL")
    return " ".join(parts)



