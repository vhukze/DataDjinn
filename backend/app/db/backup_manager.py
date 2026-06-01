import csv
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, inspect, text

from app.db.connection_manager import _resolve_runtime_path, connection_manager
from app.db.mongo_utils import is_mongo_client, serialize_mongo_document
from app.db.redis_utils import is_redis_client, redis_client_for_database, redis_scan_keys, redis_text, serialize_redis_value
from app.db.sql_executor import execute_sql_file
from app.schemas.backup import BackupRecord, ExportContent, ExportFormat, ExportScope
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


def _generate_postgresql_backup(engine, database: str, schema_name: str = "public", content: ExportContent = "schema_data") -> str:
    pg_engine = create_engine(engine.url.set(database=database), pool_pre_ping=True)
    try:
        return _generate_postgresql_backup_internal(pg_engine, schema_name, content)
    finally:
        pg_engine.dispose()


def _generate_postgresql_backup_internal(engine, schema_name: str, content: ExportContent = "schema_data") -> str:
    lines: list[str] = []
    inspector = inspect(engine)

    with engine.connect() as connection:
        connection.execute(text(f"SET search_path TO {_quote_identifier(engine, schema_name)}"))
        tables = inspector.get_table_names(schema=schema_name)

        for table_name in tables:
            columns = inspector.get_columns(table_name, schema=schema_name)
            if not columns:
                continue

            col_defs: list[str] = []
            pk_columns: list[str] = []
            for col in columns:
                col_def = f"{_quote_identifier(engine, col['name'])} {col['type']}"
                if not col.get("nullable", True):
                    col_def += " NOT NULL"
                col_defs.append(col_def)
                if col.get("primary_key"):
                    pk_columns.append(col["name"])

            if pk_columns:
                pk_list = ", ".join(_quote_identifier(engine, pk) for pk in pk_columns)
                col_defs.append(f"PRIMARY KEY ({pk_list})")

            quoted_table = f"{_quote_identifier(engine, schema_name)}.{_quote_identifier(engine, table_name)}"
            if content in {"schema", "schema_data"}:
                lines.append(f"DROP TABLE IF EXISTS {quoted_table} CASCADE;")
                lines.append(f"CREATE TABLE {quoted_table} (\n  {',\n  '.join(col_defs)}\n);")
                lines.append("")

            if content == "schema":
                continue

            col_names = [col["name"] for col in columns]
            result = connection.execute(text(f"SELECT * FROM {quoted_table}"))
            column_list = ", ".join(_quote_identifier(engine, col) for col in col_names)
            for row in result:
                values = ", ".join(_format_value(val) for val in row)
                lines.append(f"INSERT INTO {quoted_table} ({column_list}) VALUES ({values});")

            lines.append("")

    return "\n".join(lines)


