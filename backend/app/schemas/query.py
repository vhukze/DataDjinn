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
