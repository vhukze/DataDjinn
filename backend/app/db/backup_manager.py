import csv
import json
import os
import sqlite3
from itertools import islice
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text

from app.db.connection_manager import _resolve_runtime_path, connection_manager
from app.db.data_export import parse_csv_text_value, render_sql_inserts, selected_export_row, write_csv_rows, write_markdown_table_stream, write_tabular_export
from app.db.metadata import _build_pg_table_ddl, _pg_table_constraints, get_object_ddl, list_columns, list_schemas, list_tables
from app.db.mongo_utils import is_mongo_client, serialize_mongo_document
from app.db.readonly_query import execute_readonly_query, preview_table
from app.db.redis_utils import is_redis_client, redis_client_for_database, redis_text, serialize_redis_value
from app.db.sql_executor import execute_sql_file
from app.schemas.backup import BackupRecord, ExportContent, ExportFormat, ExportScope, ResultExportRequest
from app.schemas.connection import ConnectionRequest


def _data_dir() -> Path:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return Path(data_dir).expanduser().resolve()
    return Path(__file__).resolve().parents[2] / "data"


BACKUP_DIR = _data_dir() / "backups"
BACKUP_STORE_PATH = BACKUP_DIR / "backups.json"


def _safe_filename(value: str) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_", "."} else "_" for char in value)[:120]


def _quote_identifier(engine, name: str) -> str:
    return engine.dialect.identifier_preparer.quote(name)


def _is_clickhouse_engine(engine) -> bool:
    return engine.dialect.name in {"clickhouse", "clickhousedb"}


def _qualified_table_name(engine, database: str | None, table: str) -> str:
    quoted_table = _quote_identifier(engine, table)
    return f"{_quote_identifier(engine, database)}.{quoted_table}" if database else quoted_table


def _generate_sqlite_backup(request: ConnectionRequest) -> str:
    if not request.sqlite_path:
        raise ValueError("SQLite 文件路径不能为空")
    source_path = _resolve_runtime_path(request.sqlite_path)
    if not source_path.exists():
        raise ValueError(f"SQLite 文件不存在：{source_path}")
    source = sqlite3.connect(source_path)
    try:
        return "\n".join(source.iterdump())
    finally:
        source.close()


def _mysql_table_name(engine, database: str, table: str) -> str:
    return f"{_quote_identifier(engine, database)}.{_quote_identifier(engine, table)}"


def _generate_mysql_backup(engine, database: str, content: ExportContent = "schema_data") -> str:
    lines: list[str] = [] if content == "schema" else ["SET FOREIGN_KEY_CHECKS=0;", ""]

    with engine.connect() as connection:
        inspector = inspect(connection)
        tables = inspector.get_table_names(schema=database)

        for table_name in tables:
            quoted_table = _mysql_table_name(engine, database, table_name)
            result = connection.execute(text(f"SHOW CREATE TABLE {quoted_table}"))
            row = result.fetchone()
            if content in {"schema", "schema_data"} and row and len(row) >= 2:
                lines.append(f"DROP TABLE IF EXISTS {quoted_table};")
                lines.append(f"{row[1]};")
                lines.append("")

            if content == "schema":
                continue

            columns = [col["name"] for col in inspector.get_columns(table_name, schema=database)]
            if not columns:
                continue

            data_result = connection.execute(text(f"SELECT * FROM {quoted_table}"))
            column_list = ", ".join(_quote_identifier(engine, col) for col in columns)
            for data_row in data_result:
                values = ", ".join(_format_value(val) for val in data_row)
                lines.append(f"INSERT INTO {quoted_table} ({column_list}) VALUES ({values});")

            lines.append("")

    if content != "schema":
        lines.append("SET FOREIGN_KEY_CHECKS=1;")
    return "\n".join(lines)


def _generate_postgresql_backup(
    engine, database: str, schema_name: str | None = None, content: ExportContent = "schema_data"
) -> str:
    pg_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
    try:
        return _generate_postgresql_backup_internal(pg_engine, schema_name, content)
    finally:
        pg_engine.dispose()


