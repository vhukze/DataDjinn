import base64
import ctypes
import json
import os
import sys
from ctypes import wintypes
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel
from sqlalchemy import Engine, URL, create_engine, text

from app.schemas.connection import ConnectionInfo, ConnectionRequest, DatabaseType

def _connection_store_path() -> Path:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return Path(data_dir).expanduser().resolve() / "connections.json"

    return Path(__file__).resolve().parents[2] / "data" / "connections.json"


CONNECTION_STORE_PATH = _connection_store_path()
CRYPTPROTECT_UI_FORBIDDEN = 0x1


def _load_dm_python(driver_path: str | None = None):
    if driver_path:
        driver_file = _resolve_runtime_path(driver_path)
        if not driver_file.exists():
            raise RuntimeError(f"达梦驱动文件不存在：{driver_file}")
        driver_dir = str(driver_file.parent)
        os.add_dll_directory(driver_dir)
        if driver_dir not in sys.path:
            sys.path.insert(0, driver_dir)
        os.environ["PATH"] = f"{driver_dir}{os.pathsep}{os.environ.get('PATH', '')}"

    try:
        import dmPython
    except ImportError as exc:
        raise RuntimeError("达梦驱动文件缺失，请在新建连接时选择本机 dmPython 驱动文件，或恢复 resources/backend/_internal 中的 dmPython 及 dm*.dll 文件后重试") from exc

    return dmPython


def _resolve_runtime_path(path: str) -> Path:
    target = Path(path).expanduser()
    if target.is_absolute():
        return target.resolve()

    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return (Path(data_dir).expanduser().resolve() / target).resolve()

    return target.resolve()


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


crypt32 = ctypes.windll.crypt32
kernel32 = ctypes.windll.kernel32

crypt32.CryptProtectData.argtypes = [
    ctypes.POINTER(DataBlob),
    wintypes.LPCWSTR,
    ctypes.POINTER(DataBlob),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DataBlob),
]
crypt32.CryptProtectData.restype = wintypes.BOOL
crypt32.CryptUnprotectData.argtypes = [
    ctypes.POINTER(DataBlob),
    ctypes.POINTER(wintypes.LPWSTR),
    ctypes.POINTER(DataBlob),
    ctypes.c_void_p,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(DataBlob),
]
crypt32.CryptUnprotectData.restype = wintypes.BOOL
kernel32.LocalFree.argtypes = [ctypes.c_void_p]
kernel32.LocalFree.restype = ctypes.c_void_p


class StoredConnection(BaseModel):
    connection_id: str
    name: str
    database_type: DatabaseType
    host: str | None = None
    port: int | None = None
    username: str | None = None
    encrypted_password: str | None = None
    database: str | None = None
    sqlite_path: str | None = None
    dm_driver_path: str | None = None


def _data_blob(data: bytes):
    buffer = ctypes.create_string_buffer(data)
    return DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer


def _encrypt_password(password: str | None) -> str | None:
    if not password:
        return None

    blob_in, _ = _data_blob(password.encode("utf-8"))
    blob_out = DataBlob()

    if not crypt32.CryptProtectData(ctypes.byref(blob_in), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out)):
        raise ValueError("密码加密失败")

    try:
        encrypted = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        return base64.b64encode(encrypted).decode("ascii")
    finally:
        kernel32.LocalFree(blob_out.pbData)


def _decrypt_password(encrypted_password: str | None) -> str | None:
    if not encrypted_password:
        return None

    blob_in, _ = _data_blob(base64.b64decode(encrypted_password))
    blob_out = DataBlob()

    if not crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out)):
        raise ValueError("密码解密失败")

    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData).decode("utf-8")
    finally:
        kernel32.LocalFree(blob_out.pbData)


