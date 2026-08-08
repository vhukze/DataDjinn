from typing import Any

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    connection_id: str
    sql: str = Field(min_length=1)
    limit: int = Field(default=1000, ge=1, le=10000)
    offset: int = Field(default=0, ge=0)
    database: str | None = None
    pg_database: str | None = None


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    limited: bool
    total_count: int | None = None
    sort_column: str | None = None
    sort_direction: str | None = None
    column_origins: dict[str, "QueryColumnOrigin"] = Field(default_factory=dict)


class QueryColumnOrigin(BaseModel):
    table_name: str
    column_name: str
    database_name: str | None = None


class QueryRowUpdate(BaseModel):
    original: dict[str, Any]
    values: dict[str, Any]


class QueryDataChangeRequest(BaseModel):
    connection_id: str
    sql: str = Field(min_length=1)
    database: str | None = None
    pg_database: str | None = None
    updated: list[QueryRowUpdate] = Field(default_factory=list)


class QueryDataChangeResponse(BaseModel):
    updated_count: int


class QueryCountRequest(BaseModel):
    connection_id: str
    sql: str = Field(min_length=1)
    database: str | None = None
    pg_database: str | None = None


class QueryCountResponse(BaseModel):
    total_count: int


class SqlFileRunRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=5 * 1024 * 1024)
    database: str | None = None
    pg_database: str | None = None


class SqlFileRunResponse(BaseModel):
    success_count: int
    failed_count: int
    errors: list[str]
