from typing import Literal

from pydantic import BaseModel, Field

DatabaseType = Literal["sqlite", "mysql", "postgresql", "dm"]


class ConnectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    database_type: DatabaseType
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    database: str | None = None
    sqlite_path: str | None = None


class ConnectionInfo(BaseModel):
    connection_id: str
    name: str
    database_type: DatabaseType
    database: str
    has_password: bool = False
    is_open: bool = False
    server_version: str | None = None


class ConnectionPasswordResponse(BaseModel):
    password: str


class ConnectionTestResponse(BaseModel):
    success: bool
    message: str


class ConnectionCreateResponse(ConnectionInfo):
    pass


class ConnectionListResponse(BaseModel):
    connections: list[ConnectionInfo]