def _generate_postgresql_backup_internal(
    engine, schema_name: str | None = None, content: ExportContent = "schema_data"
) -> str:
    lines: list[str] = []
    inspector = inspect(engine)
    schemas = (
        [schema_name]
        if schema_name
        else [
            name
            for name in inspector.get_schema_names()
            if name != "information_schema" and not name.startswith("pg_")
        ]
    )
    if not schemas:
        raise ValueError("PostgreSQL 数据库中没有可备份的用户 schema")

    tables_by_schema = {
        current_schema: inspector.get_table_names(schema=current_schema)
        for current_schema in schemas
    }
    for current_schema in schemas:
        lines.append(f"CREATE SCHEMA IF NOT EXISTS {_quote_identifier(engine, current_schema)};")

    if content in {"schema", "schema_data"}:
        for current_schema, table_names in tables_by_schema.items():
            for table_name in table_names:
                quoted_table = (
                    f"{_quote_identifier(engine, current_schema)}."
                    f"{_quote_identifier(engine, table_name)}"
                )
                ddl = _build_pg_table_ddl(
                    engine, table_name, current_schema, include_foreign_keys=False
                )
                if not ddl:
                    continue
                lines.extend([f"DROP TABLE IF EXISTS {quoted_table} CASCADE;", ddl, ""])

        for current_schema, table_names in tables_by_schema.items():
            for table_name in table_names:
                quoted_table = (
                    f"{_quote_identifier(engine, current_schema)}."
                    f"{_quote_identifier(engine, table_name)}"
                )
                for constraint_name, constraint_type, definition in _pg_table_constraints(
                    engine, table_name, current_schema
                ):
                    if constraint_type == "f":
                        lines.append(
                            f"ALTER TABLE {quoted_table} ADD CONSTRAINT "
                            f"{_quote_identifier(engine, constraint_name)} {definition};"
                        )
        lines.append("")

    if content != "schema":
        with engine.connect() as connection:
            for current_schema, table_names in tables_by_schema.items():
                for table_name in table_names:
                    columns = inspector.get_columns(table_name, schema=current_schema)
                    if not columns:
                        continue
                    quoted_table = (
                        f"{_quote_identifier(engine, current_schema)}."
                        f"{_quote_identifier(engine, table_name)}"
                    )
                    col_names = [col["name"] for col in columns]
                    result = connection.execute(text(f"SELECT * FROM {quoted_table}"))
                    column_list = ", ".join(_quote_identifier(engine, col) for col in col_names)
                    for row in result:
                        values = ", ".join(_format_value(val) for val in row)
                        lines.append(f"INSERT INTO {quoted_table} ({column_list}) VALUES ({values});")
                    qualified_regclass = (
                        f"{_quote_identifier(engine, current_schema)}."
                        f"{_quote_identifier(engine, table_name)}"
                    )
                    for column in list_columns(engine, table_name, current_schema):
                        if not column.auto_increment:
                            continue
                        quoted_column = _quote_identifier(engine, column.name)
                        sequence_sql = (
                            "SELECT setval(pg_get_serial_sequence("
                            f"{_format_value(qualified_regclass)}, {_format_value(column.name)}), "
                            f"COALESCE(MAX({quoted_column}), 1), COUNT(*) > 0) FROM {quoted_table};"
                        )
                        lines.append(sequence_sql)
                    lines.append("")

    return "\n".join(lines)