def _format_value(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
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

    def create_backup(self, connection_id: str, database: str | None = None, output_path: str | None = None) -> BackupRecord:
        request = connection_manager.get_connection_request(connection_id)
        engine = connection_manager.get_engine(connection_id)
        info = connection_manager._connections.get(connection_id)
        if info is None or engine is None:
            raise ValueError("连接不存在或已关闭")

        backup_id = f"backup_{uuid4().hex}"
        target_database = self._target_database(request, database)
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
            pg_db = database or request.database
            if not pg_db:
                raise ValueError("PostgreSQL 备份需要指定数据库名")
            sql = _generate_postgresql_backup(engine, pg_db, target_database if target_database != pg_db else "public")
        else:
            raise ValueError("达梦备份暂未接入，请先使用达梦官方工具备份")

        file_path.write_text(sql, encoding="utf-8")
        record = BackupRecord(
            id=backup_id,
            connection_id=connection_id,
            connection_name=info.name,
            database_type=request.database_type,
            database=target_database,
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
        result = execute_sql_file(engine, sql, record.database, None)
        if result.failed_count > 0:
            raise ValueError("恢复备份失败：" + "; ".join(result.errors))

        return record

    def export_file(self, connection_id: str, output_path: str, format: ExportFormat, database: str | None = None, pg_database: str | None = None, table: str | None = None, scope: ExportScope = "database", content: ExportContent = "schema_data") -> Path:
        request = connection_manager.get_connection_request(connection_id)
        target_database = pg_database or self._target_database(request, database)
        file_path = Path(output_path).expanduser().resolve()
        file_path.parent.mkdir(parents=True, exist_ok=True)

        if request.database_type == "mongodb":
            self._export_mongodb(connection_id, file_path, database, table, scope)
            return file_path

        if request.database_type == "redis":
            self._export_redis(connection_id, file_path, database, table, scope)
            return file_path

        if format == "sql":
            self._export_sql(connection_id, target_database, table, scope, file_path, content)
            return file_path

        self._export_csv(connection_id, file_path, database, pg_database, table, scope)
        return file_path

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
        documents_by_collection = {
            collection: [serialize_mongo_document(document) for document in db[collection].find({})]
            for collection in collections
        }
        file_path.write_text(json.dumps({"database": database, "collections": documents_by_collection}, ensure_ascii=False, indent=2), encoding="utf-8")

    def _export_redis(self, connection_id: str, file_path: Path, database: str | None, table: str | None, scope: ExportScope) -> None:
        client = connection_manager.get_engine(connection_id)
        if client is None or not is_redis_client(client):
            raise ValueError("Redis 连接已关闭")

        target = redis_client_for_database(client, database)
        try:
            keys = [table] if scope == "table" and table else redis_scan_keys(target, 100000)
            data = {}
            for key in keys:
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
                data[key] = {"type": key_type, "ttl": target.ttl(key), "value": serialize_redis_value(value)}
            file_path.write_text(json.dumps({"database": database or "current", "keys": data}, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            if target is not client:
                target.close()

    def _export_sql(self, connection_id: str, database: str, table: str | None, scope: ExportScope, file_path: Path, content: ExportContent) -> None:
        request = connection_manager.get_connection_request(connection_id)
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        if request.database_type == "sqlite":
            sql = _generate_sqlite_backup(request)
            file_path.write_text(sql, encoding="utf-8")
            return

        if scope == "table" and table:
            sql = self._export_single_table_sql(engine, request.database_type, database, table, content)
        elif request.database_type == "mysql":
            sql = _generate_mysql_backup(engine, database, content)
        elif request.database_type == "postgresql":
            sql = _generate_postgresql_backup(engine, database, database if scope == "database" else "public", content)
        else:
            raise ValueError("不支持的数据库类型")

        if not sql:
            raise ValueError("无法生成 SQL 导出")
        file_path.write_text(sql, encoding="utf-8")

    def _export_single_table_sql(self, engine, db_type: str, database: str, table: str, content: ExportContent) -> str:
        lines: list[str] = []

        with engine.connect() as connection:
            inspector = inspect(connection)
            if db_type == "postgresql":
                connection.execute(text(f"SET search_path TO {_quote_identifier(engine, database)}"))

            if db_type == "mysql":
                quoted = _mysql_table_name(engine, database, table)
                result = connection.execute(text(f"SHOW CREATE TABLE {quoted}"))
                row = result.fetchone()
                if content in {"schema", "schema_data"} and row and len(row) >= 2:
                    lines.append(f"DROP TABLE IF EXISTS {quoted};")
                    lines.append(f"{row[1]};")
            elif db_type == "postgresql":
                columns = inspector.get_columns(table, schema=database)
                col_defs = []
                pk_cols = []
                for col in columns:
                    cd = f"{_quote_identifier(engine, col['name'])} {col['type']}"
                    if not col.get("nullable", True):
                        cd += " NOT NULL"
                    col_defs.append(cd)
                    if col.get("primary_key"):
                        pk_cols.append(col["name"])
                if pk_cols:
                    col_defs.append(f"PRIMARY KEY ({', '.join(_quote_identifier(engine, pk) for pk in pk_cols)})")
                quoted = f"{_quote_identifier(engine, database)}.{_quote_identifier(engine, table)}"
                if content in {"schema", "schema_data"}:
                    lines.append(f"DROP TABLE IF EXISTS {quoted} CASCADE;")
                    lines.append(f"CREATE TABLE {quoted} (\n  {',\n  '.join(col_defs)}\n);")

            lines.append("")
            if content == "schema":
                return "\n".join(lines)

            cols = [c["name"] for c in inspector.get_columns(table, schema=database)]
            quoted_tbl = f"{_quote_identifier(engine, database)}.{_quote_identifier(engine, table)}" if db_type == "postgresql" else _mysql_table_name(engine, database, table)
            result = connection.execute(text(f"SELECT * FROM {quoted_tbl}"))
            col_list = ", ".join(_quote_identifier(engine, c) for c in cols)
            for row in result:
                values = ", ".join(_format_value(v) for v in row)
                lines.append(f"INSERT INTO {quoted_tbl} ({col_list}) VALUES ({values});")

        return "\n".join(lines)

    def _export_csv(self, connection_id: str, output_path: Path, database: str | None, pg_database: str | None, table: str | None, scope: ExportScope) -> None:
        engine = connection_manager.get_engine(connection_id)
        if engine is None:
            raise ValueError("连接已关闭")

        inspector = inspect(engine)
        schema = database if engine.dialect.name in {"mysql", "postgresql", "dm", "dmPython"} else None
        tables = [table] if scope == "table" and table else inspector.get_table_names(schema=schema)
        if not tables:
            raise ValueError("未找到可导出的表")

        if len(tables) == 1 and output_path.suffix.lower() == ".csv":
            self._write_table_csv(engine, output_path, tables[0], database, pg_database)
            return

        output_path.mkdir(parents=True, exist_ok=True)
        for table_name in tables:
            self._write_table_csv(engine, output_path / f"{_safe_filename(table_name)}.csv", table_name, database, pg_database)

    def _write_table_csv(self, engine, file_path: Path, table_name: str, database: str | None, pg_database: str | None) -> None:
        preparer = engine.dialect.identifier_preparer
        quoted_table = preparer.quote(table_name)
        if engine.dialect.name == "postgresql" and database:
            quoted_table = f"{preparer.quote(database)}.{quoted_table}"
        elif engine.dialect.name == "mysql" and database:
            quoted_table = f"{preparer.quote(database)}.{quoted_table}"

        with engine.connect() as connection:
            if pg_database and engine.dialect.name == "postgresql":
                pg_engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
                try:
                    return self._write_table_csv(pg_engine, file_path, table_name, database, None)
                finally:
                    pg_engine.dispose()
            result = connection.execute(text(f"SELECT * FROM {quoted_table}"))
            with file_path.open("w", encoding="utf-8-sig", newline="") as output:
                writer = csv.writer(output)
                writer.writerow(list(result.keys()))
                for row in result:
                    writer.writerow(list(row))

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
            elif engine.dialect.name == "mysql" and database:
                quoted_table = f"{preparer.quote(database)}.{quoted_table}"
            column_sql = ", ".join(preparer.quote(column) for column in columns)
            value_sql = ", ".join(f":{column}" for column in columns)
            statement = text(f"INSERT INTO {quoted_table} ({column_sql}) VALUES ({value_sql})")
            with engine.begin() as connection:
                rows = [row for row in reader]
                if rows:
                    connection.execute(statement, rows)


backup_manager = BackupManager()
