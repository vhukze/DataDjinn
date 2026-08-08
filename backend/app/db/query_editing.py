from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlparse
from sqlalchemy import Engine, text
from sqlparse.sql import Function, Identifier, IdentifierList
from sqlparse.tokens import DML, Keyword, Whitespace, Wildcard

from app.db.metadata import list_columns
from app.db.mongo_utils import is_mongo_client
from app.db.redis_utils import is_redis_client
from app.schemas.query import QueryColumnOrigin, QueryDataChangeRequest


@dataclass(frozen=True)
class _SourceTable:
    table_name: str
    database_name: str | None
    alias: str


def _meaningful_tokens(statement):
    return [token for token in statement.tokens if token.ttype is not Whitespace and not token.is_whitespace]


def _query_tokens(sql: str):
    statements = sqlparse.parse(sql)
    if len(statements) != 1:
        return []
    tokens = _meaningful_tokens(statements[0])
    if not tokens or tokens[0].ttype is not DML or tokens[0].normalized != "SELECT":
        return []
    if any(token.ttype is Keyword and token.normalized in {"UNION", "INTERSECT", "EXCEPT", "GROUP BY", "HAVING"} for token in tokens):
        return []
    return tokens


def _select_identifiers(tokens) -> list[Identifier] | None:
    select_index = next((index for index, token in enumerate(tokens) if token.ttype is DML and token.normalized == "SELECT"), -1)
    from_index = next((index for index, token in enumerate(tokens) if token.ttype is Keyword and token.normalized == "FROM"), -1)
    if select_index < 0 or from_index <= select_index + 1:
        return None
    expression = tokens[select_index + 1]
    identifiers = list(expression.get_identifiers()) if isinstance(expression, IdentifierList) else [expression]
    if not identifiers or not all(isinstance(item, Identifier) for item in identifiers):
        return None
    for identifier in identifiers:
        if any(token.ttype is Wildcard or isinstance(token, Function) for token in identifier.flatten()):
            return None
    return identifiers


def _source_tables(tokens) -> list[_SourceTable] | None:
    sources: list[_SourceTable] = []
    expects_source = False
    for token in tokens:
        normalized = token.normalized if token.ttype is Keyword else ""
        if normalized == "FROM" or normalized.endswith("JOIN"):
            expects_source = True
            continue
        if not expects_source:
            continue
        expects_source = False
        if not isinstance(token, Identifier) or any(isinstance(item, Function) for item in token.tokens):
            return None
        table_name = token.get_real_name()
        if not table_name:
            return None
        sources.append(
            _SourceTable(
                table_name=str(table_name),
                database_name=str(token.get_parent_name()) if token.get_parent_name() else None,
                alias=str(token.get_alias() or table_name).casefold(),
            )
        )
    return sources or None


def analyze_query_column_origins(
    engine: Engine,
    sql: str,
    result_columns: list[str],
    database_name: str | None = None,
    pg_database: str | None = None,
) -> dict[str, QueryColumnOrigin]:
    """Return only direct source fields that can be located for a guarded update."""
    if is_mongo_client(engine) or is_redis_client(engine):
        return {}
    tokens = _query_tokens(sql)
    if not tokens:
        return {}
    identifiers = _select_identifiers(tokens)
    sources = _source_tables(tokens)
    if not identifiers or not sources:
        return {}
    available_columns = {
        source.alias: {
            column.name.casefold()
            for column in list_columns(
                engine,
                source.table_name,
                source.database_name or database_name,
                pg_database,
            )
        }
        for source in sources
    }
    source_by_alias = {source.alias: source for source in sources}
    result_by_folded_name = {column.casefold(): column for column in result_columns}
    origins: dict[str, QueryColumnOrigin] = {}
    for identifier in identifiers:
        column_name = identifier.get_real_name()
        output_name = identifier.get_alias() or identifier.get_name()
        if not column_name or not output_name:
            continue
        result_column = result_by_folded_name.get(str(output_name).casefold())
        if not result_column:
            continue
        parent = identifier.get_parent_name()
        if parent:
            source = source_by_alias.get(str(parent).casefold())
            if not source or str(column_name).casefold() not in available_columns[source.alias]:
                continue
        else:
            candidates = [
                source
                for source in sources
                if str(column_name).casefold() in available_columns[source.alias]
            ]
            if len(candidates) != 1:
                continue
            source = candidates[0]
        origins[result_column] = QueryColumnOrigin(
            table_name=source.table_name,
            column_name=str(column_name),
            database_name=source.database_name or database_name,
        )
    return origins


