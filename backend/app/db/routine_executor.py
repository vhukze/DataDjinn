from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from sqlalchemy import Engine, create_engine, text

from app.db.metadata import get_object_ddl
from app.db.query_timeout import apply_query_timeout
from app.db.readonly_query import _serialize_sql_value
from app.schemas.metadata import RoutineArgumentValue, RoutineParameterInfo
from app.schemas.query import QueryResponse


def coerce_routine_value(value: str | None, data_type: str | None) -> Any:
    if value is None:
        return None

    normalized_type = (data_type or "").strip().upper()
    text = value.strip()
    if normalized_type in {
        "SMALLINT",
        "INTEGER",
        "INT",
        "BIGINT",
        "TINYINT",
        "NUMBER",
    } and text.lstrip("+-").isdigit():
        return int(text)
    if any(token in normalized_type for token in ("DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL")):
        return float(text)
    if normalized_type in {"BOOLEAN", "BOOL"}:
        if text.lower() in {"true", "1", "yes", "y", "on"}:
            return True
        if text.lower() in {"false", "0", "no", "n", "off"}:
            return False
        raise ValueError(f"无法将参数值转换为布尔值：{value}")
    if "JSON" in normalized_type:
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("JSON 参数格式不正确") from exc
    return value


def _normalize_mode(value: Any) -> str:
    normalized = str(value or "IN").replace("/", "").replace(" ", "").upper()
    return "INOUT" if normalized in {"INOUT", "INOUTPARAMETER"} else normalized if normalized in {"IN", "OUT"} else "IN"


