from __future__ import annotations

import base64
import csv
import json
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, (list, tuple, set)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    return str(value)


def _text_value(value: Any) -> str:
    normalized = _json_value(value)
    if normalized is None:
        return ""
    if isinstance(normalized, (dict, list)):
        return json.dumps(normalized, ensure_ascii=False)
    return str(normalized)


def _sql_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    escaped = _text_value(value).replace("\\", "\\\\").replace("'", "''")
    return f"'{escaped}'"


def _markdown_value(value: Any) -> str:
    return (
        _text_value(value)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", "<br>")
        .replace("\n", "<br>")
        .replace("\r", "<br>")
    )


def render_markdown_table(columns: list[str], rows: list[dict[str, Any]]) -> str:
    header = "| " + " | ".join(_markdown_value(column) for column in columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    body = [
        "| " + " | ".join(_markdown_value(row.get(column)) for column in columns) + " |"
        for row in rows
    ]
    return "\n".join([header, separator, *body]) + "\n"


def _selected_rows(
    columns: list[str], rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    return [{column: _json_value(row.get(column)) for column in columns} for row in rows]


def render_sql_inserts(
    columns: list[str],
    rows: list[dict[str, Any]],
    table_name: str,
    quote_identifier: Callable[[str], str],
) -> str:
    column_sql = ", ".join(quote_identifier(column) for column in columns)
    statements = [
        f"INSERT INTO {table_name} ({column_sql}) VALUES "
        f"({', '.join(_sql_value(row.get(column)) for column in columns)});"
        for row in rows
    ]
    return "\n".join(statements) + ("\n" if statements else "")


def write_tabular_export(
    file_path: Path,
    export_format: str,
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    table_name: str | None = None,
    quote_identifier: Callable[[str], str] | None = None,
) -> None:
    if not columns:
        raise ValueError("请至少选择一个导出列")

    file_path.parent.mkdir(parents=True, exist_ok=True)
    normalized_rows = _selected_rows(columns, rows)

    if export_format == "csv":
        with file_path.open("w", encoding="utf-8-sig", newline="") as output:
            writer = csv.writer(output, lineterminator="\n")
            writer.writerow(columns)
            writer.writerows([_text_value(row.get(column)) for column in columns] for row in rows)
        return

    if export_format == "json":
        file_path.write_text(
            json.dumps(normalized_rows, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return

    if export_format == "markdown":
        file_path.write_text(render_markdown_table(columns, rows), encoding="utf-8")
        return

    if export_format == "sql":
        if not table_name:
            raise ValueError("查询结果不支持导出为 SQL")
        quote = quote_identifier or (lambda value: value)
        file_path.write_text(
            render_sql_inserts(columns, rows, table_name, quote),
            encoding="utf-8",
        )
        return

    raise ValueError(f"不支持的导出格式：{export_format}")
