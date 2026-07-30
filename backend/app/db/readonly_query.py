import ast
import fnmatch
from datetime import date, datetime, time
from itertools import islice
from decimal import Decimal
from typing import Any

import sqlparse
from sqlalchemy import Engine, quoted_name, text
from sqlparse.tokens import Comment, Punctuation

from app.db.gaussdb import execute_gaussdb_database_ddl, is_gaussdb_database_ddl
from app.db.mongo_utils import is_mongo_client, mongo_default_database, serialize_mongo_document
from app.db.query_timeout import apply_query_timeout
from app.db.redis_utils import is_redis_client, redis_client_for_database, redis_key_length, redis_key_type, redis_scan_keys, redis_text, serialize_redis_value
from app.schemas.query import QueryResponse

READONLY_TYPES = {"SELECT", "WITH"}
INTERNAL_PAGING_COLUMNS = {"DATADJINN_RN"}


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    for statement in sqlparse.parse(sql):
        statement_sql = str(statement)
        offset = 0
        executable_end = -1

        for token in statement.flatten():
            token_end = offset + len(token.value)
            is_comment = token.ttype in Comment
            is_terminator = token.ttype is Punctuation and token.value == ";"
            if not token.is_whitespace and not is_comment and not is_terminator:
                executable_end = token_end
            offset = token_end

        if executable_end < 0:
            continue

        normalized = statement_sql[:executable_end].strip()
        if normalized:
            statements.append(normalized)

    return statements


def _is_schema_scoped_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"postgresql", "gaussdb"}


def _is_clickhouse_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"clickhouse", "clickhousedb"}


def _switch_clickhouse_database(engine: Engine, database: str | None) -> tuple[Engine, bool]:
    if not database or not _is_clickhouse_engine(engine) or engine.url.database == database:
        return engine, False

    factory = getattr(engine, "_datadjinn_engine_factory", None)
    if not callable(factory):
        return engine, False

    return factory(database), True


def _is_internal_paging_column(column: Any) -> bool:
    return str(column).upper() in INTERNAL_PAGING_COLUMNS


def _visible_result_columns(keys: Any) -> list[tuple[Any, str]]:
    return [(column, str(column)) for column in keys if not _is_internal_paging_column(column)]


def _read_sql_large_object(value: Any) -> Any:
    if hasattr(value, "getSubString") and hasattr(value, "length"):
        try:
            return value.getSubString(1, int(value.length()))
        except Exception:
            pass

    if hasattr(value, "read"):
        try:
            return value.read()
        except Exception:
            pass

    return value


def _serialize_sql_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if hasattr(value, "getSubString") or hasattr(value, "read"):
        expanded = _read_sql_large_object(value)
        if expanded is not value:
            return _serialize_sql_value(expanded)

    if isinstance(value, datetime):
        return value.isoformat(sep=" ")

    if isinstance(value, (date, time)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, bytes):
        return value.hex()

    if isinstance(value, (list, tuple)):
        return [_serialize_sql_value(item) for item in value]

    if isinstance(value, dict):
        return {str(key): _serialize_sql_value(item) for key, item in value.items()}

    return str(value)


def _query_rows(raw_rows: list[Any], columns: list[tuple[Any, str]]) -> list[dict[str, Any]]:
    return [{column_name: _serialize_sql_value(row[column]) for column, column_name in columns if column in row} for row in raw_rows]


def execute_readonly_query(engine: Engine, sql: str, limit: int | None, offset: int = 0, database: str | None = None, pg_database: str | None = None) -> QueryResponse:
    if is_mongo_client(engine):
        return _execute_mongo_readonly_query(engine, sql, limit, offset, database)

    if is_redis_client(engine):
        return _execute_redis_query(engine, sql, limit, offset, database)

    cleanup_engine = False

    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            cleanup_engine = True
        else:
            factory = getattr(engine, "_datadjinn_engine_factory", None)
            if callable(factory):
                engine = factory(pg_database)
                cleanup_engine = True

    engine, clickhouse_engine_changed = _switch_clickhouse_database(engine, database)
    if clickhouse_engine_changed:
        cleanup_engine = True
        database = None

    try:
        statement = _validate_readonly_sql(sql)

        if database and engine.dialect.name in {"mysql", "postgresql", "gaussdb", "dm", "dmPython", "oracle", "clickhouse", "clickhousedb"}:
            return _execute_on_connection_with_context(engine, statement, limit, offset, database)

        return _execute_limited_query(engine, statement, limit, offset)
    finally:
        if cleanup_engine:
            engine.dispose()