class ConnectionManager:
    def __init__(self) -> None:
        self._engines: dict[str, Engine] = {}
        self._connections: dict[str, ConnectionInfo] = {}
        self._stored_connections: dict[str, StoredConnection] = {}
        self._load_stored_connections()

    def test_connection(self, request: ConnectionRequest) -> None:
        engine = self._create_engine(request)
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        finally:
            engine.dispose()

    def create_connection(self, request: ConnectionRequest) -> ConnectionInfo:
        engine = self._create_engine(request)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        connection_id = uuid4().hex
        info = self._connection_info(connection_id, request)
        self._engines[connection_id] = engine
        self._connections[connection_id] = info
        self._stored_connections[connection_id] = self._stored_connection(connection_id, request)
        self._save_stored_connections()
        return info

    def update_connection(self, connection_id: str, request: ConnectionRequest) -> ConnectionInfo:
        if connection_id not in self._stored_connections:
            raise ValueError("连接不存在")

        engine = self._create_engine(request)
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception:
            engine.dispose()
            raise

        old_engine = self._engines.get(connection_id)
        info = self._connection_info(connection_id, request)
        self._engines[connection_id] = engine
        self._connections[connection_id] = info
        self._stored_connections[connection_id] = self._stored_connection(connection_id, request)
        self._save_stored_connections()

        if old_engine is not None:
            old_engine.dispose()

        return info

    def list_connections(self) -> list[ConnectionInfo]:
        return list(self._connections.values())

    def get_connection_request(self, connection_id: str) -> ConnectionRequest:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        return ConnectionRequest(
            name=stored.name,
            database_type=stored.database_type,
            host=stored.host,
            port=stored.port,
            username=stored.username,
            password=_decrypt_password(stored.encrypted_password),
            database=stored.database,
            sqlite_path=stored.sqlite_path,
            dm_driver_path=stored.dm_driver_path,
        )

    def get_password(self, connection_id: str) -> str:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        password = _decrypt_password(stored.encrypted_password)

        if password is None:
            return ""

        return password

    def get_engine(self, connection_id: str) -> Engine | None:
        return self._engines.get(connection_id)

    def delete_connection(self, connection_id: str) -> bool:
        stored = self._stored_connections.pop(connection_id, None)

        if stored is None:
            return False

        self._connections.pop(connection_id, None)
        engine = self._engines.pop(connection_id, None)

        if engine is not None:
            engine.dispose()

        self._save_stored_connections()
        return True

    def _load_stored_connections(self) -> None:
        if not CONNECTION_STORE_PATH.exists():
            return

        data = json.loads(CONNECTION_STORE_PATH.read_text(encoding="utf-8"))
        for item in data.get("connections", []):
            stored = StoredConnection.model_validate(item)
            self._stored_connections[stored.connection_id] = stored
            info = self._connection_info(stored.connection_id, self._request_from_stored(stored), stored, is_open=False)
            self._connections[stored.connection_id] = info

    def _request_from_stored(self, stored: StoredConnection) -> ConnectionRequest:
        return ConnectionRequest(
            name=stored.name,
            database_type=stored.database_type,
            host=stored.host,
            port=stored.port,
            username=stored.username,
            password=_decrypt_password(stored.encrypted_password),
            database=stored.database,
            sqlite_path=stored.sqlite_path,
            dm_driver_path=stored.dm_driver_path,
        )

    def open_connection(self, connection_id: str) -> ConnectionInfo:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        request = self._request_from_stored(stored)
        engine = self._create_engine(request)

        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception:
            engine.dispose()
            raise

        old_engine = self._engines.get(connection_id)

        if old_engine is not None:
            old_engine.dispose()

        self._engines[connection_id] = engine
        info = self._connection_info(connection_id, request, stored, is_open=True)
        self._connections[connection_id] = info
        return info

    def close_connection(self, connection_id: str) -> ConnectionInfo:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        engine = self._engines.pop(connection_id, None)

        if engine is not None:
            engine.dispose()

        request = self._request_from_stored(stored)
        info = self._connection_info(connection_id, request, stored, is_open=False)
        self._connections[connection_id] = info
        return info

    def _save_stored_connections(self) -> None:
        CONNECTION_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {"connections": [connection.model_dump() for connection in self._stored_connections.values()]}
        CONNECTION_STORE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _create_engine(self, request: ConnectionRequest) -> Engine:
        if request.database_type == "sqlite":
            return self._create_sqlite_engine(request)

        if request.database_type == "mysql":
            return self._create_mysql_engine(request)

        if request.database_type == "postgresql":
            return self._create_postgresql_engine(request)

        if request.database_type == "dm":
            return self._create_dm_engine(request)

        raise ValueError("不支持的数据库类型")

    def _create_sqlite_engine(self, request: ConnectionRequest) -> Engine:
        if not request.sqlite_path:
            raise ValueError("SQLite 文件路径不能为空")

        db_path = _resolve_runtime_path(request.sqlite_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})

    def _create_mysql_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("MySQL 主机不能为空")
        if not request.port:
            raise ValueError("MySQL 端口不能为空")
        if not request.username:
            raise ValueError("MySQL 用户名不能为空")

        url = URL.create(
            "mysql+pymysql",
            username=request.username,
            password=request.password or "",
            host=request.host,
            port=request.port,
            database=request.database,
        )
        return create_engine(url, pool_pre_ping=True)

    def _create_postgresql_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("PostgreSQL 主机不能为空")
        if not request.port:
            raise ValueError("PostgreSQL 端口不能为空")
        if not request.username:
            raise ValueError("PostgreSQL 用户名不能为空")
        if not request.database:
            raise ValueError("PostgreSQL 数据库名不能为空")

        url = URL.create(
            "postgresql+psycopg",
            username=request.username,
            password=request.password or "",
            host=request.host,
            port=request.port,
            database=request.database,
        )
        return create_engine(url, pool_pre_ping=True)

    def _create_dm_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("达梦主机不能为空")
        if not request.port:
            raise ValueError("达梦端口不能为空")
        if not request.username:
            raise ValueError("达梦用户名不能为空")

        dm_python = _load_dm_python(request.dm_driver_path)

        def connect():
            return dm_python.connect(
                user=request.username,
                password=request.password or "",
                host=request.host,
                port=request.port,
            )

        url = URL.create("dm+dmPython", host=request.host, port=request.port)
        return create_engine(url, creator=connect, pool_pre_ping=True)

    def _detect_server_version(self, engine: Engine) -> str | None:
        if engine.dialect.name not in {"dm", "dmPython"}:
            return None

        sql_candidates = [
            "SELECT BANNER FROM V$VERSION",
            "SELECT * FROM V$VERSION",
            "SELECT ID_CODE FROM V$INSTANCE",
        ]

        for sql in sql_candidates:
            try:
                with engine.connect() as connection:
                    row = connection.execute(text(sql)).first()

                    if row and row[0] is not None:
                        return str(row[0])
            except Exception:
                continue

        return None

    def _connection_info(self, connection_id: str, request: ConnectionRequest, stored: StoredConnection | None = None, is_open: bool = False, server_version: str | None = None) -> ConnectionInfo:
        return ConnectionInfo(
            connection_id=connection_id,
            name=request.name,
            database_type=request.database_type,
            database=self._display_database(request),
            has_password=bool(request.password or stored and stored.encrypted_password),
            is_open=is_open,
            server_version=server_version,
        )

    def _stored_connection(self, connection_id: str, request: ConnectionRequest) -> StoredConnection:
        return StoredConnection(
            connection_id=connection_id,
            name=request.name,
            database_type=request.database_type,
            host=request.host,
            port=request.port,
            username=request.username,
            encrypted_password=_encrypt_password(request.password),
            database=request.database,
            sqlite_path=str(_resolve_runtime_path(request.sqlite_path)) if request.sqlite_path else None,
            dm_driver_path=str(_resolve_runtime_path(request.dm_driver_path)) if request.dm_driver_path else None,
        )

    def _display_database(self, request: ConnectionRequest) -> str:
        if request.database_type == "sqlite":
            return str(Path(request.sqlite_path or "").expanduser().resolve())

        if request.database_type == "postgresql":
            return f"{request.database}@{request.host}:{request.port}"

        if request.database_type == "dm":
            return request.database or f"{request.host}:{request.port}"

        return request.database or f"{request.host}:{request.port}"


connection_manager = ConnectionManager()