_ROUTINE_HEADER_PATTERN = re.compile(
    r"\bCREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+"
    r"(?:\"(?:[^\"]|\"\")+\"|[A-Z_$#][A-Z0-9_$#]*)"
    r"(?:\s*\.\s*(?:\"(?:[^\"]|\"\")+\"|[A-Z_$#][A-Z0-9_$#]*))?"
    r"\s*(?:\((?P<parameters>.*?)\))?\s*(?:AS|IS)\b",
    re.IGNORECASE | re.DOTALL,
)
_ROUTINE_PARAMETER_NAME_PATTERN = re.compile(
    r"^\s*(?P<name>\"(?:[^\"]|\"\")+\"|[A-Z_$#][A-Z0-9_$#]*)\s+(?P<definition>.+?)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_ROUTINE_PARAMETER_MODE_PATTERN = re.compile(r"^(?:(IN\s+OUT|INOUT|IN|OUT)\b\s*)?(?P<type>.+)$", re.IGNORECASE | re.DOTALL)
_ROUTINE_PARAMETER_DEFAULT_PATTERN = re.compile(r"\s+(?:DEFAULT\b|:=).*$", re.IGNORECASE | re.DOTALL)


def _split_routine_parameter_definitions(definitions: str) -> list[str]:
    items: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    for index, character in enumerate(definitions):
        if quote:
            if character == quote:
                quote = None
            continue
        if character in {"'", '\"'}:
            quote = character
        elif character == "(":
            depth += 1
        elif character == ")":
            depth = max(0, depth - 1)
        elif character == "," and depth == 0:
            items.append(definitions[start:index])
            start = index + 1
    items.append(definitions[start:])
    return items


def _parameters_from_routine_ddl(ddl: str) -> list[RoutineParameterInfo]:
    header = _ROUTINE_HEADER_PATTERN.search(ddl)
    definitions = header.group("parameters") if header else None
    if not definitions or not definitions.strip():
        return []

    parameters: list[RoutineParameterInfo] = []
    for position, definition in enumerate(_split_routine_parameter_definitions(definitions), start=1):
        parameter = _ROUTINE_PARAMETER_NAME_PATTERN.match(definition)
        if not parameter:
            return []
        mode_and_type = _ROUTINE_PARAMETER_MODE_PATTERN.match(parameter.group("definition"))
        if not mode_and_type:
            return []
        raw_name = parameter.group("name")
        name = raw_name[1:-1].replace('\"\"', '\"') if raw_name.startswith('\"') else raw_name
        data_type = _ROUTINE_PARAMETER_DEFAULT_PATTERN.sub("", mode_and_type.group("type")).strip()
        if not data_type:
            return []
        parameters.append(
            RoutineParameterInfo(
                name=name,
                mode=_normalize_mode(mode_and_type.group(1)),
                data_type=data_type,
                position=position,
                has_default=bool(_ROUTINE_PARAMETER_DEFAULT_PATTERN.search(mode_and_type.group("type"))),
            )
        )
    return parameters


def _target_schema(engine: Engine, database: str | None) -> str:
    if database:
        return database
    if engine.dialect.name in {"dm", "dmPython", "oracle"}:
        return engine.url.username or ""
    return engine.url.database or "public"


def _with_pg_database(engine: Engine, pg_database: str | None) -> tuple[Engine, bool]:
    if not pg_database or engine.dialect.name not in {"postgresql", "gaussdb"}:
        return engine, False
    if engine.dialect.name == "postgresql":
        return create_engine(engine.url.set(database=pg_database), pool_pre_ping=True), True
    factory = getattr(engine, "_datadjinn_engine_factory", None)
    if callable(factory):
        return factory(pg_database), True
    return engine, False


def list_routine_parameters(
    engine: Engine,
    routine_name: str,
    database: str | None = None,
    pg_database: str | None = None,
) -> list[RoutineParameterInfo]:
    engine, cleanup = _with_pg_database(engine, pg_database)
    try:
        dialect = engine.dialect.name
        schema = _target_schema(engine, database)
        if dialect in {"mysql", "postgresql", "gaussdb"}:
            default_expression = "NULL"
            procedure_join = ""
            if dialect in {"postgresql", "gaussdb"}:
                procedure_join = (
                    "JOIN pg_namespace ns ON ns.nspname = r.routine_schema "
                    "JOIN pg_proc proc ON proc.pronamespace = ns.oid "
                    "AND proc.proname = r.routine_name "
                    "AND r.specific_name = proc.proname || '_' || proc.oid "
                )
                default_expression = (
                    "CASE WHEN p.parameter_mode IN ('IN', 'INOUT') AND "
                    "SUM(CASE WHEN p.parameter_mode IN ('IN', 'INOUT') THEN 1 ELSE 0 END) OVER ("
                    "PARTITION BY p.specific_name ORDER BY p.ordinal_position "
                    "ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING"
                    ") <= proc.pronargdefaults THEN TRUE ELSE FALSE END"
                )
            sql = (
                "SELECT p.parameter_name, p.parameter_mode, p.data_type, "
                f"p.ordinal_position, {default_expression} AS has_default "
                "FROM information_schema.parameters p "
                "JOIN information_schema.routines r ON "
                "r.specific_catalog = p.specific_catalog AND "
                "r.specific_schema = p.specific_schema AND "
                "r.specific_name = p.specific_name "
                f"{procedure_join}"
                "WHERE r.routine_schema = :schema AND r.routine_name = :name "
                "AND r.routine_type = 'PROCEDURE' "
                "AND p.parameter_mode IS NOT NULL "
                "ORDER BY p.ordinal_position"
            )
            with engine.connect() as connection:
                rows = connection.execute(text(sql), {"schema": schema, "name": routine_name}).fetchall()
            return [
                RoutineParameterInfo(
                    name=str(row[0] or f"arg{row[3]}"),
                    mode=_normalize_mode(row[1]),
                    data_type=str(row[2] or "VARCHAR"),
                    position=int(row[3]),
                    has_default=bool(row[4]),
                )
                for row in rows
            ]

        if dialect in {"oracle", "dm", "dmPython"}:
            sql = (
                "SELECT ARGUMENT_NAME, IN_OUT, DATA_TYPE, POSITION, DEFAULTED "
                "FROM ALL_ARGUMENTS WHERE OWNER = :schema AND OBJECT_NAME = :name "
                "AND DATA_LEVEL = 0 AND POSITION > 0 "
                "ORDER BY SEQUENCE"
            )
            with engine.connect() as connection:
                rows = connection.execute(
                    text(sql),
                    {"schema": schema.upper(), "name": routine_name.upper()},
                ).fetchall()
            parameters = [
                RoutineParameterInfo(
                    name=str(row[0] or f"arg{row[3]}"),
                    mode=_normalize_mode(row[1]),
                    data_type=str(row[2] or "VARCHAR"),
                    position=int(row[3]),
                    has_default=str(row[4] or "N").upper() in {"Y", "YES"},
                )
                for row in rows
            ]
            if parameters or dialect not in {"dm", "dmPython"}:
                return parameters

            # Some Dameng driver versions expose ALL_ARGUMENTS without procedure arguments.
            # Its generated DDL is authoritative and lets the execution dialog stay usable.
            ddl = get_object_ddl(engine, routine_name, "procedure", schema)
            return _parameters_from_routine_ddl(ddl)

        raise ValueError("当前数据库不支持执行存储过程")
    finally:
        if cleanup:
            engine.dispose()


def _argument_map(arguments: list[RoutineArgumentValue]) -> dict[str, RoutineArgumentValue]:
    return {argument.name.lower(): argument for argument in arguments}


def _validate_routine_arguments(
    parameters: list[RoutineParameterInfo],
    arguments: list[RoutineArgumentValue],
) -> None:
    normalized_names = [argument.name.lower() for argument in arguments]
    if len(normalized_names) != len(set(normalized_names)):
        raise ValueError("存储过程参数不能重复")

    parameter_map = {parameter.name.lower(): parameter for parameter in parameters}
    unknown_names = [
        argument.name for argument in arguments if argument.name.lower() not in parameter_map
    ]
    if unknown_names:
        raise ValueError(f"存储过程参数不存在：{', '.join(unknown_names)}")

    invalid_defaults = [
        argument.name
        for argument in arguments
        if argument.use_default
        and not parameter_map[argument.name.lower()].has_default
    ]
    if invalid_defaults:
        raise ValueError(f"存储过程参数没有默认值：{', '.join(invalid_defaults)}")


def _argument_value(
    parameter: RoutineParameterInfo,
    arguments: dict[str, RoutineArgumentValue],
) -> Any:
    argument = arguments.get(parameter.name.lower())
    if parameter.mode == "OUT":
        return None
    if argument is None or argument.is_null:
        return None
    return coerce_routine_value(argument.value, parameter.data_type)


def _rows_from_cursor(cursor: Any) -> tuple[list[str], list[dict[str, Any]]]:
    if not cursor.description:
        return [], []
    columns = [str(item[0]) for item in cursor.description]
    rows = [
        {column: _serialize_sql_value(value) for column, value in zip(columns, row, strict=False)}
        for row in cursor.fetchall()
    ]
    return columns, rows


def _output_cursor_type(cursor: Any, data_type: str) -> Any:
    normalized = data_type.upper()
    if any(token in normalized for token in ("INT", "NUMBER", "DECIMAL", "FLOAT", "DOUBLE")):
        return float
    if any(token in normalized for token in ("DATE", "TIME")):
        return datetime
    return str


def _execute_postgresql_routine(
    engine: Engine,
    routine_name: str,
    schema: str,
    parameters: list[RoutineParameterInfo],
    arguments: list[RoutineArgumentValue],
) -> QueryResponse:
    provided = _argument_map(arguments)
    preparer = engine.dialect.identifier_preparer
    call_arguments: list[str] = []
    binds: dict[str, Any] = {}
    for index, parameter in enumerate(parameters):
        argument = provided.get(parameter.name.lower())
        if argument and argument.use_default:
            continue
        bind_name = f"routine_arg_{index}"
        call_arguments.append(f"{preparer.quote(parameter.name)} => :{bind_name}")
        binds[bind_name] = _argument_value(parameter, provided)

    qualified_name = f"{preparer.quote(schema)}.{preparer.quote(routine_name)}"
    statement = f"CALL {qualified_name}({', '.join(call_arguments)})"
    with engine.begin() as connection:
        with apply_query_timeout(connection):
            result = connection.execute(text(statement), binds)
            if result.returns_rows:
                columns = [str(column) for column in result.keys()]
                rows = [
                    {column: _serialize_sql_value(row.get(column)) for column in columns}
                    for row in result.mappings().fetchall()
                ]
                return QueryResponse(
                    columns=columns,
                    rows=rows,
                    row_count=len(rows),
                    limited=False,
                )
    return QueryResponse(
        columns=["message", "affected_rows"],
        rows=[{"message": "存储过程执行成功", "affected_rows": 0}],
        row_count=1,
        limited=False,
    )


def _execute_dbapi_routine(
    engine: Engine,
    routine_name: str,
    schema: str,
    parameters: list[RoutineParameterInfo],
    arguments: list[RoutineArgumentValue],
) -> QueryResponse:
    provided = _argument_map(arguments)
    raw_connection = engine.raw_connection()
    cursor = raw_connection.cursor()
    output_bindings: dict[str, Any] = {}
    values: list[Any] = []
    named_values: dict[str, Any] = {}
    named_arguments: list[str] = []
    preparer = engine.dialect.identifier_preparer
    try:
        if engine.dialect.name == "mysql" and schema:
            cursor.execute(f"USE {engine.dialect.identifier_preparer.quote(schema)}")
        for parameter in parameters:
            argument = provided.get(parameter.name.lower())
            if argument and argument.use_default and engine.dialect.name == "mysql":
                raise ValueError("当前数据库驱动不支持在 CALL 中跳过默认参数")
            if argument and argument.use_default:
                continue
            value = _argument_value(parameter, provided)
            if (
                engine.dialect.name != "mysql"
                and parameter.mode in {"OUT", "INOUT"}
                and hasattr(cursor, "var")
            ):
                variable = cursor.var(_output_cursor_type(cursor, parameter.data_type))
                if parameter.mode == "INOUT" and value is not None:
                    variable.setvalue(0, value)
                output_bindings[parameter.name] = variable
                values.append(variable)
            else:
                values.append(value)

            if engine.dialect.name != "mysql":
                bind_name = f"routine_arg_{parameter.position}"
                named_values[bind_name] = values[-1]
                named_arguments.append(f"{preparer.quote(parameter.name)} => :{bind_name}")

        call_name = (
            routine_name
            if engine.dialect.name == "mysql"
            else f"{preparer.quote(schema)}.{preparer.quote(routine_name)}"
        )
        if engine.dialect.name == "mysql":
            cursor.callproc(call_name, values)
        else:
            cursor.execute(f"BEGIN {call_name}({', '.join(named_arguments)}); END;", named_values)
        columns, rows = _rows_from_cursor(cursor)
        while hasattr(cursor, "nextset") and cursor.nextset():
            if not rows and cursor.description:
                columns, rows = _rows_from_cursor(cursor)

        outputs: dict[str, Any] = {}
        if engine.dialect.name == "mysql":
            output_parameters = [
                (index, parameter)
                for index, parameter in enumerate(parameters)
                if parameter.mode in {"OUT", "INOUT"}
            ]
            if output_parameters:
                variables = ", ".join(f"@_{routine_name}_{index}" for index, _ in output_parameters)
                cursor.execute(f"SELECT {variables}")
                output_row = cursor.fetchone() or []
                outputs = {
                    parameter.name: _serialize_sql_value(value)
                    for (_, parameter), value in zip(output_parameters, output_row, strict=False)
                }
        else:
            outputs = {
                name: _serialize_sql_value(variable.getvalue())
                for name, variable in output_bindings.items()
            }
        raw_connection.commit()
        if not rows and outputs:
            columns = list(outputs)
            rows = [outputs]
        if not rows:
            columns = ["message", "affected_rows"]
            rows = [{"message": "存储过程执行成功", "affected_rows": 0}]
        return QueryResponse(
            columns=columns,
            rows=rows,
            row_count=len(rows),
            limited=False,
        )
    except Exception:
        raw_connection.rollback()
        raise
    finally:
        cursor.close()
        raw_connection.close()


def _execute_dameng_jdbc_routine(
    engine: Engine,
    routine_name: str,
    schema: str,
    parameters: list[RoutineParameterInfo],
    arguments: list[RoutineArgumentValue],
) -> QueryResponse:
    provided = _argument_map(arguments)
    if any(parameter.mode != "IN" for parameter in parameters):
        raise ValueError("达梦 JDBC 驱动暂不支持带输出参数的存储过程，请改用 dmPython 驱动执行")
    if any(argument.use_default for argument in arguments):
        raise ValueError("达梦 JDBC 驱动暂不支持跳过默认参数，请填写参数值后执行")

    raw_connection = engine.raw_connection()
    cursor = raw_connection.cursor()
    preparer = engine.dialect.identifier_preparer
    qualified_name = f"{preparer.quote(schema)}.{preparer.quote(routine_name)}"
    values = [_argument_value(parameter, provided) for parameter in parameters]
    statement = f"CALL {qualified_name}({', '.join('?' for _ in values)})"
    try:
        cursor.execute(statement, values)
        columns, rows = _rows_from_cursor(cursor)
        while hasattr(cursor, "nextset") and cursor.nextset():
            if not rows and cursor.description:
                columns, rows = _rows_from_cursor(cursor)
        raw_connection.commit()
        if not rows:
            columns = ["message", "affected_rows"]
            rows = [{"message": "存储过程执行成功", "affected_rows": 0}]
        return QueryResponse(columns=columns, rows=rows, row_count=len(rows), limited=False)
    except Exception:
        raw_connection.rollback()
        raise
    finally:
        cursor.close()
        raw_connection.close()


def execute_routine(
    engine: Engine,
    routine_name: str,
    parameters: list[RoutineParameterInfo],
    arguments: list[RoutineArgumentValue],
    database: str | None = None,
    pg_database: str | None = None,
) -> QueryResponse:
    _validate_routine_arguments(parameters, arguments)
    engine, cleanup = _with_pg_database(engine, pg_database)
    try:
        schema = _target_schema(engine, database)
        if engine.dialect.name in {"postgresql", "gaussdb"}:
            return _execute_postgresql_routine(
                engine,
                routine_name,
                schema,
                parameters,
                arguments,
            )
        if engine.dialect.name == "dm":
            return _execute_dameng_jdbc_routine(
                engine,
                routine_name,
                schema,
                parameters,
                arguments,
            )
        if engine.dialect.name in {"mysql", "oracle", "dm", "dmPython"}:
            return _execute_dbapi_routine(
                engine,
                routine_name,
                schema,
                parameters,
                arguments,
            )
        raise ValueError("当前数据库不支持执行存储过程")
    finally:
        if cleanup:
            engine.dispose()
