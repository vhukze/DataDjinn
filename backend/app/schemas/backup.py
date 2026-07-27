from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.connection import DatabaseType


BackupStatus = Literal["completed", "failed"]
ExportFormat = Literal["sql", "csv", "json", "markdown"]
ExportScope = Literal["database", "schema", "table"]
ExportContent = Literal["schema", "data", "schema_data"]
ResultExportSource = Literal["query", "table"]
ResultExportDataScope = Literal["current_page", "all"]


class BackupRecord(BaseModel):
    id: str
    connection_id: str
    connection_name: str
    database_type: DatabaseType
    database: str
    file_path: str
    created_at: datetime
    status: BackupStatus
    message: str | None = None


class BackupListResponse(BaseModel):
    backups: list[BackupRecord]


class BackupCreateRequest(BaseModel):
    connection_id: str
    database: str | None = None
    pg_database: str | None = None
    output_path: str | None = None


class RestoreBackupRequest(BaseModel):
    backup_id: str


class ExportRequest(BaseModel):
    connection_id: str
    database: str | None = None
    pg_database: str | None = None
    table: str | None = None
    scope: ExportScope = "database"
    format: ExportFormat = "sql"
    content: ExportContent = "schema_data"
    columns: list[str] | None = None
    output_path: str = Field(min_length=1)


class ResultExportRequest(BaseModel):
    connection_id: str
    source: ResultExportSource
    format: ExportFormat
    output_path: str = Field(min_length=1)
    columns: list[str] = Field(min_length=1)
    data_scope: ResultExportDataScope = "current_page"
    sql: str | None = None
    table: str | None = None
    database: str | None = None
    pg_database: str | None = None
    where: str | None = None
    sort_column: str | None = None
    sort_direction: Literal["ascend", "descend"] | None = None
    limit: int = Field(default=300, ge=1, le=10000)
    offset: int = Field(default=0, ge=0)


class ImportRequest(BaseModel):
    connection_id: str
    input_path: str = Field(min_length=1)
    database: str | None = None
    pg_database: str | None = None
    table: str | None = None


class FileOperationResponse(BaseModel):
    success: bool
    message: str
    file_path: str | None = None
    backup: BackupRecord | None = None
