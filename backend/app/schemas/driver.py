from typing import Literal

from pydantic import BaseModel, Field

DriverDatabaseType = Literal["dm"]
DriverType = Literal["jdbc", "python", "whl"]
DriverSource = Literal["auto", "manual"]


class DriverInfo(BaseModel):
    id: str
    database_type: DriverDatabaseType
    driver_type: DriverType
    name: str
    source: DriverSource = "manual"
    enabled: bool = True
    path: str | None = None


class DriverListResponse(BaseModel):
    drivers: list[DriverInfo]


class DriverCreateRequest(BaseModel):
    database_type: DriverDatabaseType = "dm"
    driver_type: DriverType
    name: str = Field(min_length=1, max_length=120)
    path: str | None = None
    enabled: bool = True


class DriverDetectRequest(BaseModel):
    database_type: DriverDatabaseType = "dm"


class DriverDetectResponse(BaseModel):
    detected: list[DriverInfo]
    added: list[DriverInfo]


class DriverTestRequest(BaseModel):
    id: str


class DriverTestResponse(BaseModel):
    success: bool
    message: str
