import re

from sqlalchemy import Engine, inspect, text

from app.schemas.metadata import ColumnInfo, DatabaseInfo, TableDataChangeRequest, TableInfo, TableUpdateColumn

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
                name=row[0],
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
                name=row[0],
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
        return [
            DatabaseInfo(
                name=row[0],
                size_bytes=int(row[1] or 0),
                size_display=format_size(int(row[1] or 0)),
                storage_size_bytes=int(row[1] or 0),
                storage_size_display=format_size(int(row[1] or 0)),
            )
            for row in rows
        ]

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
                name=row[0],
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
    if engine.dialect.name == "postgresql":
        raise ValueError("PostgreSQL 新建数据库将在后续支持，请先通过外部工具创建")

    if engine.dialect.name != "mysql":
        raise ValueError("SQLite 请通过新增文件连接创建数据库")

    preparer = engine.dialect.identifier_preparer
    quoted = preparer.quote(database_name)

    with engine.begin() as connection:
        connection.execute(text(f"CREATE DATABASE {quoted}"))

    return DatabaseInfo(name=database_name)


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
                name=row[0],
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
                name=row[0],
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
                name=row[0],
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


def list_columns(engine: Engine, table_name: str, database_name: str | None = None, pg_database: str | None = None) -> list[ColumnInfo]:
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

        primary_keys = {row[0] for row in rows if row[3] == 1}

        return [
            ColumnInfo(
                name=row[0],
                type=str(row[1]),
                nullable=row[2] == "Y",
                primary_key=row[0] in primary_keys,
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
