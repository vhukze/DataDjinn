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
    size_bytes: int | None = None
    size_display: str | None = None
    storage_size_bytes: int | None = None
    storage_size_display: str | None = None
    row_count: int | None = None


class DbObjectInfo(BaseModel):
    name: str
    type: str
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


class TableUpdateColumn(BaseModel):
    name: str
    type: str = Field(min_length=1, max_length=80)
    nullable: bool
    primary_key: bool


class TableUpdateRequest(BaseModel):
    columns: list[TableUpdateColumn] = Field(min_length=1)


class TableRowUpdate(BaseModel):
    original: dict[str, Any]
    values: dict[str, Any]


class TableDataChangeRequest(BaseModel):
    inserted: list[dict[str, Any]] = Field(default_factory=list)
    updated: list[TableRowUpdate] = Field(default_factory=list)
    deleted: list[dict[str, Any]] = Field(default_factory=list)


class DatabaseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class DatabaseCreateResponse(BaseModel):
    name: str
    message: str


class DatabasesResponse(BaseModel):
    databases: list[DatabaseInfo]


class TablesResponse(BaseModel):
    tables: list[TableInfo]


class DbObjectsResponse(BaseModel):
    objects: list[DbObjectInfo]


class ColumnsResponse(BaseModel):
    columns: list[ColumnInfo]
