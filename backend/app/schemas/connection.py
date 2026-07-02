from typing import Literal

from pydantic import BaseModel, Field

DatabaseType = Literal["sqlite", "mysql", "postgresql", "dm", "gaussdb", "oracle", "mongodb", "redis", "clickhouse"]


class ConnectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    database_type: DatabaseType
    host: str | None = None
    port: int | str | None = None
    username: str | None = None
    password: str | None = None
    database: str | None = None
    sqlite_path: str | None = None
    driver_id: str | None = None
    driver_path: str | None = None
    dm_driver_id: str | None = None
    dm_driver_path: str | None = None
    ssh_enabled: bool = False
    ssh_host: str | None = None
    ssh_port: int | None = None
    ssh_username: str | None = None
    ssh_auth_type: Literal["password", "private_key"] | None = None
    ssh_password: str | None = None
    ssh_private_key_path: str | None = None
    ssh_passphrase: str | None = None


class ConnectionInfo(BaseModel):
    connection_id: str
    name: str
    database_type: DatabaseType
    host: str | None = None
    port: int | str | None = None
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
