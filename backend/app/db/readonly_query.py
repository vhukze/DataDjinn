from typing import Any

import sqlparse
from sqlalchemy import Engine, quoted_name, text

from app.schemas.query import QueryResponse

READONLY_TYPES = {"SELECT", "WITH"}


def execute_readonly_query(engine: Engine, sql: str, limit: int, offset: int = 0, database: str | None = None, pg_database: str | None = None) -> QueryResponse:
    cleanup_engine = False

    if pg_database and engine.dialect.name == "postgresql":
        from sqlalchemy import create_engine

        engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
        cleanup_engine = True

    try:
        statement = _validate_readonly_sql(sql)

        if database and engine.dialect.name == "mysql":
            return _execute_on_connection_with_use(engine, statement, limit, offset, database)

        return _execute_limited_query(engine, statement, limit, offset)
    finally:
        if cleanup_engine:
            engine.dispose()


def _execute_on_connection_with_use(engine: Engine, sql: str, limit: int, offset: int, database: str) -> QueryResponse:
    limited_sql = _with_limit(engine, sql, limit + 1, offset)

    with engine.connect() as connection:
        preparer = engine.dialect.identifier_preparer
        connection.execute(text(f"USE {preparer.quote(database)}"))
        result = connection.execute(text(limited_sql))
        columns = list(result.keys())
        raw_rows = result.mappings().fetchall()

    limited = len(raw_rows) > limit
    visible_rows = raw_rows[:limit]
    rows = [dict(row) for row in visible_rows]

    return QueryResponse(columns=columns, rows=rows, row_count=len(rows), limited=limited)


def preview_table(engine: Engine, table_name: str, limit: int, offset: int = 0, database_name: str | None = None, pg_database: str | None = None) -> QueryResponse:
    if pg_database and engine.dialect.name == "postgresql":
        from sqlalchemy import create_engine

        engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
        try:
            return _preview_table_impl(engine, table_name, limit, offset, database_name)
        finally:
            engine.dispose()

    return _preview_table_impl(engine, table_name, limit, offset, database_name)


def _preview_table_impl(engine: Engine, table_name: str, limit: int, offset: int, database_name: str | None = None) -> QueryResponse:
    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(quoted_name(table_name, quote=True))

    if database_name:
        quoted_table = f"{preparer.quote(quoted_name(database_name, quote=True))}.{quoted_table}"

    return _execute_limited_query(engine, f"SELECT * FROM {quoted_table}", limit, offset)


def _execute_limited_query(engine: Engine, sql: str, limit: int, offset: int = 0) -> QueryResponse:
    limited_sql = _with_limit(engine, sql, limit + 1, offset)

    with engine.connect() as connection:
        result = connection.execute(text(limited_sql))
        columns = list(result.keys())
        raw_rows = result.mappings().fetchall()

    limited = len(raw_rows) > limit
    visible_rows = raw_rows[:limit]
    rows = [dict(row) for row in visible_rows]

    return QueryResponse(columns=columns, rows=rows, row_count=len(rows), limited=limited)


def _validate_readonly_sql(sql: str) -> str:
    statements = [statement for statement in sqlparse.parse(sql) if str(statement).strip()]

    if len(statements) != 1:
        raise ValueError("只允许执行单条 SQL")

    statement = statements[0]
    statement_type = statement.get_type().upper()

    if statement_type not in READONLY_TYPES:
        raise ValueError("只允许执行只读查询")

    return str(statement).strip().rstrip(";")


def _with_limit(engine: Engine, sql: str, limit: int, offset: int = 0) -> str:
    parsed = sqlparse.parse(sql)

    if parsed and any(token.normalized == "LIMIT" for token in parsed[0].flatten()):
        return sql

    if engine.dialect.name in {"dm", "dmPython"}:
        end_row = offset + limit
        return f"SELECT * FROM (SELECT inner_query.*, ROWNUM AS __DATADJINN_RN FROM ({sql}) inner_query WHERE ROWNUM <= {end_row}) WHERE __DATADJINN_RN > {offset}"

    return f"{sql} LIMIT {limit} OFFSET {offset}"
