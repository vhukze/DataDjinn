import json
import re

from typing import Any

from sqlalchemy import Engine, inspect, text

from app.db.mongo_utils import is_mongo_client, mongo_default_database, mongo_value_type
from app.db.redis_utils import is_redis_client, parse_redis_database_name, redis_client_for_database, redis_current_database, redis_database_name, redis_key_length, redis_key_type, redis_memory_usage, redis_scan_keys, redis_text, serialize_redis_value
from app.schemas.metadata import ColumnInfo, DatabaseInfo, DbObjectInfo, RedisDataChangeRequest, RedisKeyUpdate, TableDataChangeRequest, TableInfo, TableUpdateColumn

COLUMN_TYPE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_ (),]*$")

PG_SYSTEM_SCHEMAS = {"pg_catalog", "information_schema"}
DM_SYSTEM_SCHEMAS = {"SYS", "SYSDBA", "SYSAUDITOR", "SYSSSO", "CTISYS"}


def format_size(size_bytes: int | None) -> str | None:
    if size_bytes is None:
        return None

    value = float(size_bytes)
    for unit in ["B", "K", "M", "G"]:
        if value < 1024 or unit == "G":
            return f"{value:.1f}{unit}" if unit != "B" else f"{int(value)}B"
        value /= 1024

    return f"{value:.1f}G"


def _pg_engine(engine: Engine, database_name: str) -> Engine:
    if engine.dialect.name != "postgresql":
        return engine

    if engine.url.database == database_name:
        return engine

    from sqlalchemy import create_engine

    return create_engine(engine.url.set(database=database_name), pool_pre_ping=True)


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

    if engine.dialect.name == "postgresql":
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

    if engine.dialect.name in {"dm", "dmPython"}:
        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT u.USERNAME, COALESCE(SUM(s.BYTES), 0) AS SIZE_BYTES "
                    "FROM ALL_USERS u "
                    "LEFT JOIN DBA_SEGMENTS s ON s.OWNER = u.USERNAME "
                    "WHERE u.USERNAME = USER OR u.USERNAME IN (SELECT DISTINCT OWNER FROM ALL_TABLES) "
                    "GROUP BY u.USERNAME "
                    "ORDER BY CASE WHEN u.USERNAME = USER THEN 0 ELSE 1 END, u.USERNAME"
                )
            ).fetchall()
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
            str(row[0]): DatabaseInfo(
                name=str(row[0]),
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[1] or 0),
                storage_size_display=format_size(int(row[1] or 0)),
            )
            for row in rows
        }
        for row in schema_rows:
            schema_name = str(row[0])
            if schema_name not in database_map:
                database_map[schema_name] = DatabaseInfo(name=schema_name)
        return list(database_map.values())

    return [DatabaseInfo(name="main")]


def list_schemas(engine: Engine, database_name: str | None = None) -> list[DatabaseInfo]:
    if engine.dialect.name != "postgresql":
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

    if engine.dialect.name not in {"mysql", "postgresql"}:
        raise ValueError("SQLite 请通过新增文件连接创建数据库")

    preparer = engine.dialect.identifier_preparer
    quoted = preparer.quote(database_name)

    if engine.dialect.name == "postgresql":
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))
    else:
        with engine.begin() as connection:
            connection.execute(text(f"CREATE DATABASE {quoted}"))

    return DatabaseInfo(name=str(database_name))


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

    if engine.dialect.name == "postgresql":
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f"DROP DATABASE {engine.dialect.identifier_preparer.quote(database_name)}"))
        return

    if engine.dialect.name == "mysql":
        with engine.begin() as connection:
            connection.execute(text(f"DROP DATABASE {engine.dialect.identifier_preparer.quote(database_name)}"))
        return

    raise ValueError("当前数据库类型不支持删除数据库")