def count_readonly_query(
    engine: Engine,
    sql: str,
    database: str | None = None,
    pg_database: str | None = None,
) -> int:
    if is_mongo_client(engine) or is_redis_client(engine):
        return execute_readonly_query(engine, sql, None, 0, database, pg_database).row_count

    cleanup_engine = False
    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            cleanup_engine = True
        else:
            factory = getattr(engine, "_datadjinn_engine_factory", None)
            if callable(factory):
                engine = factory(pg_database)
                cleanup_engine = True

    engine, clickhouse_engine_changed = _switch_clickhouse_database(engine, database)
    if clickhouse_engine_changed:
        cleanup_engine = True
        database = None

    try:
        statement = _validate_readonly_sql(sql)
        alias_separator = " " if engine.dialect.name == "oracle" else " AS "
        count_sql = (
            "SELECT COUNT(*) AS __datadjinn_total_count FROM "
            f"({statement}){alias_separator}__datadjinn_count_source"
        )
        if database and engine.dialect.name in {
            "mysql",
            "postgresql",
            "gaussdb",
            "dm",
            "dmPython",
            "oracle",
            "clickhouse",
            "clickhousedb",
        }:
            response = _execute_on_connection_with_context(engine, count_sql, None, 0, database)
        else:
            response = _execute_limited_query(engine, count_sql, None, 0)
        if not response.rows:
            return 0
        return int(response.rows[0].get("__datadjinn_total_count", 0))
    finally:
        if cleanup_engine:
            engine.dispose()


def execute_query(engine: Engine, sql: str, limit: int | None, offset: int = 0, database: str | None = None, pg_database: str | None = None) -> QueryResponse:
    if is_mongo_client(engine):
        return _execute_mongo_readonly_query(engine, sql, limit, offset, database)

    if is_redis_client(engine):
        return _execute_redis_query(engine, sql, limit, offset, database)

    cleanup_engine = False

    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            cleanup_engine = True
        else:
            factory = getattr(engine, "_datadjinn_engine_factory", None)
            if callable(factory):
                engine = factory(pg_database)
                cleanup_engine = True

    engine, clickhouse_engine_changed = _switch_clickhouse_database(engine, database)
    if clickhouse_engine_changed:
        cleanup_engine = True
        database = None

    try:
        statements = _split_sql_statements(sql)
        if not statements:
            raise ValueError("SQL 语句不能为空")

        statement_types = [sqlparse.parse(statement)[0].get_type().upper() for statement in statements]
        has_readonly = any(statement_type in READONLY_TYPES for statement_type in statement_types)

        if has_readonly:
            if len(statements) != 1:
                raise ValueError("包含查询语句时一次只能执行一条 SQL")
            statement = statements[0]
            statement_type = statement_types[0]
        else:
            statement = statements[0]
            statement_type = statement_types[0]

        if statement_type in READONLY_TYPES:
            if database and engine.dialect.name in {"mysql", "postgresql", "gaussdb", "dm", "dmPython", "oracle", "clickhouse", "clickhousedb"}:
                return _execute_on_connection_with_context(engine, statement, limit, offset, database)
            return _execute_limited_query(engine, statement, limit, offset)

        return _execute_mutation_statements(engine, statements, database)
    finally:
        if cleanup_engine:
            engine.dispose()


def _mongo_response_from_documents(documents: list[dict[str, Any]], limited: bool) -> QueryResponse:
    columns = list(dict.fromkeys(key for document in documents for key in document.keys()))
    return QueryResponse(columns=columns, rows=documents, row_count=len(documents), limited=limited)


def _preview_mongo_collection(engine: Engine, collection_name: str, limit: int | None, offset: int, database_name: str | None = None) -> QueryResponse:
    target_db = database_name or mongo_default_database(engine)
    if not target_db:
        raise ValueError("请选择 MongoDB 数据库")

    cursor = engine[target_db][collection_name].find({}).skip(offset)
    if limit is not None:
        cursor = cursor.limit(limit + 1)
    raw_documents = [serialize_mongo_document(document) for document in cursor]
    limited = limit is not None and len(raw_documents) > limit
    return _mongo_response_from_documents(raw_documents[:limit] if limit is not None else raw_documents, limited)