def _configure_database_context(connection, engine: Engine, database_name: str | None) -> None:
    if not database_name:
        return
    quoted = engine.dialect.identifier_preparer.quote(database_name)
    if engine.dialect.name == "mysql":
        connection.execute(text(f"USE {quoted}"))
    elif engine.dialect.name in {"postgresql", "gaussdb"}:
        connection.execute(text(f"SET search_path TO {quoted}"))
    elif engine.dialect.name in {"dm", "dmPython"}:
        connection.execute(text(f"SET SCHEMA {quoted}"))
    elif engine.dialect.name == "oracle":
        connection.execute(text(f"ALTER SESSION SET CURRENT_SCHEMA = {quoted}"))


def _quoted_table(preparer, origin: QueryColumnOrigin) -> str:
    parts = [origin.database_name, origin.table_name] if origin.database_name else [origin.table_name]
    return ".".join(preparer.quote(part) for part in parts)


def _where_for_original_values(preparer, values: dict[str, Any], prefix: str) -> tuple[str, dict[str, Any]]:
    if not values:
        raise ValueError("查询结果未返回可用于定位原记录的字段")
    clauses: list[str] = []
    params: dict[str, Any] = {}
    for index, (column, value) in enumerate(values.items()):
        quoted_column = preparer.quote(column)
        if value is None:
            clauses.append(f"{quoted_column} IS NULL")
            continue
        parameter = f"{prefix}_{index}"
        clauses.append(f"{quoted_column} = :{parameter}")
        params[parameter] = value
    return " AND ".join(clauses), params


def apply_query_data_changes(engine: Engine, changes: QueryDataChangeRequest) -> int:
    origins = analyze_query_column_origins(
        engine,
        changes.sql,
        list({key for row in changes.updated for key in [*row.original, *row.values]}),
        changes.database,
        changes.pg_database,
    )
    if not origins:
        raise ValueError("当前查询没有可安全更新的直接字段")
    preparer = engine.dialect.identifier_preparer
    updated_count = 0
    with engine.begin() as connection:
        _configure_database_context(connection, engine, changes.database)
        for row_index, row in enumerate(changes.updated):
            by_table: dict[tuple[str | None, str], dict[str, dict[str, Any]]] = {}
            for result_column, origin in origins.items():
                if result_column not in row.original:
                    continue
                key = (origin.database_name, origin.table_name)
                group = by_table.setdefault(key, {"original": {}, "values": {}, "origins": {}})
                group["original"][origin.column_name] = row.original[result_column]
                group["origins"][origin.column_name] = origin
                if result_column in row.values and row.values[result_column] != row.original[result_column]:
                    group["values"][origin.column_name] = row.values[result_column]
            for group in by_table.values():
                if not group["values"]:
                    continue
                origin = next(iter(group["origins"].values()))
                where_sql, where_params = _where_for_original_values(
                    preparer, group["original"], f"where_{row_index}"
                )
                quoted_table = _quoted_table(preparer, origin)
                matches = connection.execute(
                    text(f"SELECT COUNT(*) FROM {quoted_table} WHERE {where_sql}"), where_params
                ).scalar_one()
                if matches != 1:
                    raise ValueError("原始字段无法唯一定位记录，已取消提交以避免误修改")
                set_clauses: list[str] = []
                params = dict(where_params)
                for index, (column, value) in enumerate(group["values"].items()):
                    parameter = f"set_{row_index}_{index}"
                    set_clauses.append(f"{preparer.quote(column)} = :{parameter}")
                    params[parameter] = value
                result = connection.execute(
                    text(f"UPDATE {quoted_table} SET {', '.join(set_clauses)} WHERE {where_sql}"), params
                )
                if result.rowcount != 1:
                    raise ValueError("记录已变化或无法唯一定位，已取消提交")
                updated_count += 1
    return updated_count