def create_schema(engine: Engine, database_name: str, schema_name: str) -> DatabaseInfo:
    if engine.dialect.name != "postgresql":
        raise ValueError("仅 PostgreSQL 支持新建模式")

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

    if pg_database and engine.dialect.name == "postgresql":
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

    if engine.dialect.name == "postgresql":
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

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = database_name or engine.url.username.upper() or "SYSDBA"

        with engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT t.TABLE_NAME, COALESCE(t.NUM_ROWS, 0) AS ROW_COUNT, COALESCE(SUM(s.BYTES), 0) AS STORAGE_SIZE_BYTES "
                    "FROM ALL_TABLES t LEFT JOIN DBA_SEGMENTS s ON s.OWNER = t.OWNER AND s.SEGMENT_NAME = t.TABLE_NAME "
                    "WHERE t.OWNER = :schema_name GROUP BY t.TABLE_NAME, t.NUM_ROWS ORDER BY t.TABLE_NAME"
                ),
                {"schema_name": schema_name},
            ).fetchall()

        return [
            TableInfo(
                name=str(row[0]),
                row_count=int(row[1] or 0),
                size_bytes=0 if int(row[1] or 0) == 0 else int(row[2] or 0),
                size_display=format_size(0 if int(row[1] or 0) == 0 else int(row[2] or 0)),
                storage_size_bytes=int(row[2] or 0),
                storage_size_display=format_size(int(row[2] or 0)),
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

    if pg_database and engine.dialect.name == "postgresql":
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

    if engine.dialect.name == "postgresql":
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

    if pg_database and engine.dialect.name == "postgresql":
        engine = _pg_engine(engine, pg_database)

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

    inspector = inspect(engine)
    primary_keys = set(inspector.get_pk_constraint(table_name, schema=database_name).get("constrained_columns") or [])

    return [
        ColumnInfo(
            name=column["name"],
            type=str(column["type"]),
            nullable=bool(column.get("nullable", True)),
            primary_key=column["name"] in primary_keys,
        )
        for column in inspector.get_columns(table_name, schema=database_name)
    ]


def get_object_ddl(engine: Engine, object_name: str, object_type: str, database_name: str | None = None, pg_database: str | None = None) -> str:
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

    if pg_database and engine.dialect.name == "postgresql":
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

    if engine.dialect.name == "postgresql":
        schema_name = database_name or "public"
        with engine.connect() as connection:
            if object_type in {"table", "view"}:
                if object_type == "view":
                    row = connection.execute(text("SELECT pg_get_viewdef(format('%I.%I', :schema, :name)::regclass, true)"), {"schema": schema_name, "name": object_name}).fetchone()
                    body = row[0] if row else ""
                    return f"CREATE OR REPLACE VIEW {preparer.quote(schema_name)}.{preparer.quote(object_name)} AS\n{body};" if body else ""
                columns = connection.execute(
                    text(
                        "SELECT column_name, data_type, is_nullable, column_default "
                        "FROM information_schema.columns WHERE table_schema = :schema AND table_name = :name ORDER BY ordinal_position"
                    ),
                    {"schema": schema_name, "name": object_name},
                ).fetchall()
                column_defs = []
                for column in columns:
                    column_def = f"  {preparer.quote(column[0])} {column[1]}"
                    if column[3] is not None:
                        column_def += f" DEFAULT {column[3]}"
                    if column[2] == "NO":
                        column_def += " NOT NULL"
                    column_defs.append(column_def)
                if not column_defs:
                    return ""
                return f"CREATE TABLE {preparer.quote(schema_name)}.{preparer.quote(object_name)} (\n{',\n'.join(column_defs)}\n);"
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
            if object_type == "sequence":
                return f"CREATE SEQUENCE {preparer.quote(schema_name)}.{preparer.quote(object_name)};"
            if object_type == "index":
                row = connection.execute(text("SELECT indexdef FROM pg_indexes WHERE schemaname = :schema AND indexname = :name"), {"schema": schema_name, "name": object_name}).fetchone()
                return row[0] if row else ""
        raise ValueError("当前对象类型不支持查看 DDL")

    if engine.dialect.name in {"dm", "dmPython"}:
        schema_name = (database_name or engine.url.username or "SYSDBA").upper()
        object_upper = object_name.upper()
        with engine.connect() as connection:
            if object_type in {"table", "view", "procedure", "function"}:
                object_kind = object_type.upper()
                row = connection.execute(text("SELECT DBMS_METADATA.GET_DDL(:type, :name, :schema) FROM DUAL"), {"type": object_kind, "name": object_upper, "schema": schema_name}).fetchone()
                return str(row[0]) if row and row[0] is not None else ""
        raise ValueError("当前对象类型不支持查看 DDL")

    if engine.dialect.name == "sqlite":
        sqlite_type = "table" if object_type == "table" else object_type
        with engine.connect() as connection:
            row = connection.execute(text("SELECT sql FROM sqlite_master WHERE type = :type AND name = :name"), {"type": sqlite_type, "name": object_name}).fetchone()
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

    if pg_database and engine.dialect.name == "postgresql":
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


def update_table_columns(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn], database_name: str | None = None) -> None:
    _validate_update_columns(engine, table_name, next_columns, database_name)

    if engine.dialect.name == "sqlite":
        _update_sqlite_table_columns(engine, table_name, next_columns)
        return

    if engine.dialect.name == "mysql":
        _update_mysql_table_columns(engine, table_name, next_columns, database_name)
        return

    raise ValueError(f"当前不支持修改 {engine.dialect.name} 表结构")


def apply_table_data_changes(engine: Engine, table_name: str, changes: TableDataChangeRequest, database_name: str | None = None, pg_database: str | None = None) -> None:
    if is_mongo_client(engine):
        raise ValueError("MongoDB 当前暂不支持在表格中直接编辑文档")

    if is_redis_client(engine):
        raise ValueError("Redis 请使用 Redis 浏览页编辑 Key")

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

            set_sql = ", ".join(f"{preparer.quote(column)} = :set_{column}" for column in set_columns)
            where_sql, params = _primary_key_where(primary_keys, row.original, "update", preparer)
            params.update({f"set_{column}": values[column] for column in set_columns})
            connection.execute(text(f"UPDATE {quoted_table} SET {set_sql} WHERE {where_sql}"), params)

        for row in changes.inserted:
            values = _filter_known_values(row, column_names)

            if not values:
                continue

            insert_columns = list(values.keys())
            columns_sql = ", ".join(preparer.quote(column) for column in insert_columns)
            values_sql = ", ".join(f":insert_{column}" for column in insert_columns)
            params = {f"insert_{column}": values[column] for column in insert_columns}
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


def build_mysql_update_statements(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn], database_name: str | None = None) -> list[str]:
    current_columns = list_columns(engine, table_name, database_name)
    current_primary_keys = {column.name for column in current_columns if column.primary_key}
    next_primary_keys = {column.name for column in next_columns if column.primary_key}
    preparer = engine.dialect.identifier_preparer
    quoted_table = _quote_table(preparer, table_name, database_name)
    statements: list[str] = []

    if current_primary_keys != next_primary_keys and current_primary_keys:
        statements.append(f"ALTER TABLE {quoted_table} DROP PRIMARY KEY")

    for column in next_columns:
        statements.append(f"ALTER TABLE {quoted_table} MODIFY COLUMN {_mysql_column_definition(column, preparer)}")

    if current_primary_keys != next_primary_keys and next_primary_keys:
        primary_key_columns = ", ".join(preparer.quote(column) for column in next_primary_keys)
        statements.append(f"ALTER TABLE {quoted_table} ADD PRIMARY KEY ({primary_key_columns})")

    return statements