def _redis_response(rows: list[dict[str, Any]], limited: bool) -> QueryResponse:
    columns = list(dict.fromkeys(key for row in rows for key in row.keys()))
    return QueryResponse(columns=columns, rows=rows, row_count=len(rows), limited=limited)


def _redis_key_summary(target: Any, key: str) -> dict[str, Any]:
    key_type = redis_key_type(target, key)
    memory = None
    try:
        memory = target.memory_usage(key)
    except Exception:
        memory = None

    return {
        "key": key,
        "type": key_type,
        "ttl": target.ttl(key),
        "length": redis_key_length(target, key, key_type),
        "memory": memory,
        "value": _redis_value_preview(target, key, key_type),
    }


def _redis_value_preview(target: Any, key: str, key_type: str) -> Any:
    if key_type == "string":
        return serialize_redis_value(target.get(key))
    if key_type == "hash":
        return serialize_redis_value(dict(target.hscan_iter(key, count=200)))
    if key_type == "list":
        return serialize_redis_value(target.lrange(key, 0, 99))
    if key_type == "set":
        return serialize_redis_value(list(islice(target.sscan_iter(key, count=200), 100)))
    if key_type == "zset":
        return serialize_redis_value(target.zrange(key, 0, 99, withscores=True))
    if key_type == "stream":
        entries = target.xrange(key, count=100)
        return [{"id": redis_text(entry_id), "fields": serialize_redis_value(fields)} for entry_id, fields in entries]
    return None


def _preview_redis_database(engine: Engine, limit: int | None, offset: int = 0, database_name: str | None = None, where: str | None = None) -> QueryResponse:
    target = redis_client_for_database(engine, database_name)
    try:
        pattern = (where or "").strip()
        key_pattern = "*" if not pattern else pattern if any(token in pattern for token in ("*", "?", "[")) else f"*{pattern}*"
        if limit is None:
            keys = [redis_text(key) for key in target.scan_iter(match=key_pattern, count=500)]
            return _redis_response([_redis_key_summary(target, key) for key in keys[offset:]], False)

        keys = [redis_text(key) for key in islice(target.scan_iter(match=key_pattern, count=500), offset + limit + 1)]
        sliced = keys[offset:offset + limit + 1]
        return _redis_response([_redis_key_summary(target, key) for key in sliced[:limit]], len(sliced) > limit)
    finally:
        if target is not engine:
            target.close()


def _preview_redis_key(engine: Engine, key: str, limit: int | None, offset: int = 0, database_name: str | None = None) -> QueryResponse:
    target = redis_client_for_database(engine, database_name)
    try:
        key_type = redis_key_type(target, key)
        ttl = target.ttl(key)

        if key_type == "none":
            return QueryResponse(columns=["message"], rows=[{"message": f"Key {key} 不存在"}], row_count=1, limited=False)

        if key_type == "string":
            rows = [{"key": key, "type": key_type, "ttl": ttl, "value": serialize_redis_value(target.get(key))}]
            return _redis_response(rows, False)

        if key_type == "hash":
            items = list(target.hscan_iter(key, count=500))
            sliced = items[offset:] if limit is None else items[offset:offset + limit + 1]
            visible_items = sliced if limit is None else sliced[:limit]
            rows = [{"field": redis_text(field), "value": serialize_redis_value(value)} for field, value in visible_items]
            return _redis_response(rows, limit is not None and len(sliced) > limit)

        if key_type == "list":
            values = target.lrange(key, offset, -1 if limit is None else offset + limit)
            visible_values = values if limit is None else values[:limit]
            rows = [{"index": offset + index, "value": serialize_redis_value(value)} for index, value in enumerate(visible_values)]
            return _redis_response(rows, limit is not None and len(values) > limit)

        if key_type == "set":
            members = list(target.sscan_iter(key, count=500))
            sliced = members[offset:] if limit is None else members[offset:offset + limit + 1]
            visible_members = sliced if limit is None else sliced[:limit]
            rows = [{"value": serialize_redis_value(value)} for value in visible_members]
            return _redis_response(rows, limit is not None and len(sliced) > limit)

        if key_type == "zset":
            values = target.zrange(key, offset, -1 if limit is None else offset + limit, withscores=True)
            visible_values = values if limit is None else values[:limit]
            rows = [{"member": serialize_redis_value(member), "score": score} for member, score in visible_values]
            return _redis_response(rows, limit is not None and len(values) > limit)

        if key_type == "stream":
            entries = target.xrange(key, count=None if limit is None else offset + limit + 1)
            entries = entries[offset:] if limit is None else entries[offset:offset + limit + 1]
            visible_entries = entries if limit is None else entries[:limit]
            rows = [{"id": redis_text(entry_id), **serialize_redis_value(fields)} for entry_id, fields in visible_entries]
            return _redis_response(rows, limit is not None and len(entries) > limit)

        return _redis_response([{"key": key, "type": key_type, "length": redis_key_length(target, key, key_type), "ttl": ttl}], False)
    finally:
        if target is not engine:
            target.close()


