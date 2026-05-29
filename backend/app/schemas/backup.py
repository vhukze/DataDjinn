from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.connection import DatabaseType


BackupStatus = Literal["completed", "failed"]
ExportFormat = Literal["sql", "csv"]
ExportScope = Literal["database", "schema", "table"]
ExportContent = Literal["schema", "data", "schema_data"]


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
    output_path: str = Field(min_length=1)


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