def _quote_table(preparer, table_name: str, database_name: str | None = None) -> str:
    if database_name:
        return f"{preparer.quote(database_name)}.{preparer.quote(table_name)}"

    return preparer.quote(table_name)


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


def _validate_update_columns(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn], database_name: str | None = None) -> None:
    current_columns = list_columns(engine, table_name, database_name)
    current_names = [column.name for column in current_columns]
    next_names = [column.name for column in next_columns]

    if current_names != next_names:
        raise ValueError("当前只支持修改已有字段属性，不支持新增、删除或重命名字段")

    primary_key_columns = [column.name for column in next_columns if column.primary_key]
    if len(primary_key_columns) > 1:
        raise ValueError("当前只支持单字段主键")

    for column in next_columns:
        if not COLUMN_TYPE_PATTERN.fullmatch(column.type.strip()):
            raise ValueError(f"字段 {column.name} 的类型不合法")


def _update_sqlite_table_columns(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn]) -> None:
    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(table_name)
    temp_table = f"__datadjinn_tmp_{table_name}"
    quoted_temp_table = preparer.quote(temp_table)
    quoted_columns = [preparer.quote(column.name) for column in next_columns]
    column_definitions = [_sqlite_column_definition(column, preparer) for column in next_columns]

    with engine.begin() as connection:
        connection.execute(text(f"DROP TABLE IF EXISTS {quoted_temp_table}"))
        connection.execute(text(f"CREATE TABLE {quoted_temp_table} ({', '.join(column_definitions)})"))
        connection.execute(text(f"INSERT INTO {quoted_temp_table} ({', '.join(quoted_columns)}) SELECT {', '.join(quoted_columns)} FROM {quoted_table}"))
        connection.execute(text(f"DROP TABLE {quoted_table}"))
        connection.execute(text(f"ALTER TABLE {quoted_temp_table} RENAME TO {preparer.quote(table_name)}"))


def _update_mysql_table_columns(engine: Engine, table_name: str, next_columns: list[TableUpdateColumn], database_name: str | None = None) -> None:
    statements = build_mysql_update_statements(engine, table_name, next_columns, database_name)

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _sqlite_column_definition(column: TableUpdateColumn, preparer) -> str:
    parts = [preparer.quote(column.name), column.type.strip()]

    if column.primary_key:
        parts.append("PRIMARY KEY")

    if not column.nullable and not column.primary_key:
        parts.append("NOT NULL")

    return " ".join(parts)


def _mysql_column_definition(column: TableUpdateColumn, preparer) -> str:
    parts = [preparer.quote(column.name), column.type.strip()]

    if not column.nullable or column.primary_key:
        parts.append("NOT NULL")
    else:
        parts.append("NULL")

    return " ".join(parts)