def _execute_redis_query(engine: Engine, sql: str, limit: int | None, offset: int = 0, database_name: str | None = None) -> QueryResponse:
    statement = sql.strip().rstrip(";")
    if not statement:
        raise ValueError("Redis 命令不能为空")

    parts = statement.split()
    command = parts[0].upper()
    target = redis_client_for_database(engine, database_name)
    try:
        if command in {"SCAN", "KEYS"}:
            pattern = parts[1] if len(parts) > 1 and command == "KEYS" else "*"
            if limit is None:
                keys = [redis_text(key) for key in target.scan_iter(count=500)]
            else:
                keys = redis_scan_keys(target, 10000 if pattern != "*" else offset + limit + 1)
            if pattern != "*":
                keys = [key for key in keys if fnmatch.fnmatch(key, pattern)]
            sliced = keys[offset:] if limit is None else keys[offset:offset + limit + 1]
            visible_keys = sliced if limit is None else sliced[:limit]
            rows = [_redis_key_summary(target, key) for key in visible_keys]
            return _redis_response(rows, limit is not None and len(sliced) > limit)

        if command in {"GET", "HGETALL", "LRANGE", "SMEMBERS", "ZRANGE", "XRANGE", "TYPE", "TTL"}:
            if len(parts) < 2:
                raise ValueError(f"Redis {command} 命令需要指定 Key")
            return _preview_redis_key(engine, parts[1], limit, offset, database_name)

        if command in {"SET", "HSET", "LPUSH", "RPUSH", "SADD", "ZADD", "DEL", "EXPIRE"}:
            result = target.execute_command(*parts)
            return _redis_response([{"message": "执行成功", "result": serialize_redis_value(result)}], False)
    finally:
        if target is not engine:
            target.close()

    raise ValueError("Redis 当前支持 SCAN/KEYS 预览 Key，GET/HGETALL/LRANGE/SMEMBERS/ZRANGE/XRANGE 查看数据，以及 SET/HSET/LPUSH/RPUSH/SADD/ZADD/DEL/EXPIRE 基础写入命令")


def _execute_mongo_readonly_query(engine: Engine, sql: str, limit: int | None, offset: int = 0, database_name: str | None = None) -> QueryResponse:
    statements = _split_mongo_statements(sql)
    target_db = database_name or mongo_default_database(engine)
    if not target_db:
        raise ValueError("请选择 MongoDB 数据库")

    if len(statements) == 1:
        return _execute_mongo_statement(engine, statements[0], limit, offset, target_db)

    rows = []
    for index, statement in enumerate(statements, start=1):
        result = _execute_mongo_statement(engine, statement, limit, offset, target_db)
        message = result.rows[0].get("message") if result.rows else "执行完成"
        inserted_count = result.rows[0].get("inserted_count") if result.rows else None
        rows.append({"index": index, "statement": statement, "message": message, "inserted_count": inserted_count})

    return QueryResponse(columns=["index", "statement", "message", "inserted_count"], rows=rows, row_count=len(rows), limited=False)