def _format_value(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("\\", "\\\\").replace("'", "''")
    return f"'{escaped}'"


class BackupManager:
    def __init__(self) -> None:
        self._backups: dict[str, BackupRecord] = {}
        self._load()

    def list_backups(self, connection_id: str | None = None) -> list[BackupRecord]:
        backups = list(self._backups.values())
        if connection_id:
            backups = [backup for backup in backups if backup.connection_id == connection_id]
        return sorted(backups, key=lambda backup: backup.created_at, reverse=True)

    def create_backup(
        self,
        connection_id: str,
        database: str | None = None,
        output_path: str | None = None,
        pg_database: str | None = None,
    ) -> BackupRecord:
        request = connection_manager.get_connection_request(connection_id)
        engine = connection_manager.get_engine(connection_id)
        info = connection_manager._connections.get(connection_id)
        if info is None or engine is None:
            raise ValueError("连接不存在或已关闭")

        backup_id = f"backup_{uuid4().hex}"
        target_database = (
            pg_database or request.database
            if request.database_type == "postgresql"
            else self._target_database(request, database)
        )
        if not target_database:
            raise ValueError("备份数据库名不能为空")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = _safe_filename(f"{info.name}_{target_database}_{timestamp}")

        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        file_path = Path(output_path).expanduser().resolve() if output_path else BACKUP_DIR / f"{safe_name}.sql"
        file_path.parent.mkdir(parents=True, exist_ok=True)

        if request.database_type == "sqlite":
            sql = _generate_sqlite_backup(request)
        elif request.database_type == "mysql":
            sql = _generate_mysql_backup(engine, target_database)
        elif request.database_type == "postgresql":
            sql = _generate_postgresql_backup(engine, target_database, database)
        elif request.database_type == "clickhouse":
            sql = self._export_clickhouse_sql(engine, target_database, None, "database", "schema_data")
        else:
            raise ValueError("达梦备份暂未接入，请先使用达梦官方工具备份")

        file_path.write_text(sql, encoding="utf-8")
        record = BackupRecord(
            id=backup_id,
            connection_id=connection_id,
            connection_name=info.name,
            database_type=request.database_type,
            database=target_database,
            pg_database=target_database if request.database_type == "postgresql" else None,
            schema_name=database if request.database_type == "postgresql" else None,
            file_path=str(file_path),
            created_at=datetime.now(),
            status="completed",
            message="备份完成",
        )
        self._backups[backup_id] = record
        self._save()
        return record

    def restore_backup(self, backup_id: str) -> BackupRecord:
        record = self._backups.get(backup_id)
        if record is None:
            raise ValueError("备份记录不存在")

        backup_file = Path(record.file_path)
        if not backup_file.exists():
            raise ValueError(f"备份文件不存在：{backup_file}")

        engine = connection_manager.get_engine(record.connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        sql = backup_file.read_text(encoding="utf-8")
        if record.database_type == "postgresql":
            result = execute_sql_file(engine, sql, None, record.pg_database or record.database)
        else:
            result = execute_sql_file(engine, sql, record.database, None)
        if result.failed_count > 0:
            raise ValueError("恢复备份失败：" + "; ".join(result.errors))

        return record

    def export_file(self, connection_id: str, output_path: str, format: ExportFormat, database: str | None = None, pg_database: str | None = None, table: str | None = None, scope: ExportScope = "database", content: ExportContent = "schema_data", columns: list[str] | None = None) -> Path:
        request = connection_manager.get_connection_request(connection_id)
        file_path = Path(output_path).expanduser().resolve()
        file_path.parent.mkdir(parents=True, exist_ok=True)

        if request.database_type == "mongodb" and format == "json" and scope != "table":
            self._export_mongodb(connection_id, file_path, database, table, scope)
            return file_path

        if request.database_type == "redis" and format == "json" and scope != "table":
            self._export_redis(connection_id, file_path, database, table, scope)
            return file_path

        if format == "sql":
            self._export_sql(connection_id, database, pg_database, table, scope, file_path, content, columns)
            return file_path

        if format == "csv":
            self._export_csv(connection_id, file_path, database, pg_database, table, scope, columns)
            return file_path

        self._export_structured_tables(
            connection_id,
            file_path,
            format,
            database,
            pg_database,
            table,
            scope,
            columns,
        )
        return file_path

    def export_result_data(self, request: ResultExportRequest) -> Path:
        engine = connection_manager.get_engine(request.connection_id)
        if engine is None:
            raise ValueError("连接已关闭")
        if request.source == "query" and request.format == "sql":
            raise ValueError("查询结果不支持导出为 SQL")
        if request.data_scope == "all":
            return self._export_all_result_data(engine, request)

        limit = request.limit if request.data_scope == "current_page" else None
        offset = request.offset if request.data_scope == "current_page" else 0
        if request.source == "query":
            if not request.sql or not request.sql.strip():
                raise ValueError("没有可导出的查询语句")
            result = execute_readonly_query(
                engine,
                request.sql,
                limit,
                offset,
                request.database,
                request.pg_database,
            )
        else:
            if not request.table:
                raise ValueError("没有可导出的表")
            result = preview_table(
                engine,
                request.table,
                limit,
                offset,
                request.database,
                request.pg_database,
                request.where,
                request.sort_column,
                request.sort_direction,
            )

        selected_columns = self._validated_columns(result.columns, request.columns)
        file_path = Path(request.output_path).expanduser().resolve()
        table_name = None
        if request.source == "table" and request.table:
            preparer = engine.dialect.identifier_preparer
            quoted_table = preparer.quote(request.table)
            table_name = (
                f"{preparer.quote(request.database)}.{quoted_table}"
                if request.database
                else quoted_table
            )
        if request.format == "sql" and request.source == "table" and request.table:
            ddl = get_object_ddl(
                engine,
                request.table,
                "table",
                request.database,
                request.pg_database,
            ).rstrip()
            if not ddl:
                raise ValueError("无法读取表结构")
            inserts = render_sql_inserts(
                selected_columns,
                result.rows,
                table_name or request.table,
                engine.dialect.identifier_preparer.quote,
            )
            normalized_ddl = ddl if ddl.endswith(";") else f"{ddl};"
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(
                f"{normalized_ddl}\n\n{inserts}",
                encoding="utf-8",
            )
            return file_path
        write_tabular_export(
            file_path,
            request.format,
            selected_columns,
            result.rows,
            table_name=table_name,
            quote_identifier=engine.dialect.identifier_preparer.quote,
        )
        return file_path

    def _export_all_result_data(self, engine, request: ResultExportRequest) -> Path:
        if request.source == "query":
            if not request.sql or not request.sql.strip():
                raise ValueError("没有可导出的查询语句")

            def load_page(offset: int):
                return execute_readonly_query(
                    engine,
                    request.sql,
                    1000,
                    offset,
                    request.database,
                    request.pg_database,
                )
        else:
            if not request.table:
                raise ValueError("没有可导出的表")

            def load_page(offset: int):
                return preview_table(
                    engine,
                    request.table,
                    1000,
                    offset,
                    request.database,
                    request.pg_database,
                    request.where,
                    request.sort_column,
                    request.sort_direction,
                )

        first_page = load_page(0)
        selected_columns = self._validated_columns(first_page.columns, request.columns)
        file_path = Path(request.output_path).expanduser().resolve()
        file_path.parent.mkdir(parents=True, exist_ok=True)
        table_name = None
        if request.source == "table" and request.table:
            preparer = engine.dialect.identifier_preparer
            quoted_table = preparer.quote(request.table)
            table_name = (
                f"{preparer.quote(request.database)}.{quoted_table}"
                if request.database
                else quoted_table
            )

        if request.format == "sql":
            ddl = get_object_ddl(
                engine,
                request.table,
                "table",
                request.database,
                request.pg_database,
            ).rstrip()
            if not ddl:
                raise ValueError("无法读取表结构")
            quote = engine.dialect.identifier_preparer.quote
            with file_path.open("w", encoding="utf-8") as output:
                output.write(ddl if ddl.endswith(";") else f"{ddl};")
                output.write("\n\n")
                self._write_sql_result_pages(
                    output,
                    load_page,
                    first_page,
                    selected_columns,
                    table_name or request.table,
                    quote,
                )
            return file_path

        if request.format == "json":
            with file_path.open("w", encoding="utf-8") as output:
                output.write("[")
                first_row = True
                offset = 0
                page = first_page
                while True:
                    for row in page.rows:
                        if not first_row:
                            output.write(",")
                        first_row = False
                        json.dump(
                            selected_export_row(selected_columns, row),
                            output,
                            ensure_ascii=False,
                        )
                    if not page.limited or not page.rows:
                        break
                    offset += len(page.rows)
                    page = load_page(offset)
                output.write("]")
            return file_path

        if request.format == "csv":
            offset = 0
            page = first_page
            append = False
            while True:
                write_csv_rows(file_path, selected_columns, page.rows, append=append)
                append = True
                if not page.limited or not page.rows:
                    return file_path
                offset += len(page.rows)
                page = load_page(offset)

        if request.format == "markdown":
            with file_path.open("w", encoding="utf-8") as output:
                offset = 0
                page = first_page
                include_header = True
                while True:
                    write_markdown_table_stream(
                        output,
                        selected_columns,
                        page.rows,
                        include_header=include_header,
                    )
                    include_header = False
                    if not page.limited or not page.rows:
                        break
                    offset += len(page.rows)
                    page = load_page(offset)
            return file_path

        raise ValueError(f"不支持的导出格式：{request.format}")

    @staticmethod
    def _write_sql_result_pages(
        output,
        load_page,
        first_page,
        columns: list[str],
        table_name: str,
        quote_identifier,
    ) -> None:
        offset = 0
        page = first_page
        while True:
            output.write(render_sql_inserts(columns, page.rows, table_name, quote_identifier))
            if not page.limited or not page.rows:
                return
            offset += len(page.rows)
            page = load_page(offset)

    @staticmethod
    def _validated_columns(available: list[str], selected: list[str] | None) -> list[str]:
        requested = selected or available
        invalid = [column for column in requested if column not in available]
        if invalid:
            raise ValueError(f"导出列不存在：{', '.join(invalid)}")
        if not requested:
            raise ValueError("请至少选择一个导出列")
        return requested

    @staticmethod
    def _export_table_targets(
        engine,
        database: str | None,
        pg_database: str | None,
        table: str | None,
        scope: ExportScope,
    ) -> list[tuple[str, str | None, str]]:
        if scope == "table" and table:
            return [(table, database, table)]

        if (
            scope == "database"
            and pg_database
            and not database
            and engine.dialect.name in {"postgresql", "gaussdb"}
        ):
            targets: list[tuple[str, str | None, str]] = []
            for schema in list_schemas(engine, pg_database):
                targets.extend(
                    (f"{schema.name}.{item.name}", schema.name, item.name)
                    for item in list_tables(engine, schema.name, pg_database)
                )
            return targets

        return [
            (item.name, database, item.name)
            for item in list_tables(engine, database, pg_database)
        ]

    def import_file(self, connection_id: str, input_path: str, database: str | None = None, pg_database: str | None = None, table: str | None = None) -> Path:
        file_path = Path(input_path).expanduser().resolve()
        if not file_path.exists():
            raise ValueError(f"导入文件不存在：{file_path}")

        suffix = file_path.suffix.lower()
        if suffix == ".sql":
            engine = connection_manager.get_engine(connection_id)
            if engine is None:
                raise ValueError("连接已关闭，请先打开连接")
            sql = file_path.read_text(encoding="utf-8")
            result = execute_sql_file(engine, sql, database, pg_database)
            if result.failed_count > 0:
                raise ValueError("SQL 导入失败：" + "; ".join(result.errors))
            return file_path

        if suffix == ".csv":
            if not table:
                table = file_path.stem
            self._import_csv(connection_id, file_path, database, pg_database, table)
            return file_path

        raise ValueError("仅支持导入 .sql 或 .csv 文件")

    def _load(self) -> None:
        if not BACKUP_STORE_PATH.exists():
            return
        data = json.loads(BACKUP_STORE_PATH.read_text(encoding="utf-8"))
        for item in data.get("backups", []):
            record = BackupRecord.model_validate(item)
            self._backups[record.id] = record

    def _save(self) -> None:
        BACKUP_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {"backups": [backup.model_dump(mode="json") for backup in self._backups.values()]}
        BACKUP_STORE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _target_database(self, request: ConnectionRequest, database: str | None) -> str:
        if request.database_type == "sqlite":
            if not request.sqlite_path:
                raise ValueError("SQLite 文件路径不能为空")
            return Path(request.sqlite_path).stem

        target = database or request.database
        if not target:
            raise ValueError("备份数据库名不能为空")
        return target

    def _export_mongodb(self, connection_id: str, file_path: Path, database: str | None, table: str | None, scope: ExportScope) -> None:
        client = connection_manager.get_engine(connection_id)
        if client is None or not is_mongo_client(client):
            raise ValueError("MongoDB 连接已关闭")
        if not database:
            raise ValueError("请选择 MongoDB 数据库")

        db = client[database]
        collections = [table] if scope == "table" and table else db.list_collection_names()
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as output:
            output.write('{"database":')
            json.dump(database, output, ensure_ascii=False)
            output.write(',"collections":{')
            for collection_index, collection in enumerate(collections):
                if collection_index:
                    output.write(",")
                json.dump(collection, output, ensure_ascii=False)
                output.write(":[")
                for document_index, document in enumerate(db[collection].find({})):
                    if document_index:
                        output.write(",")
                    json.dump(
                        serialize_mongo_document(document), output, ensure_ascii=False, default=str
                    )
                output.write("]")
            output.write("}}")

    def _export_redis(self, connection_id: str, file_path: Path, database: str | None, table: str | None, scope: ExportScope) -> None:
        client = connection_manager.get_engine(connection_id)
        if client is None or not is_redis_client(client):
            raise ValueError("Redis 连接已关闭")

        target = redis_client_for_database(client, database)
        try:
            keys = (table,) if scope == "table" and table else target.scan_iter(count=500)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with file_path.open("w", encoding="utf-8") as output:
                output.write('{"database":')
                json.dump(database or "current", output, ensure_ascii=False)
                output.write(',"keys":{')
                first = True
                for raw_key in keys:
                    key = redis_text(raw_key)
                    if not first:
                        output.write(",")
                    first = False
                    json.dump(key, output, ensure_ascii=False)
                    output.write(":")
                    key_type = redis_text(target.type(key))
                    if key_type == "string":
                        value = target.get(key)
                    elif key_type == "hash":
                        value = target.hgetall(key)
                    elif key_type == "list":
                        value = target.lrange(key, 0, -1)
                    elif key_type == "set":
                        value = list(target.smembers(key))
                    elif key_type == "zset":
                        value = target.zrange(key, 0, -1, withscores=True)
                    elif key_type == "stream":
                        value = target.xrange(key)
                    else:
                        value = None
                    json.dump(
                        {
                            "type": key_type,
                            "ttl": target.ttl(key),
                            "value": serialize_redis_value(value),
                        },
                        output,
                        ensure_ascii=False,
                        default=str,
                    )
                output.write("}}")
        finally:
            if target is not client:
                target.close()

    def _export_sql(self, connection_id: str, database: str | None, pg_database: str | None, table: str | None, scope: ExportScope, file_path: Path, content: ExportContent, columns: list[str] | None = None) -> None:
        request = connection_manager.get_connection_request(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        if scope == "database" and request.database_type == "sqlite":
            file_path.write_text(_generate_sqlite_backup(request), encoding="utf-8")
            return
        if scope == "database" and request.database_type == "mysql":
            target_database = database or request.database
            if not target_database:
                raise ValueError("导出数据库名不能为空")
            file_path.write_text(
                _generate_mysql_backup(engine, target_database, content),
                encoding="utf-8",
            )
            return
        if scope == "database" and request.database_type == "clickhouse":
            target_database = database or request.database or "default"
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with file_path.open("w", encoding="utf-8") as output:
                if not self._export_clickhouse_sql(
                    engine, target_database, None, scope, content, output
                ):
                    raise ValueError("无法生成 SQL 导出")
            return

        targets = self._export_table_targets(
            engine,
            database,
            pg_database,
            table,
            scope,
        )
        if not targets:
            raise ValueError("无法生成 SQL 导出")

        preparer = engine.dialect.identifier_preparer
        file_path.parent.mkdir(parents=True, exist_ok=True)
        wrote_content = False
        with file_path.open("w", encoding="utf-8") as output:
            for _, target_schema, table_name in targets:
                if wrote_content:
                    output.write("\n\n")
                if scope == "table" or content in {"schema", "schema_data"}:
                    ddl = get_object_ddl(
                        engine,
                        table_name,
                        "table",
                        target_schema,
                        pg_database,
                    ).rstrip()
                    if ddl:
                        output.write(ddl if ddl.endswith(";") else f"{ddl};")
                        wrote_content = True
                if content == "schema":
                    continue
                first_page = preview_table(
                    engine, table_name, 1000, 0, target_schema, pg_database
                )
                selected = self._validated_columns(
                    first_page.columns,
                    columns if scope == "table" else None,
                )
                quoted_table = preparer.quote(table_name)
                if target_schema and request.database_type != "sqlite":
                    quoted_table = f"{preparer.quote(target_schema)}.{quoted_table}"
                offset = 0
                page = first_page
                while True:
                    inserts = render_sql_inserts(
                        selected, page.rows, quoted_table, preparer.quote
                    )
                    if inserts:
                        if wrote_content:
                            output.write("\n\n")
                        output.write(inserts.rstrip())
                        wrote_content = True
                    if not page.limited or not page.rows:
                        break
                    offset += len(page.rows)
                    page = preview_table(
                        engine, table_name, 1000, offset, target_schema, pg_database
                    )

        if not wrote_content:
            raise ValueError("无法生成 SQL 导出")

    def _export_clickhouse_sql(
        self,
        engine,
        database: str,
        table: str | None,
        scope: ExportScope,
        content: ExportContent,
        output,
    ) -> bool:
        tables = [table] if scope == "table" and table else []
        wrote_content = False

        with engine.connect() as connection:
            if not tables:
                rows = connection.execute(text("SELECT name FROM system.tables WHERE database = :database AND is_temporary = 0 ORDER BY name"), {"database": database}).fetchall()
                tables = [str(row[0]) for row in rows]

            for table_name in tables:
                quoted = _qualified_table_name(engine, database, table_name)
                if content in {"schema", "schema_data"}:
                    row = connection.execute(text(f"SHOW CREATE TABLE {quoted}")).fetchone()
                    if row and row[0]:
                        if wrote_content:
                            output.write("\n")
                        output.write(f"DROP TABLE IF EXISTS {quoted};\n{row[0]};\n")
                        wrote_content = True

                if content == "schema":
                    continue

                result = connection.execute(text(f"SELECT * FROM {quoted}"))
                columns = list(result.keys())
                if not columns:
                    continue
                column_list = ", ".join(_quote_identifier(engine, column) for column in columns)
                for row in result:
                    values = ", ".join(_format_value(value) for value in row)
                    output.write(f"INSERT INTO {quoted} ({column_list}) VALUES ({values});\n")
                    wrote_content = True

        return wrote_content

    def _export_csv(self, connection_id: str, output_path: Path, database: str | None, pg_database: str | None, table: str | None, scope: ExportScope, columns: list[str] | None = None) -> None:
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        targets = self._export_table_targets(engine, database, pg_database, table, scope)
        if not targets:
            raise ValueError("未找到可导出的表")

        if len(targets) == 1 and output_path.suffix.lower() == ".csv":
            label, target_schema, table_name = targets[0]
            self._export_csv_table(
                engine, output_path, target_schema, table_name, pg_database, columns
            )
            return

        output_path.mkdir(parents=True, exist_ok=True)
        for label, target_schema, table_name in targets:
            self._export_csv_table(
                engine,
                output_path / f"{_safe_filename(label)}.csv",
                target_schema,
                table_name,
                pg_database,
                columns if len(targets) == 1 else None,
            )

    def _export_csv_table(
        self,
        engine,
        output_path: Path,
        target_schema: str | None,
        table_name: str,
        pg_database: str | None,
        columns: list[str] | None,
    ) -> None:
        offset = 0
        append = False
        selected: list[str] | None = None
        while True:
            result = preview_table(
                engine, table_name, 1000, offset, target_schema, pg_database
            )
            if selected is None:
                selected = self._validated_columns(result.columns, columns)
            write_csv_rows(output_path, selected, result.rows, append=append)
            append = True
            offset += len(result.rows)
            if not result.limited or not result.rows:
                return

    def _export_structured_tables(
        self,
        connection_id: str,
        output_path: Path,
        export_format: ExportFormat,
        database: str | None,
        pg_database: str | None,
        table: str | None,
        scope: ExportScope,
        columns: list[str] | None,
    ) -> None:
        if export_format not in {"json", "markdown"}:
            raise ValueError(f"不支持的导出格式：{export_format}")
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        targets = self._export_table_targets(engine, database, pg_database, table, scope)
        if not targets:
            raise ValueError("未找到可导出的表")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as output:
            if export_format == "json":
                single_table = scope == "table" and len(targets) == 1
                if single_table:
                    output.write("[")
                else:
                    output.write('{"tables":{')
                for index, (label, target_schema, table_name) in enumerate(targets):
                    if index and not single_table:
                        output.write(",")
                    if not single_table:
                        json.dump(label, output, ensure_ascii=False)
                        output.write(":")
                    first_page = preview_table(
                        engine, table_name, 1000, 0, target_schema, pg_database
                    )
                    selected = self._validated_columns(
                        first_page.columns, columns if scope == "table" else None
                    )
                    self._write_json_table_rows(
                        output, engine, table_name, target_schema, pg_database, selected, first_page
                    )
                output.write("]" if single_table else "}}")
                return

            for index, (label, target_schema, table_name) in enumerate(targets):
                if index:
                    output.write("\n")
                output.write(f"## {label}\n\n")
                first_page = preview_table(
                    engine, table_name, 1000, 0, target_schema, pg_database
                )
                selected = self._validated_columns(
                    first_page.columns, columns if scope == "table" else None
                )
                self._write_markdown_table_rows(
                    output, engine, table_name, target_schema, pg_database, selected, first_page
                )

    @staticmethod
    def _write_json_table_rows(
        output,
        engine,
        table_name: str,
        database: str | None,
        pg_database: str | None,
        columns: list[str],
        first_page,
    ) -> None:
        first_row = True
        offset = 0
        page = first_page
        while True:
            for row in page.rows:
                if not first_row:
                    output.write(",")
                first_row = False
                json.dump(
                    {column: row.get(column) for column in columns},
                    output,
                    ensure_ascii=False,
                    default=str,
                )
            if not page.limited or not page.rows:
                return
            offset += len(page.rows)
            page = preview_table(engine, table_name, 1000, offset, database, pg_database)

    @staticmethod
    def _write_markdown_table_rows(
        output,
        engine,
        table_name: str,
        database: str | None,
        pg_database: str | None,
        columns: list[str],
        first_page,
    ) -> None:
        offset = 0
        page = first_page
        include_header = True
        while True:
            write_markdown_table_stream(
                output,
                columns,
                ({column: row.get(column) for column in columns} for row in page.rows),
                include_header=include_header,
            )
            include_header = False
            if not page.limited or not page.rows:
                return
            offset += len(page.rows)
            page = preview_table(engine, table_name, 1000, offset, database, pg_database)

    def _import_csv(self, connection_id: str, file_path: Path, database: str | None, pg_database: str | None, table: str) -> None:
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")
        if pg_database and engine.dialect.name == "postgresql":
            pg_engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            try:
                return self._import_csv_with_engine(pg_engine, file_path, database, table)
            finally:
                pg_engine.dispose()
        self._import_csv_with_engine(engine, file_path, database, table)

    def _import_csv_with_engine(self, engine, file_path: Path, database: str | None, table: str) -> None:
        with file_path.open("r", encoding="utf-8-sig", newline="") as input_file:
            reader = csv.DictReader(input_file)
            columns = reader.fieldnames or []
            if not columns:
                raise ValueError("CSV 文件缺少表头")
            preparer = engine.dialect.identifier_preparer
            quoted_table = preparer.quote(table)
            if engine.dialect.name == "postgresql" and database:
                quoted_table = f"{preparer.quote(database)}.{quoted_table}"
            elif (engine.dialect.name == "mysql" or _is_clickhouse_engine(engine)) and database:
                quoted_table = f"{preparer.quote(database)}.{quoted_table}"
            column_sql = ", ".join(preparer.quote(column) for column in columns)
            value_sql = ", ".join(f":{column}" for column in columns)
            statement = text(f"INSERT INTO {quoted_table} ({column_sql}) VALUES ({value_sql})")
            with engine.begin() as connection:
                while rows := list(islice(reader, 1000)):
                    values = [
                        {
                            column: None if value is None else parse_csv_text_value(value)
                            for column, value in row.items()
                            if column is not None
                        }
                        for row in rows
                    ]
                    connection.execute(statement, values)


backup_manager = BackupManager()
