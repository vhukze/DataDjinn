from typing import Any

from pydantic import BaseModel, Field


class DatabaseInfo(BaseModel):
    name: str
    size_bytes: int | None = None
    size_display: str | None = None
    storage_size_bytes: int | None = None
    storage_size_display: str | None = None


class TableInfo(BaseModel):
    name: str
    comment: str | None = None
    size_bytes: int | None = None
    size_display: str | None = None
    storage_size_bytes: int | None = None
    storage_size_display: str | None = None
    row_count: int | None = None


class DbObjectInfo(BaseModel):
    name: str
    type: str
    comment: str | None = None
    size_bytes: int | None = None
    size_display: str | None = None
    storage_size_bytes: int | None = None
    storage_size_display: str | None = None
    row_count: int | None = None


class ColumnInfo(BaseModel):
    name: str
    type: str
    nullable: bool
    primary_key: bool
    default_value: str | None = None
    comment: str | None = None
    unique: bool = False
    auto_increment: bool = False
    auto_increment_step: int | None = None
    minimum: str | None = None
    maximum: str | None = None


class TableUpdateColumn(BaseModel):
    name: str
    type: str = Field(min_length=1, max_length=80)
    nullable: bool
    primary_key: bool
    comment: str | None = Field(default=None, max_length=500)
    unique: bool = False
    auto_increment: bool = False
    auto_increment_step: int | None = Field(default=None, ge=1, le=1_000_000)
    minimum: str | None = Field(default=None, max_length=64)
    maximum: str | None = Field(default=None, max_length=64)


class TableUpdateRequest(BaseModel):
    columns: list[TableUpdateColumn] = Field(min_length=1)
    table_comment: str | None = Field(default=None, max_length=1000)


class TableCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    columns: list[TableUpdateColumn] = Field(default_factory=list)
    database: str | None = None
    pg_database: str | None = None
    table_comment: str | None = Field(default=None, max_length=1000)


class TableCreateResponse(BaseModel):
    name: str
    message: str


class TableRowUpdate(BaseModel):
    original: dict[str, Any]
    values: dict[str, Any]


class TableDataChangeRequest(BaseModel):
    inserted: list[dict[str, Any]] = Field(default_factory=list)
    updated: list[TableRowUpdate] = Field(default_factory=list)
    deleted: list[dict[str, Any]] = Field(default_factory=list)


class RedisKeyUpdate(BaseModel):
    key: str = Field(min_length=1)
    type: str
    value: Any = None
    ttl: int | None = None
    original_key: str | None = None


class RedisDataChangeRequest(BaseModel):
    inserted: list[RedisKeyUpdate] = Field(default_factory=list)
    updated: list[RedisKeyUpdate] = Field(default_factory=list)
    deleted: list[str] = Field(default_factory=list)


class DatabaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    password: str | None = Field(default=None, min_length=1, max_length=128)


class DatabaseCreateResponse(BaseModel):
    name: str
    message: str


class DatabasesResponse(BaseModel):
    databases: list[DatabaseInfo]


class TablesResponse(BaseModel):
    tables: list[TableInfo]


class DbObjectsResponse(BaseModel):
    objects: list[DbObjectInfo]


class ObjectDdlResponse(BaseModel):
    ddl: str


class SequenceDetailResponse(BaseModel):
    name: str
    schema: str | None = None
    start_value: str | None = None
    minimum_value: str | None = None
    maximum_value: str | None = None
    increment_by: str | None = None
    cache_size: str | None = None
    cycle: bool | None = None
    current_value: str | None = None
    last_number: str | None = None


class ColumnsResponse(BaseModel):
    columns: list[ColumnInfo]
    table_comment: str | None = None