def _execute_mongo_statement(engine: Engine, statement: str, limit: int | None, offset: int, target_db: str) -> QueryResponse:
    if not statement.startswith("db."):
        raise ValueError("MongoDB 当前支持 db.<collection>.find({...}) 查询、db.createCollection(\"collection\") 创建集合、insertOne/insertMany 插入文档")

    if ".find" in statement:
        collection_name = statement.removeprefix("db.").split(".find", 1)[0].strip()
        if not collection_name:
            raise ValueError("无法识别 MongoDB 集合名称")

        return _preview_mongo_collection(engine, collection_name, limit, offset, target_db)

    if statement.startswith("db.createCollection"):
        collection_name = _parse_mongo_create_collection_name(statement)
        if collection_name in engine[target_db].list_collection_names():
            return QueryResponse(columns=["message"], rows=[{"message": f"集合 {collection_name} 已存在"}], row_count=1, limited=False)
        engine[target_db].create_collection(collection_name)
        return QueryResponse(columns=["message"], rows=[{"message": f"集合 {collection_name} 创建成功"}], row_count=1, limited=False)

    if ".insertMany" in statement:
        collection_name, raw_documents = _parse_mongo_collection_method_args(statement, "insertMany")
        documents = _parse_mongo_python_literal(raw_documents)
        if not isinstance(documents, list) or not all(isinstance(document, dict) for document in documents):
            raise ValueError("MongoDB insertMany 参数必须是文档数组")
        result = engine[target_db][collection_name].insert_many(documents)
        inserted_count = len(result.inserted_ids)
        return QueryResponse(columns=["message", "inserted_count"], rows=[{"message": f"已插入 {inserted_count} 条文档", "inserted_count": inserted_count}], row_count=1, limited=False)

    if ".insertOne" in statement:
        collection_name, raw_document = _parse_mongo_collection_method_args(statement, "insertOne")
        document = _parse_mongo_python_literal(raw_document)
        if not isinstance(document, dict):
            raise ValueError("MongoDB insertOne 参数必须是单个文档对象")
        result = engine[target_db][collection_name].insert_one(document)
        return QueryResponse(columns=["message", "inserted_id"], rows=[{"message": "已插入 1 条文档", "inserted_id": str(result.inserted_id)}], row_count=1, limited=False)

    raise ValueError("MongoDB 当前支持 db.<collection>.find({...}) 查询、db.createCollection(\"collection\") 创建集合、insertOne/insertMany 插入文档")


def _split_mongo_statements(sql: str) -> list[str]:
    statements: list[str] = []
    start = 0
    quote: str | None = None
    escape = False
    depth = 0

    for index, char in enumerate(sql):
        if quote:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
            continue

        if char in {"'", '"'}:
            quote = char
        elif char in "([{" :
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)
        elif char == ";" and depth == 0:
            statement = sql[start:index].strip()
            if statement:
                statements.append(statement)
            start = index + 1

    tail = sql[start:].strip()
    if tail:
        statements.append(tail)

    if not statements:
        raise ValueError("MongoDB 语句不能为空")

    return statements


def _parse_mongo_create_collection_name(statement: str) -> str:
    prefix = "db.createCollection"
    args = statement.removeprefix(prefix).strip()

    if not args.startswith("(") or not args.endswith(")"):
        raise ValueError("MongoDB 创建集合语法应为 db.createCollection(\"collection\")")

    return _parse_mongo_quoted_name(args[1:-1].strip().split(",", 1)[0].strip())


def _parse_mongo_collection_method_args(statement: str, method: str) -> tuple[str, str]:
    collection_name, args = statement.removeprefix("db.").split(f".{method}", 1)
    collection_name = collection_name.strip()
    if not collection_name:
        raise ValueError("无法识别 MongoDB 集合名称")
    if not args.strip().startswith("(") or not args.strip().endswith(")"):
        raise ValueError(f"MongoDB {method} 语法应为 db.<collection>.{method}(...)")
    return collection_name, args.strip()[1:-1].strip()


def _parse_mongo_quoted_name(value: str) -> str:
    if len(value) < 2 or value[0] not in {"'", '"'} or value[-1] != value[0]:
        raise ValueError("MongoDB 集合名称必须使用引号包裹")

    collection_name = value[1:-1].strip()
    if not collection_name:
        raise ValueError("MongoDB 集合名称不能为空")

    return collection_name


def _parse_mongo_python_literal(value: str) -> Any:
    try:
        return ast.literal_eval(value.replace("null", "None").replace("true", "True").replace("false", "False"))
    except (SyntaxError, ValueError) as exc:
        raise ValueError("MongoDB 文档参数必须是可解析的对象字面量，字符串键和值请使用引号") from exc


