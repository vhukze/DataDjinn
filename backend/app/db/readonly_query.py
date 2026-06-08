import ast
import fnmatch
from datetime import date, datetime, time
from itertools import islice
from decimal import Decimal
from typing import Any

import sqlparse
from sqlalchemy import Engine, quoted_name, text

from app.db.mongo_utils import is_mongo_client, mongo_default_database, serialize_mongo_document
from app.db.redis_utils import is_redis_client, redis_client_for_database, redis_key_length, redis_key_type, redis_scan_keys, redis_text, serialize_redis_value
from app.schemas.query import QueryResponse

READONLY_TYPES = {"SELECT", "WITH"}
INTERNAL_PAGING_COLUMNS = {"__DATADJINN_RN", "_DATADJINN_RN"}


def _is_schema_scoped_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"postgresql", "gaussdb"}


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

    try:
        statement = _validate_readonly_sql(sql)

        if database and engine.dialect.name in {"mysql", "postgresql", "gaussdb", "dm", "dmPython", "clickhouse", "clickhousedb"}:
            return _execute_on_connection_with_context(engine, statement, limit, offset, database)

        return _execute_limited_query(engine, statement, limit, offset)
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


def _preview_redis_database(engine: Engine, limit: int | None, offset: int = 0, database_name: str | None = None) -> QueryResponse:
    target = redis_client_for_database(engine, database_name)
    try:
        if limit is None:
            keys = [redis_text(key) for key in target.scan_iter(count=500)]
            return _redis_response([_redis_key_summary(target, key) for key in keys[offset:]], False)

        keys = redis_scan_keys(target, offset + limit + 1)
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
        elif engine.dialect.name in {"clickhouse", "clickhousedb"}:
            connection.execute(text(f"USE {quoted}"))
        result = connection.execute(text(limited_sql))
        columns = _visible_result_columns(result.keys())
        raw_rows = result.mappings().fetchall()

    limited = limit is not None and len(raw_rows) > limit
    visible_rows = raw_rows if limit is None else raw_rows[:limit]
    rows = _query_rows(visible_rows, columns)

    return QueryResponse(columns=[column_name for _, column_name in columns], rows=rows, row_count=len(rows), limited=limited)


def preview_table(engine: Engine, table_name: str, limit: int, offset: int = 0, database_name: str | None = None, pg_database: str | None = None, where: str | None = None) -> QueryResponse:
    if is_mongo_client(engine):
        return _preview_mongo_collection(engine, table_name, limit, offset, database_name)

    if is_redis_client(engine):
        if table_name == "__DATADJINN_REDIS_DATABASE__":
            return _preview_redis_database(engine, limit, offset, database_name)
        return _preview_redis_key(engine, table_name, limit, offset, database_name)

    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            try:
                return _preview_table_impl(engine, table_name, limit, offset, database_name, where)
            finally:
                engine.dispose()

        factory = getattr(engine, "_datadjinn_engine_factory", None)
        if callable(factory):
            next_engine = factory(pg_database)
            try:
                return _preview_table_impl(next_engine, table_name, limit, offset, database_name, where)
            finally:
                next_engine.dispose()

    return _preview_table_impl(engine, table_name, limit, offset, database_name, where)


def _preview_table_impl(engine: Engine, table_name: str, limit: int, offset: int, database_name: str | None = None, where: str | None = None) -> QueryResponse:
    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(quoted_name(table_name, quote=True))

    if database_name:
        quoted_table = f"{preparer.quote(quoted_name(database_name, quote=True))}.{quoted_table}"

    where_sql = _validate_preview_where(where)
    query = f"SELECT * FROM {quoted_table}{f' WHERE {where_sql}' if where_sql else ''}"
    result = _execute_limited_query(engine, query, limit, offset)
    result.total_count = _count_preview_rows(engine, quoted_table, where_sql)
    return result


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


def _count_preview_rows(engine: Engine, quoted_table: str, where_sql: str) -> int | None:
    query = f"SELECT COUNT(*) FROM {quoted_table}{f' WHERE {where_sql}' if where_sql else ''}"
    try:
        with engine.connect() as connection:
            return int(connection.execute(text(query)).scalar() or 0)
    except Exception:
        return None


def _execute_limited_query(engine: Engine, sql: str, limit: int | None, offset: int = 0) -> QueryResponse:
    limited_sql = sql if limit is None else _with_limit(engine, sql, limit + 1, offset)

    with engine.connect() as connection:
        result = connection.execute(text(limited_sql))
        columns = _visible_result_columns(result.keys())
        raw_rows = result.mappings().fetchall()

    limited = limit is not None and len(raw_rows) > limit
    visible_rows = raw_rows if limit is None else raw_rows[:limit]
    rows = _query_rows(visible_rows, columns)

    return QueryResponse(columns=[column_name for _, column_name in columns], rows=rows, row_count=len(rows), limited=limited)


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