def _execute_on_connection_with_context(engine: Engine, sql: str, limit: int | None, offset: int, database: str) -> QueryResponse:
    limited_sql = sql if limit is None else _with_limit(engine, sql, limit + 1, offset)

    with engine.connect() as connection:
        preparer = engine.dialect.identifier_preparer
        quoted = preparer.quote(database)
        if engine.dialect.name == "mysql":
            connection.execute(text(f"USE {quoted}"))
        elif _is_schema_scoped_engine(engine):
            connection.execute(text(f"SET search_path TO {quoted}"))
        elif engine.dialect.name in {"dm", "dmPython"}:
            connection.execute(text(f"SET SCHEMA {quoted}"))
        elif engine.dialect.name == "oracle":
            connection.execute(text(f"ALTER SESSION SET CURRENT_SCHEMA = {quoted}"))
        elif engine.dialect.name in {"clickhouse", "clickhousedb"}:
            connection.execute(text(f"USE {quoted}"))
        with apply_query_timeout(connection):
            result = connection.execute(text(limited_sql))
            columns = _visible_result_columns(result.keys())
            raw_rows = result.mappings().fetchall()

    limited = limit is not None and len(raw_rows) > limit
    visible_rows = raw_rows if limit is None else raw_rows[:limit]
    rows = _query_rows(visible_rows, columns)

    return QueryResponse(columns=[column_name for _, column_name in columns], rows=rows, row_count=len(rows), limited=limited)


def preview_table(
    engine: Engine,
    table_name: str,
    limit: int | None,
    offset: int = 0,
    database_name: str | None = None,
    pg_database: str | None = None,
    where: str | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> QueryResponse:
    if is_mongo_client(engine):
        return _preview_mongo_collection(engine, table_name, limit, offset, database_name)

    if is_redis_client(engine):
        if table_name == "__DATADJINN_REDIS_DATABASE__":
            return _preview_redis_database(engine, limit, offset, database_name, where)
        return _preview_redis_key(engine, table_name, limit, offset, database_name)

    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            try:
                return _preview_table_impl(engine, table_name, limit, offset, database_name, where, sort_column, sort_direction)
            finally:
                engine.dispose()

        factory = getattr(engine, "_datadjinn_engine_factory", None)
        if callable(factory):
            next_engine = factory(pg_database)
            try:
                return _preview_table_impl(next_engine, table_name, limit, offset, database_name, where, sort_column, sort_direction)
            finally:
                next_engine.dispose()

    return _preview_table_impl(engine, table_name, limit, offset, database_name, where, sort_column, sort_direction)


def _preview_table_impl(
    engine: Engine,
    table_name: str,
    limit: int | None,
    offset: int,
    database_name: str | None = None,
    where: str | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> QueryResponse:
    from app.db.metadata import list_columns

    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(quoted_name(table_name, quote=True))

    if database_name:
        quoted_table = f"{preparer.quote(quoted_name(database_name, quote=True))}.{quoted_table}"

    where_sql = _validate_preview_where(where)
    if where_sql and engine.dialect.name == "oracle":
        where_sql = _normalize_oracle_where_clause(engine, table_name, database_name, where_sql)
    resolved_sort_column = sort_column
    resolved_sort_direction = sort_direction
    primary_key_columns: list[str] = []
    if not resolved_sort_column:
        try:
            primary_key_columns = [column.name for column in list_columns(engine, table_name, database_name) if column.primary_key]
        except Exception:
            primary_key_columns = []
    order_sql = _build_preview_order_sql(engine, resolved_sort_column, resolved_sort_direction, primary_key_columns)
    query = f"SELECT * FROM {quoted_table}{f' WHERE {where_sql}' if where_sql else ''}{order_sql}"
    result = _execute_limited_query(engine, query, limit, offset)
    result.total_count = _resolve_preview_total_count(result, limit, offset, engine, quoted_table, where_sql)
    result.sort_column = resolved_sort_column or (primary_key_columns[0] if len(primary_key_columns) == 1 else None)
    result.sort_direction = resolved_sort_direction or ("ascend" if primary_key_columns else None)
    return result


def _build_preview_order_sql(engine: Engine, sort_column: str | None, sort_direction: str | None, primary_key_columns: list[str] | None = None) -> str:
    if sort_column:
        direction = "DESC" if str(sort_direction).lower() == "descend" else "ASC"
        quoted_column = engine.dialect.identifier_preparer.quote(quoted_name(sort_column, quote=True))
        return f" ORDER BY {quoted_column} {direction}"

    if not primary_key_columns:
        return ""

    quoted_columns = [
        f"{engine.dialect.identifier_preparer.quote(quoted_name(column, quote=True))} ASC"
        for column in primary_key_columns
    ]
    return f" ORDER BY {', '.join(quoted_columns)}"


def _resolve_preview_total_count(result: QueryResponse, limit: int | None, offset: int, engine: Engine, quoted_table: str, where_sql: str) -> int | None:
    if limit is None:
        return result.row_count

    if not result.limited:
        return offset + result.row_count

    if offset == 0 and result.row_count < max(limit, 1):
        return result.row_count

    return _count_preview_rows(engine, quoted_table, where_sql)


def _validate_preview_where(where: str | None) -> str:
    condition = (where or "").strip().rstrip(";")
    if not condition:
        return ""

    normalized = condition.upper()
    if normalized.startswith("WHERE "):
        condition = condition[6:].strip()
        normalized = condition.upper()

    blocked = {";", "--", "/*", "*/"}
    if any(token in condition for token in blocked):
        raise ValueError("WHERE 条件不能包含注释或多条语句")

    forbidden = {"SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "EXEC", "MERGE"}
    statements = sqlparse.parse(condition)
    words = {token.value.upper() for token in statements[0].flatten() if token.value.strip()} if statements else set()
    if words & forbidden:
        raise ValueError("WHERE 条件只能填写过滤表达式，例如 id = 2")

    return condition


def _normalize_oracle_where_clause(engine: Engine, table_name: str, database_name: str | None, where_sql: str) -> str:
    from app.db.metadata import list_columns

    columns = list_columns(engine, table_name, database_name)
    if not columns:
        return where_sql

    column_name_map = {column.name.lower(): column.name for column in columns}
    if not column_name_map:
        return where_sql

    quoted_identifiers = {
        "select", "from", "where", "and", "or", "not", "null", "is", "in", "like", "between", "exists",
        "case", "when", "then", "else", "end", "asc", "desc", "order", "by", "group", "having", "rownum"
    }
    preparer = engine.dialect.identifier_preparer
    result: list[str] = []
    index = 0
    length = len(where_sql)

    while index < length:
        char = where_sql[index]

        if char == "'":
            start = index
            index += 1
            while index < length:
                if where_sql[index] == "'" and (index + 1 >= length or where_sql[index + 1] != "'"):
                    index += 1
                    break
                if where_sql[index] == "'" and index + 1 < length and where_sql[index + 1] == "'":
                    index += 2
                    continue
                index += 1
            result.append(where_sql[start:index])
            continue

        if char == '"':
            start = index
            index += 1
            while index < length:
                if where_sql[index] == '"':
                    index += 1
                    break
                index += 1
            result.append(where_sql[start:index])
            continue

        if char.isalpha() or char in {"_", "$", "#"}:
            start = index
            index += 1
            while index < length and (where_sql[index].isalnum() or where_sql[index] in {"_", "$", "#"}):
                index += 1
            token = where_sql[start:index]
            previous_char = where_sql[start - 1] if start > 0 else ""
            if previous_char == ":" or token.lower() in quoted_identifiers:
                result.append(token)
                continue
            actual_name = column_name_map.get(token.lower())
            result.append(preparer.quote(actual_name) if actual_name else token)
            continue

        result.append(char)
        index += 1

    return "".join(result)


def _count_preview_rows(engine: Engine, quoted_table: str, where_sql: str) -> int | None:
    query = f"SELECT COUNT(*) FROM {quoted_table}{f' WHERE {where_sql}' if where_sql else ''}"
    try:
        with engine.connect() as connection:
            with apply_query_timeout(connection):
                return int(connection.execute(text(query)).scalar() or 0)
    except Exception:
        return None


def _execute_limited_query(engine: Engine, sql: str, limit: int | None, offset: int = 0) -> QueryResponse:
    limited_sql = sql if limit is None else _with_limit(engine, sql, limit + 1, offset)

    with engine.connect() as connection:
        with apply_query_timeout(connection):
            result = connection.execute(text(limited_sql))
            columns = _visible_result_columns(result.keys())
            raw_rows = result.mappings().fetchall()

    limited = limit is not None and len(raw_rows) > limit
    visible_rows = raw_rows if limit is None else raw_rows[:limit]
    rows = _query_rows(visible_rows, columns)

    return QueryResponse(columns=[column_name for _, column_name in columns], rows=rows, row_count=len(rows), limited=limited)


def _execute_mutation_query(engine: Engine, sql: str, database: str | None = None) -> QueryResponse:
    if is_gaussdb_database_ddl(engine, sql):
        affected_rows = execute_gaussdb_database_ddl(engine, sql)
        return QueryResponse(
            columns=["message", "affected_rows"],
            rows=[{"message": "SQL 执行成功", "affected_rows": affected_rows}],
            row_count=1,
            limited=False,
            total_count=None,
        )

    with engine.begin() as connection:
        if database:
            preparer = engine.dialect.identifier_preparer
            quoted = preparer.quote(database)
            if _is_schema_scoped_engine(engine):
                connection.execute(text(f"SET search_path TO {quoted}"))
            elif engine.dialect.name in {"dm", "dmPython"}:
                connection.execute(text(f"SET SCHEMA {quoted}"))
            elif engine.dialect.name == "oracle":
                connection.execute(text(f"ALTER SESSION SET CURRENT_SCHEMA = {quoted}"))
            elif engine.dialect.name in {"mysql", "clickhouse", "clickhousedb"}:
                connection.execute(text(f"USE {quoted}"))

        with apply_query_timeout(connection):
            result = connection.execute(text(sql))
            if getattr(result, "returns_rows", False):
                columns = _visible_result_columns(result.keys())
                raw_rows = result.mappings().fetchall()
                rows = _query_rows(raw_rows, columns)
                return QueryResponse(columns=[column_name for _, column_name in columns], rows=rows, row_count=len(rows), limited=False)

        affected_rows = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else 0
        return QueryResponse(
            columns=["message", "affected_rows"],
            rows=[{"message": "SQL 执行成功", "affected_rows": affected_rows}],
            row_count=1,
            limited=False,
            total_count=None
        )


def _execute_mutation_statements(engine: Engine, statements: list[str], database: str | None = None) -> QueryResponse:
    if len(statements) == 1:
        return _execute_mutation_query(engine, statements[0], database)

    gaussdb_database_ddl = [is_gaussdb_database_ddl(engine, statement) for statement in statements]
    if any(gaussdb_database_ddl):
        if not all(gaussdb_database_ddl):
            raise ValueError("高斯数据库的创建或删除数据库语句不能与其他 SQL 在同一次执行中混用")

        for statement in statements:
            execute_gaussdb_database_ddl(engine, statement)
        return QueryResponse(
            columns=["message", "affected_rows"],
            rows=[{"message": f"共成功执行 {len(statements)} 条 SQL", "affected_rows": 0}],
            row_count=1,
            limited=False,
            total_count=None,
        )

    total_affected_rows = 0
    with engine.begin() as connection:
        if database:
            preparer = engine.dialect.identifier_preparer
            quoted = preparer.quote(database)
            if _is_schema_scoped_engine(engine):
                connection.execute(text(f"SET search_path TO {quoted}"))
            elif engine.dialect.name in {"dm", "dmPython"}:
                connection.execute(text(f"SET SCHEMA {quoted}"))
            elif engine.dialect.name == "oracle":
                connection.execute(text(f"ALTER SESSION SET CURRENT_SCHEMA = {quoted}"))
            elif engine.dialect.name in {"mysql", "clickhouse", "clickhousedb"}:
                connection.execute(text(f"USE {quoted}"))

        with apply_query_timeout(connection):
            for statement in statements:
                result = connection.execute(text(statement))
                if getattr(result, "returns_rows", False):
                    raise ValueError("多条 SQL 执行中不支持夹带查询语句")
                if result.rowcount is not None and result.rowcount > 0:
                    total_affected_rows += result.rowcount

    return QueryResponse(
        columns=["message", "affected_rows"],
        rows=[{"message": f"共成功执行 {len(statements)} 条 SQL", "affected_rows": total_affected_rows}],
        row_count=1,
        limited=False,
        total_count=None
    )


def _validate_single_sql(sql: str) -> str:
    statements = _split_sql_statements(sql)

    if len(statements) != 1:
        raise ValueError("只允许执行单条 SQL")

    return statements[0]


def _validate_readonly_sql(sql: str) -> str:
    statement = sqlparse.parse(_validate_single_sql(sql))[0]
    statement_type = statement.get_type().upper()

    if statement_type not in READONLY_TYPES:
        raise ValueError("只允许执行只读查询")

    return str(statement).strip()


def _with_limit(engine: Engine, sql: str, limit: int, offset: int = 0) -> str:
    parsed = sqlparse.parse(sql)

    if parsed and any(token.normalized == "LIMIT" for token in parsed[0].flatten()):
        return sql

    if engine.dialect.name in {"dm", "dmPython", "oracle"}:
        end_row = offset + limit
        return f"SELECT * FROM (SELECT inner_query.*, ROWNUM AS DATADJINN_RN FROM ({sql}) inner_query WHERE ROWNUM <= {end_row}) WHERE DATADJINN_RN > {offset}"

    return f"{sql} LIMIT {limit} OFFSET {offset}"
