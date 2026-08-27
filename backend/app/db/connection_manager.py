from __future__ import annotations

import base64
import ctypes
import importlib
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import zipfile
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import Engine, URL, create_engine, text
from sqlalchemy.dialects import registry
from sqlalchemy.engine import default
from sqlalchemy.engine.interfaces import BindTyping
from sqlalchemy.pool import QueuePool

from app.db.driver_manager import driver_manager
from app.db.jdbc_bridge import load_jdbc_bridge
from app.db import java_runtime
from app.db.mongo_utils import MongoClient, is_mongo_client
from app.db.redis_utils import Redis, is_redis_client
from app.schemas.connection import ConnectionInfo, ConnectionRequest, DatabaseType


def _is_clickhouse_engine(engine: Any) -> bool:
    return getattr(getattr(engine, "dialect", None), "name", "") in {"clickhouse", "clickhousedb"}


def _is_schema_scoped_engine(engine: Any) -> bool:
    return getattr(getattr(engine, "dialect", None), "name", "") in {"postgresql", "gaussdb"}


def _ensure_clickhouse_dialect_registered() -> None:
    try:
        registry.load("clickhousedb")
        return
    except Exception:
        pass

    try:
        __import__("clickhouse_connect.cc_sqlalchemy.dialect")
    except ImportError as exc:
        raise RuntimeError("缺少 ClickHouse SQLAlchemy 方言模块 clickhouse_connect.cc_sqlalchemy.dialect") from exc

    registry.register("clickhousedb", "clickhouse_connect.cc_sqlalchemy.dialect", "ClickHouseDialect")

    try:
        registry.load("clickhousedb")
    except Exception as exc:
        raise RuntimeError(f"ClickHouse SQLAlchemy 方言注册失败：{exc}") from exc


def _data_dir() -> Path:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return Path(data_dir).expanduser().resolve()

    return Path(__file__).resolve().parents[2] / "data"


def _connection_store_path() -> Path:
    return _data_dir() / "connections.json"


CONNECTION_STORE_PATH = _connection_store_path()
CRYPTPROTECT_UI_FORBIDDEN = 0x1
SSH_GATEWAY_CONNECT_TIMEOUT_SECONDS = 5
DATABASE_CONNECT_TIMEOUT_SECONDS = 5
CONNECTION_HEALTH_CHECK_INTERVAL_SECONDS = 30


def _jvm_candidates_from_java_executable(java_executable: str | None) -> list[Path]:
    if not java_executable:
        return []

    java_path = Path(java_executable).expanduser()
    java_bin = java_path.parent
    java_home = java_bin.parent
    return [
        java_bin / "server" / "jvm.dll",
        java_home / "bin" / "server" / "jvm.dll",
        java_home / "jre" / "bin" / "server" / "jvm.dll",
    ]


def _parse_java_major(version: str | None) -> int | None:
    if not version:
        return None

    parts = re.split(r"[._\-+]", version.strip().strip('"'))
    if not parts or not parts[0].isdigit():
        return None
    if parts[0] == "1" and len(parts) > 1 and parts[1].isdigit():
        return int(parts[1])
    return int(parts[0])


def _java_home_from_jvm_dll(jvm_dll: Path) -> Path:
    home = jvm_dll.parent.parent.parent
    if home.name.lower() == "jre" and home.parent.exists():
        return home.parent
    return home


def _java_major_from_home(java_home: Path) -> int | None:
    release_file = java_home / "release"
    if release_file.exists():
        try:
            for line in release_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("JAVA_VERSION="):
                    return _parse_java_major(line.split("=", 1)[1])
        except OSError:
            pass

    return _parse_java_major(java_home.name)


def _collect_jvm_candidates() -> list[Path]:
    candidates: list[Path] = []

    java_home = os.environ.get("JAVA_HOME")
    if java_home:
        home = Path(java_home).expanduser()
        candidates.extend([
            home / "bin" / "server" / "jvm.dll",
            home / "jre" / "bin" / "server" / "jvm.dll",
        ])

    candidates.extend(_jvm_candidates_from_java_executable(shutil.which("java")))
    candidates.extend(_jvm_candidates_from_java_executable(shutil.which("java.exe")))

    for base in [Path("C:/Program Files/Java"), Path("C:/Program Files/Eclipse Adoptium"), Path("C:/Program Files/Microsoft"), Path("C:/Program Files/Zulu"), Path("C:/Program Files/BellSoft")]:
        if not base.exists():
            continue
        for pattern in ["*/bin/server/jvm.dll", "*/jre/bin/server/jvm.dll"]:
            candidates.extend(base.glob(pattern))

    return [path.resolve() for path in dict.fromkeys(candidates) if path.exists()]


def _find_jvm_dll(required_java_major: int | None = None) -> Path | None:
    candidates = _collect_jvm_candidates()
    if required_java_major is None:
        return next(iter(candidates), None)

    return next((path for path in candidates if (_java_major_from_home(_java_home_from_jvm_dll(path)) or 0) >= required_java_major), None)


def _format_java_candidates() -> str:
    candidates = _collect_jvm_candidates()
    if not candidates:
        return "未检测到 Java"

    displays = []
    for path in candidates[:8]:
        java_home = _java_home_from_jvm_dll(path)
        major = _java_major_from_home(java_home)
        displays.append(f"Java {major or '未知版本'}：{java_home}")
    return "；".join(displays)


def _java_major_from_class_header(data: bytes) -> int | None:
    if len(data) != 8 or data[:4] != b"\xca\xfe\xba\xbe":
        return None

    class_major = int.from_bytes(data[6:8], "big")
    return class_major - 44 if class_major >= 49 else None


def _required_java_major_from_jar(jar_path: Path) -> int | None:
    try:
        with zipfile.ZipFile(jar_path) as archive:
            if "dm/jdbc/driver/DmDriver.class" in archive.namelist():
                java_major = _java_major_from_class_header(archive.read("dm/jdbc/driver/DmDriver.class", 8))
                if java_major:
                    return java_major

            majors = []
            for name in archive.namelist():
                if not name.endswith(".class") or name.startswith("META-INF/versions/"):
                    continue
                java_major = _java_major_from_class_header(archive.read(name, 8))
                if java_major:
                    majors.append(java_major)
    except Exception:
        return None

    return max(majors, default=None)


def _prepare_jdbc_runtime(required_java_major: int | None = None) -> str | None:
    jvm_dll = _find_jvm_dll(required_java_major)
    if jvm_dll is None:
        if required_java_major:
            raise RuntimeError(f"当前达梦 JDBC 驱动至少需要 Java {required_java_major}，但没有检测到满足要求的 64 位 JDK/JRE。已检测到：{_format_java_candidates()}。请安装 Java {required_java_major} 或更高版本，或更换为兼容当前 Java 的达梦 JDBC 驱动")
        return None

    java_home = _java_home_from_jvm_dll(jvm_dll)
    jvm_bin = str(jvm_dll.parent.parent)
    os.environ["PATH"] = f"{jvm_bin}{os.pathsep}{os.environ.get('PATH', '')}"
    os.environ["JAVA_HOME"] = str(java_home)
    return str(jvm_dll)


def _ensure_jpype_support_library(jpype_module: Any) -> Path:
    jpype_core = importlib.import_module("jpype._core")

    expected = Path(jpype_core.__file__).resolve().parent.parent / "org.jpype.jar"
    if expected.exists():
        return expected

    candidates: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        meipass_path = Path(meipass)
        candidates.extend([
            meipass_path / "org.jpype.jar",
            meipass_path / "_internal" / "org.jpype.jar",
            meipass_path.parent / "org.jpype.jar",
        ])

    executable_dir = Path(sys.executable).resolve().parent
    candidates.extend([
        executable_dir / "org.jpype.jar",
        executable_dir / "_internal" / "org.jpype.jar",
        executable_dir.parent / "org.jpype.jar",
        Path(jpype_module.__file__).resolve().parent.parent / "org.jpype.jar",
    ])

    source = next((path for path in dict.fromkeys(candidates) if path.exists()), None)
    if source is None:
        searched = "; ".join(str(path) for path in dict.fromkeys([expected, *candidates]))
        raise RuntimeError(f"未找到 JPype 支持库 org.jpype.jar，已搜索路径：{searched}")

    jpype_core.__file__ = str(source.parent / "jpype" / "_core.py")
    return source


def _validate_whl_compatibility(driver_file: Path) -> None:
    name = driver_file.name.lower()
    py_tags = [f"cp{tag}" for tag in re.findall(r"cp(\d{2,3})", name)]
    current_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if py_tags and all(tag != current_tag for tag in py_tags):
        supported = ", ".join(f"Python {tag.removeprefix('cp')[0]}.{tag.removeprefix('cp')[1:]}" for tag in sorted(set(py_tags)))
        raise RuntimeError(f"当前 Python 是 {sys.version_info.major}.{sys.version_info.minor}，该 whl 适用于 {supported}，请下载匹配 {current_tag} 的 Windows 64 位 whl")

    if any(tag in name for tag in ["linux", "manylinux", "musllinux"]):
        raise RuntimeError("当前选择的是 Linux 版 whl，请下载 Windows 版 win_amd64 whl")

    if "win" not in name:
        raise RuntimeError("当前 whl 文件名未包含 Windows 平台标识，请确认下载的是 Windows 64 位 win_amd64 版本")


def _prepare_dm_python_path(driver_path: str | None = None, *, is_whl: bool = False) -> Path | None:
    if not driver_path:
        return None

    driver_file = _resolve_runtime_path(driver_path)
    if not driver_file.exists():
        raise RuntimeError(f"达梦驱动文件不存在：{driver_file}")

    if is_whl:
        _validate_whl_compatibility(driver_file)
        if not zipfile.is_zipfile(driver_file):
            raise RuntimeError("达梦 whl 驱动文件格式无效")
        extract_dir = _data_dir() / "drivers" / "whl" / driver_file.stem
        if not extract_dir.exists() or not any(extract_dir.iterdir()):
            if extract_dir.exists():
                shutil.rmtree(extract_dir)
            extract_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(driver_file) as archive:
                archive.extractall(extract_dir)

        candidate_dirs = [extract_dir]
        package_dirs = [path.parent for path in extract_dir.rglob("*.pyd") if path.is_file()]
        candidate_dirs.extend(path for path in package_dirs if path not in candidate_dirs)

        for path in candidate_dirs:
            path_text = str(path)
            if path_text not in sys.path:
                sys.path.insert(0, path_text)

        for path in [extract_dir, *extract_dir.rglob("*")]:
            if path.is_dir() and any(child.suffix.lower() in {".pyd", ".dll"} for child in path.iterdir() if child.is_file()):
                os.add_dll_directory(str(path))
                os.environ["PATH"] = f"{path}{os.pathsep}{os.environ.get('PATH', '')}"
        return extract_dir

    driver_dir = str(driver_file.parent)
    os.add_dll_directory(driver_dir)
    if driver_dir not in sys.path:
        sys.path.insert(0, driver_dir)
    os.environ["PATH"] = f"{driver_dir}{os.pathsep}{os.environ.get('PATH', '')}"
    return driver_file


def _load_dm_python(driver_path: str | None = None, *, is_whl: bool = False):
    _prepare_dm_python_path(driver_path, is_whl=is_whl)

    try:
        import dmPython
    except ImportError as exc:
        driver_label = "dmPython whl" if is_whl else "dmPython pyd"
        search_hint = f"，已搜索路径：{'; '.join(sys.path[:8])}" if is_whl else ""
        raise RuntimeError(f"达梦 {driver_label} 驱动加载失败：{exc}{search_hint}。请确认驱动与当前 Python 版本、系统位数匹配") from exc

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


class DmJdbcCursorAdapter:
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor
        self.description = None
        self.rowcount = -1

    def execute(self, operation: str, parameters: Any = None) -> "DmJdbcCursorAdapter":
        if parameters is None:
            self._cursor.execute(operation)
        else:
            self._cursor.execute(operation, parameters)
        self.description = self._cursor.description
        self.rowcount = self._cursor.rowcount
        return self

    def executemany(self, operation: str, seq_of_parameters: Any) -> "DmJdbcCursorAdapter":
        self._cursor.executemany(operation, seq_of_parameters)
        self.description = self._cursor.description
        self.rowcount = self._cursor.rowcount
        return self

    def fetchone(self) -> Any:
        return self._cursor.fetchone()

    def fetchmany(self, size: int | None = None) -> list[Any]:
        return self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany()

    def fetchall(self) -> list[Any]:
        return self._cursor.fetchall()

    def close(self) -> None:
        self._cursor.close()

    def __iter__(self):
        return iter(self._cursor)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)


class DmJdbcDbApi:
    paramstyle = "qmark"
    Error = Exception
    DatabaseError = Exception
    OperationalError = Exception
    ProgrammingError = Exception
    IntegrityError = Exception
    InterfaceError = Exception
    InternalError = Exception
    NotSupportedError = Exception


class DmJdbcConnectionAdapter:
    def __init__(self, connection: Any) -> None:
        self._connection = connection

    def cursor(self) -> DmJdbcCursorAdapter:
        return DmJdbcCursorAdapter(self._connection.cursor())

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        raw_connection = getattr(self._connection, "jconn", None)
        if raw_connection is not None:
            try:
                if raw_connection.getAutoCommit():
                    return
            except Exception:
                pass
        self._connection.rollback()

    def close(self) -> None:
        self._connection.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._connection, name)


class JdbcReconnectDialect(default.DefaultDialect):
    def __init__(self, name: str, ping_statement: str) -> None:
        super().__init__(paramstyle="qmark")
        self.name = name
        self.driver = "jdbc"
        self.dbapi = DmJdbcDbApi
        self.loaded_dbapi = DmJdbcDbApi
        self.bind_typing = BindTyping.NONE
        self.supports_statement_cache = False
        self._ping_statement = ping_statement

    def do_ping(self, dbapi_connection: DmJdbcConnectionAdapter) -> bool:
        cursor: DmJdbcCursorAdapter | None = None
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute(self._ping_statement)
            return True
        except Exception:
            return False
        finally:
            if cursor is not None:
                cursor.close()


def _set_jdbc_autocommit(connection: Any, enabled: bool) -> None:
    raw_connection = getattr(connection, "jconn", None)
    if raw_connection is None:
        return

    try:
        raw_connection.setAutoCommit(enabled)
    except Exception:
        pass


GAUSSDB_JDBC_DRIVER_CANDIDATES = [
    ("com.huawei.gaussdb.jdbc.Driver", "jdbc:gaussdb"),
    ("org.opengauss.Driver", "jdbc:opengauss"),
    ("org.postgresql.Driver", "jdbc:postgresql"),
]


def _detect_gaussdb_jdbc_driver(jar_path: Path) -> tuple[str, str]:
    class_candidates = {
        "com/huawei/gaussdb/jdbc/Driver.class": ("com.huawei.gaussdb.jdbc.Driver", "jdbc:gaussdb"),
        "org/opengauss/Driver.class": ("org.opengauss.Driver", "jdbc:opengauss"),
        "org/postgresql/Driver.class": ("org.postgresql.Driver", "jdbc:postgresql"),
    }

    try:
        with zipfile.ZipFile(jar_path) as archive:
            names = set(archive.namelist())
    except Exception:
        return GAUSSDB_JDBC_DRIVER_CANDIDATES[0]

    for class_path, driver in class_candidates.items():
        if class_path in names:
            return driver

    return GAUSSDB_JDBC_DRIVER_CANDIDATES[0]


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
    port: int | str | None = None
    username: str | None = None
    encrypted_password: str | None = None
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
    ssh_auth_type: str | None = None
    encrypted_ssh_password: str | None = None
    ssh_private_key_path: str | None = None
    encrypted_ssh_passphrase: str | None = None
    git_versioning_enabled: bool = False
    git_versioning_scopes: list[str] = Field(default_factory=list)


@dataclass
class SshTunnelHandle:
    forwarder: Any
    local_host: str
    local_port: int

    def close(self) -> None:
        stop = getattr(self.forwarder, "stop", None)
        if callable(stop):
            stop()


def _manual_driver_id(request: ConnectionRequest | StoredConnection) -> str | None:
    return request.driver_id or request.dm_driver_id


def _manual_driver_path(request: ConnectionRequest | StoredConnection) -> str | None:
    return request.driver_path or request.dm_driver_path


def _resolve_clickhouse_port(port_value: int | str | None) -> tuple[int | None, str | None]:
    if port_value is None:
        return None, None
    if isinstance(port_value, int):
        return port_value, None

    port_text = str(port_value).strip()
    if not port_text:
        return None, None

    port_candidates = [item.strip() for item in port_text.split(",") if item.strip()]
    if not port_candidates:
        return None, None

    first_port = int(port_candidates[0])
    alt_ports = ",".join(port_candidates[1:]) or None
    return first_port, alt_ports


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
        self._engines: dict[str, Engine | MongoClient | Redis] = {}
        self._ssh_tunnels: dict[str, SshTunnelHandle] = {}
        self._connections: dict[str, ConnectionInfo] = {}
        self._stored_connections: dict[str, StoredConnection] = {}
        self._unavailable_secret_fields: dict[str, set[str]] = {}
        self._connection_health_checked_at: dict[str, float] = {}
        self._reconnectable_connection_ids: set[str] = set()
        self._opening_connection_attempts: dict[str, str] = {}
        self._cancelled_open_attempts: set[tuple[str, str]] = set()
        self._connection_open_lock = threading.RLock()
        self._load_stored_connections()

    def test_connection(self, request: ConnectionRequest) -> None:
        engine, tunnel = self._open_runtime_engine(request)
        try:
            self._ping_engine(engine)
        finally:
            self._dispose_engine(engine)
            self._dispose_tunnel(tunnel)

    def test_ssh_tunnel(self, request: ConnectionRequest) -> None:
        if not self._uses_ssh_tunnel(request):
            raise ValueError("请先启用 SSH 隧道后再测试")

        tunnel = self._open_ssh_tunnel(request)
        self._dispose_tunnel(tunnel)

    def create_connection(self, request: ConnectionRequest) -> ConnectionInfo:
        connection_id = uuid4().hex
        info = self._connection_info(connection_id, request, is_open=False)
        self._connections[connection_id] = info
        self._stored_connections[connection_id] = self._stored_connection(connection_id, request)
        self._save_stored_connections()
        return info

    def update_connection(self, connection_id: str, request: ConnectionRequest) -> ConnectionInfo:
        if connection_id not in self._stored_connections:
            raise ValueError("连接不存在")

        old_engine = self._engines.pop(connection_id, None)
        old_tunnel = self._ssh_tunnels.pop(connection_id, None)
        self._connection_health_checked_at.pop(connection_id, None)
        self._reconnectable_connection_ids.discard(connection_id)
        self._dispose_connection_resources(old_engine, old_tunnel)

        info = self._connection_info(connection_id, request, is_open=False)
        self._connections[connection_id] = info
        self._stored_connections[connection_id] = self._stored_connection(connection_id, request)
        self._unavailable_secret_fields.pop(connection_id, None)
        self._save_stored_connections()

        return info

    def list_connections(self) -> list[ConnectionInfo]:
        return list(self._connections.values())

    def export_sync_connections(self) -> dict[str, dict[str, Any]]:
        return {
            connection_id: self._request_from_stored(stored).model_dump(
                exclude={
                    "driver_id",
                    "driver_path",
                    "dm_driver_id",
                    "dm_driver_path",
                    "ssh_private_key_path",
                }
            )
            for connection_id, stored in self._stored_connections.items()
        }

    def replace_sync_connections(
        self, connections: dict[str, dict[str, Any]]
    ) -> list[ConnectionInfo]:
        validated: dict[str, ConnectionRequest] = {}
        for connection_id, payload in connections.items():
            normalized_id = connection_id.strip()
            if not normalized_id or normalized_id != connection_id:
                raise ValueError("同步连接标识无效")
            request = ConnectionRequest.model_validate(payload)
            existing = self._stored_connections.get(connection_id)
            if existing is not None:
                request = request.model_copy(
                    update={
                        "driver_id": _manual_driver_id(existing),
                        "driver_path": _manual_driver_path(existing),
                        "dm_driver_id": existing.dm_driver_id,
                        "dm_driver_path": existing.dm_driver_path,
                        "ssh_private_key_path": existing.ssh_private_key_path,
                    }
                )
            else:
                request = request.model_copy(
                    update={
                        "driver_id": None,
                        "driver_path": None,
                        "dm_driver_id": None,
                        "dm_driver_path": None,
                        "ssh_private_key_path": None,
                    }
                )
            validated[connection_id] = request

        removed_ids = set(self._stored_connections) - set(validated)
        current_snapshot = self.export_sync_connections()
        changed_ids = {
            connection_id
            for connection_id, request in validated.items()
            if connection_id not in self._stored_connections
            or current_snapshot.get(connection_id)
            != request.model_dump(
                exclude={
                    "driver_id",
                    "driver_path",
                    "dm_driver_id",
                    "dm_driver_path",
                    "ssh_private_key_path",
                }
            )
        }
        for connection_id in removed_ids | changed_ids:
            engine = self._engines.pop(connection_id, None)
            tunnel = self._ssh_tunnels.pop(connection_id, None)
            self._connection_health_checked_at.pop(connection_id, None)
            self._reconnectable_connection_ids.discard(connection_id)
            self._dispose_connection_resources(engine, tunnel)

        next_stored_connections = {
            connection_id: self._stored_connection(connection_id, request)
            for connection_id, request in validated.items()
        }
        self._stored_connections = next_stored_connections
        self._connections = {
            connection_id: self._connection_info(
                connection_id,
                request,
                self._stored_connections[connection_id],
                is_open=connection_id in self._engines,
            )
            for connection_id, request in validated.items()
        }
        self._unavailable_secret_fields = {
            connection_id: fields
            for connection_id, fields in self._unavailable_secret_fields.items()
            if connection_id in validated
        }
        self._save_stored_connections()
        return self.list_connections()

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
            password=self._decrypt_stored_secret(stored, "password", stored.encrypted_password),
            database=stored.database,
            sqlite_path=stored.sqlite_path,
            driver_id=_manual_driver_id(stored),
            driver_path=_manual_driver_path(stored),
            dm_driver_id=stored.dm_driver_id,
            dm_driver_path=stored.dm_driver_path,
            ssh_enabled=stored.ssh_enabled,
            ssh_host=stored.ssh_host,
            ssh_port=stored.ssh_port,
            ssh_username=stored.ssh_username,
            ssh_auth_type=stored.ssh_auth_type or "password",
            ssh_password=self._decrypt_stored_secret(stored, "ssh_password", stored.encrypted_ssh_password),
            ssh_private_key_path=stored.ssh_private_key_path,
            ssh_passphrase=self._decrypt_stored_secret(stored, "ssh_passphrase", stored.encrypted_ssh_passphrase),
            git_versioning_enabled=stored.git_versioning_enabled,
            git_versioning_scopes=stored.git_versioning_scopes,
        )

    def get_password(self, connection_id: str) -> str:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        password = self._decrypt_stored_secret(stored, "password", stored.encrypted_password)

        if password is None:
            return ""

        return password

    def get_engine(self, connection_id: str) -> Engine | MongoClient | Redis | None:
        return self._engines.get(connection_id)

    def ensure_connection_healthy(
        self,
        connection_id: str,
        *,
        force: bool = False,
        max_idle_seconds: int = CONNECTION_HEALTH_CHECK_INTERVAL_SECONDS,
    ) -> bool:
        now = time.monotonic()
        with self._connection_open_lock:
            engine = self._engines.get(connection_id)
            last_checked_at = self._connection_health_checked_at.get(connection_id)

        if engine is None:
            return False
        if not force and last_checked_at is not None and now - last_checked_at < max_idle_seconds:
            return True

        try:
            self._ping_engine(engine)
        except Exception:
            with self._connection_open_lock:
                if self._engines.get(connection_id) is not engine:
                    return self._engines.get(connection_id) is not None
                failed_engine = self._engines.pop(connection_id, None)
                failed_tunnel = self._ssh_tunnels.pop(connection_id, None)
                self._connection_health_checked_at.pop(connection_id, None)
                self._reconnectable_connection_ids.add(connection_id)
                stored = self._stored_connections.get(connection_id)
                if stored is not None:
                    self._connections[connection_id] = self._connection_info(
                        connection_id,
                        self._request_from_stored(stored),
                        stored,
                        is_open=False,
                    )
            self._dispose_connection_resources(failed_engine, failed_tunnel)
            return False

        with self._connection_open_lock:
            if self._engines.get(connection_id) is engine:
                self._connection_health_checked_at[connection_id] = now
                return True
            return self._engines.get(connection_id) is not None

    def ensure_connection_available(
        self,
        connection_id: str,
        *,
        force: bool = False,
    ) -> bool:
        """Keep a connection that the UI considers open usable after idle disconnects.

        A deliberately closed connection remains closed.  Only a connection whose
        last published state was open is re-created when its runtime engine has
        disappeared or its health check fails.
        """
        with self._connection_open_lock:
            connection_info = self._connections.get(connection_id)
            should_reconnect = bool(
                connection_info
                and (connection_info.is_open or connection_id in self._reconnectable_connection_ids)
            )
            has_engine = connection_id in self._engines

        if not should_reconnect:
            return False

        if has_engine and self.ensure_connection_healthy(connection_id, force=force):
            return True

        try:
            self.open_connection(connection_id)
        except Exception:
            return False
        return self.get_engine(connection_id) is not None

    def delete_connection(self, connection_id: str) -> bool:
        stored = self._stored_connections.pop(connection_id, None)

        if stored is None:
            return False

        self._connections.pop(connection_id, None)
        self._unavailable_secret_fields.pop(connection_id, None)
        self._connection_health_checked_at.pop(connection_id, None)
        self._reconnectable_connection_ids.discard(connection_id)
        engine = self._engines.pop(connection_id, None)
        tunnel = self._ssh_tunnels.pop(connection_id, None)
        self._dispose_connection_resources(engine, tunnel)

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
            password=self._decrypt_stored_secret(stored, "password", stored.encrypted_password),
            database=stored.database,
            sqlite_path=stored.sqlite_path,
            driver_id=_manual_driver_id(stored),
            driver_path=_manual_driver_path(stored),
            dm_driver_id=stored.dm_driver_id,
            dm_driver_path=stored.dm_driver_path,
            ssh_enabled=stored.ssh_enabled,
            ssh_host=stored.ssh_host,
            ssh_port=stored.ssh_port,
            ssh_username=stored.ssh_username,
            ssh_auth_type=stored.ssh_auth_type or "password",
            ssh_password=self._decrypt_stored_secret(stored, "ssh_password", stored.encrypted_ssh_password),
            ssh_private_key_path=stored.ssh_private_key_path,
            ssh_passphrase=self._decrypt_stored_secret(stored, "ssh_passphrase", stored.encrypted_ssh_passphrase),
            git_versioning_enabled=stored.git_versioning_enabled,
            git_versioning_scopes=stored.git_versioning_scopes,
        )

    def update_git_versioning_scopes(
        self, connection_id: str, scopes: list[str]
    ) -> ConnectionRequest:
        stored = self._stored_connections.get(connection_id)
        if stored is None:
            raise ValueError("连接不存在")

        normalized_scopes = list(
            dict.fromkeys(scope.strip() for scope in scopes if isinstance(scope, str) and scope.strip())
        )
        updated = stored.model_copy(update={"git_versioning_scopes": normalized_scopes})
        self._stored_connections[connection_id] = updated
        previous_info = self._connections.get(connection_id)
        self._connections[connection_id] = self._connection_info(
            connection_id,
            self._request_from_stored(updated),
            updated,
            is_open=connection_id in self._engines,
            server_version=previous_info.server_version if previous_info else None,
        )
        self._save_stored_connections()
        return self._request_from_stored(updated)

    def _decrypt_stored_secret(
        self, stored: StoredConnection, field: str, encrypted_value: str | None
    ) -> str | None:
        try:
            return _decrypt_password(encrypted_value)
        except (UnicodeDecodeError, ValueError):
            self._unavailable_secret_fields.setdefault(stored.connection_id, set()).add(field)
            return None

    def _raise_if_open_attempt_cancelled(
        self, connection_id: str, open_attempt_id: str | None
    ) -> None:
        if not open_attempt_id:
            return

        with self._connection_open_lock:
            attempt_key = (connection_id, open_attempt_id)
            if attempt_key not in self._cancelled_open_attempts:
                return
            self._cancelled_open_attempts.discard(attempt_key)

        raise RuntimeError("连接已取消")

    def open_connection(
        self, connection_id: str, open_attempt_id: str | None = None
    ) -> ConnectionInfo:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        request = self._request_from_stored(stored)
        engine: Engine | MongoClient | Redis | None = None
        tunnel: SshTunnelHandle | None = None
        if open_attempt_id:
            with self._connection_open_lock:
                self._opening_connection_attempts[connection_id] = open_attempt_id

        try:
            self._raise_if_open_attempt_cancelled(connection_id, open_attempt_id)
            engine, tunnel = self._open_runtime_engine(request)
            self._raise_if_open_attempt_cancelled(connection_id, open_attempt_id)
            self._ping_engine(engine)
            server_version = self._detect_server_version(engine)
            self._raise_if_open_attempt_cancelled(connection_id, open_attempt_id)

            with self._connection_open_lock:
                self._raise_if_open_attempt_cancelled(connection_id, open_attempt_id)
                old_engine = self._engines.get(connection_id)
                old_tunnel = self._ssh_tunnels.get(connection_id)
                self._engines[connection_id] = engine
                self._reconnectable_connection_ids.discard(connection_id)
                if tunnel is not None:
                    self._ssh_tunnels[connection_id] = tunnel
                else:
                    self._ssh_tunnels.pop(connection_id, None)
                info = self._connection_info(
                    connection_id, request, stored, is_open=True, server_version=server_version
                )
                self._connections[connection_id] = info
                self._connection_health_checked_at[connection_id] = time.monotonic()
            self._dispose_connection_resources(old_engine, old_tunnel)
            return info
        except Exception:
            self._dispose_connection_resources(engine, tunnel)
            raise
        finally:
            if open_attempt_id:
                with self._connection_open_lock:
                    if self._opening_connection_attempts.get(connection_id) == open_attempt_id:
                        self._opening_connection_attempts.pop(connection_id, None)

    def close_connection(
        self, connection_id: str, open_attempt_id: str | None = None
    ) -> ConnectionInfo:
        stored = self._stored_connections.get(connection_id)

        if stored is None:
            raise ValueError("连接不存在")

        with self._connection_open_lock:
            if open_attempt_id:
                self._cancelled_open_attempts.add((connection_id, open_attempt_id))
            active_attempt_id = self._opening_connection_attempts.get(connection_id)
            if active_attempt_id and (
                open_attempt_id is None or active_attempt_id == open_attempt_id
            ):
                self._cancelled_open_attempts.add((connection_id, active_attempt_id))
            engine = self._engines.pop(connection_id, None)
            tunnel = self._ssh_tunnels.pop(connection_id, None)
            self._connection_health_checked_at.pop(connection_id, None)
            self._reconnectable_connection_ids.discard(connection_id)
        self._dispose_connection_resources(engine, tunnel)

        request = self._request_from_stored(stored)
        info = self._connection_info(connection_id, request, stored, is_open=False)
        self._connections[connection_id] = info
        return info

    def _save_stored_connections(self) -> None:
        CONNECTION_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {"connections": [connection.model_dump() for connection in self._stored_connections.values()]}
        CONNECTION_STORE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ping_engine(self, engine: Engine | MongoClient | Redis) -> None:
        if is_mongo_client(engine):
            engine.admin.command("ping")
            return

        if is_redis_client(engine):
            engine.ping()
            return

        with engine.connect() as connection:
            connection.execute(text("SELECT 1 FROM DUAL" if engine.dialect.name in {"dm", "dmPython", "oracle"} else "SELECT 1"))

    def _dispose_engine(self, engine: Engine | MongoClient | Redis) -> None:
        if is_mongo_client(engine) or is_redis_client(engine):
            engine.close()
            return

        engine.dispose()

    def _dispose_tunnel(self, tunnel: SshTunnelHandle | None) -> None:
        if tunnel is None:
            return

        try:
            tunnel.close()
        except Exception:
            pass

    def _dispose_connection_resources(self, engine: Engine | MongoClient | Redis | None, tunnel: SshTunnelHandle | None) -> None:
        if engine is not None:
            self._dispose_engine(engine)
        self._dispose_tunnel(tunnel)

    def _open_runtime_engine(self, request: ConnectionRequest) -> tuple[Engine | MongoClient | Redis, SshTunnelHandle | None]:
        runtime_request = request.model_copy(deep=True)
        tunnel: SshTunnelHandle | None = None

        if self._uses_ssh_tunnel(request):
            tunnel = self._open_ssh_tunnel(request)
            runtime_request = runtime_request.model_copy(update={
                "host": tunnel.local_host,
                "port": tunnel.local_port,
                "ssh_enabled": False,
                "ssh_password": None,
                "ssh_passphrase": None,
            })

        try:
            return self._create_engine(runtime_request), tunnel
        except Exception:
            self._dispose_tunnel(tunnel)
            raise

    def _uses_ssh_tunnel(self, request: ConnectionRequest | StoredConnection) -> bool:
        return request.database_type != "sqlite" and bool(request.ssh_enabled)

    def _normalize_ssh_host(self, host: str | None) -> str:
        normalized = (host or "").strip()
        if not normalized:
            raise ValueError("启用 SSH 隧道时请输入 SSH 主机")
        return normalized

    def _normalize_ssh_port(self, port: int | None) -> int:
        normalized = port or 22
        if normalized < 1 or normalized > 65535:
            raise ValueError("SSH 端口必须在 1 到 65535 之间")
        return normalized

    def _normalize_remote_port(self, request: ConnectionRequest) -> int:
        if request.database_type == "clickhouse":
            primary_port, _ = _resolve_clickhouse_port(request.port)
            if not primary_port:
                raise ValueError("ClickHouse 端口不能为空")
            return primary_port

        if isinstance(request.port, int):
            return request.port

        normalized = str(request.port or "").strip()
        if normalized.isdigit():
            return int(normalized)

        raise ValueError("启用 SSH 隧道时数据库端口必须是单个端口号")

    def _open_ssh_tunnel(self, request: ConnectionRequest) -> SshTunnelHandle:
        if not request.host:
            raise ValueError("启用 SSH 隧道时数据库主机不能为空")

        try:
            from sshtunnel import SSHTunnelForwarder
        except ImportError as exc:
            raise RuntimeError("缺少 SSH 隧道依赖 sshtunnel，请先安装后重试") from exc

        ssh_host = self._normalize_ssh_host(request.ssh_host)
        ssh_port = self._normalize_ssh_port(request.ssh_port)
        ssh_username = (request.ssh_username or "").strip()
        if not ssh_username:
            raise ValueError("启用 SSH 隧道时请输入 SSH 用户名")

        ssh_auth_type = request.ssh_auth_type or "password"
        remote_port = self._normalize_remote_port(request)
        self._ensure_ssh_gateway_reachable(ssh_host, ssh_port)
        forwarder_kwargs: dict[str, Any] = {
            "ssh_address_or_host": (ssh_host, ssh_port),
            "ssh_username": ssh_username,
            "remote_bind_address": (request.host, remote_port),
            "local_bind_address": ("127.0.0.1", 0),
        }

        if ssh_auth_type == "private_key":
            private_key_path = (request.ssh_private_key_path or "").strip()
            if not private_key_path:
                raise ValueError("私钥认证时请输入私钥路径")
            private_key_file = Path(private_key_path).expanduser().resolve()
            if not private_key_file.exists():
                raise ValueError(f"SSH 私钥文件不存在：{private_key_file}")
            forwarder_kwargs["ssh_pkey"] = str(private_key_file)
            if request.ssh_passphrase:
                forwarder_kwargs["ssh_private_key_password"] = request.ssh_passphrase
        else:
            ssh_password = request.ssh_password or ""
            if not ssh_password:
                raise ValueError("密码认证时请输入 SSH 登录密码")
            forwarder_kwargs["ssh_password"] = ssh_password

        forwarder = SSHTunnelForwarder(**forwarder_kwargs)
        try:
            forwarder.start()
        except Exception as exc:
            stop = getattr(forwarder, "stop", None)
            if callable(stop):
                try:
                    stop()
                except Exception:
                    pass
            raise self._translate_ssh_session_error(exc, ssh_host, ssh_port) from exc

        return SshTunnelHandle(
            forwarder=forwarder,
            local_host="127.0.0.1",
            local_port=int(forwarder.local_bind_port),
        )

    def _translate_ssh_session_error(self, exc: Exception, ssh_host: str, ssh_port: int) -> RuntimeError:
        error_message = str(exc).lower()
        if "authentication failed" in error_message or "auth fail" in error_message:
            return RuntimeError("SSH 用户名、密码或私钥口令错误，连接被拒绝")
        if "password is required for encrypted private keys" in error_message:
            return RuntimeError("当前 SSH 私钥已加密，请填写私钥口令后重试")
        if "private key file is encrypted" in error_message:
            return RuntimeError("当前 SSH 私钥已加密，请填写私钥口令后重试")
        if "not a valid rsa private key file" in error_message or "could not deserialize key data" in error_message:
            return RuntimeError("SSH 私钥文件格式无效或内容损坏，请检查私钥文件")
        return RuntimeError(
            f"无法建立 SSH 会话（{ssh_host}:{ssh_port}）。请检查 SSH 用户、认证方式、私钥/密码以及服务端配置。原始错误：{exc}"
        )

    def _ensure_ssh_gateway_reachable(self, ssh_host: str, ssh_port: int) -> None:
        gateway_socket: socket.socket | None = None
        try:
            gateway_socket = socket.create_connection(
                (ssh_host, ssh_port), timeout=SSH_GATEWAY_CONNECT_TIMEOUT_SECONDS
            )
        except TimeoutError as exc:
            raise RuntimeError(
                f"无法连接到 SSH 网关（{ssh_host}:{ssh_port}）：连接超时。请检查 SSH 服务是否已启动、地址和端口是否正确，以及防火墙或安全组是否放行。"
            ) from exc
        except OSError as exc:
            error_code = getattr(exc, "winerror", None) or getattr(exc, "errno", None)
            if error_code in {10061, 111}:
                raise RuntimeError(
                    f"无法连接到 SSH 网关（{ssh_host}:{ssh_port}）：目标主机拒绝连接。请确认 SSH 服务已启动，并监听该端口。"
                ) from exc
            if error_code in {10060, 110}:
                raise RuntimeError(
                    f"无法连接到 SSH 网关（{ssh_host}:{ssh_port}）：连接超时。请检查网络是否可达、地址和端口是否正确，以及防火墙是否放行。"
                ) from exc
            if error_code in {10065, 113}:
                raise RuntimeError(
                    f"无法连接到 SSH 网关（{ssh_host}:{ssh_port}）：网络不可达。请检查网关地址、路由或 VPN / 局域网连接。"
                ) from exc
            raise RuntimeError(
                f"无法连接到 SSH 网关（{ssh_host}:{ssh_port}）：{exc}"
            ) from exc
        finally:
            if gateway_socket is not None:
                gateway_socket.close()

    def _create_engine(self, request: ConnectionRequest) -> Engine | MongoClient | Redis:
        if request.database_type == "sqlite":
            return self._create_sqlite_engine(request)

        if request.database_type == "mysql":
            return self._create_mysql_engine(request)

        if request.database_type == "postgresql":
            return self._create_postgresql_engine(request)

        if request.database_type == "dm":
            return self._create_dm_engine(request)

        if request.database_type == "gaussdb":
            return self._create_gaussdb_engine(request)

        if request.database_type == "oracle":
            return self._create_oracle_engine(request)

        if request.database_type == "mongodb":
            return self._create_mongodb_client(request)

        if request.database_type == "redis":
            return self._create_redis_client(request)

        if request.database_type == "clickhouse":
            return self._create_clickhouse_engine(request)

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
        return create_engine(
            url,
            pool_pre_ping=True,
            connect_args={
                "connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
                "read_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
                "write_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
            },
        )

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
        return create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS},
        )

    def _create_mongodb_client(self, request: ConnectionRequest) -> MongoClient:
        if MongoClient is None:
            raise RuntimeError("缺少 MongoDB 驱动 pymongo，请安装后重试")
        if not request.host:
            raise ValueError("MongoDB 主机不能为空")
        if not request.port:
            raise ValueError("MongoDB 端口不能为空")

        auth_source = request.database or "admin"
        kwargs = {
            "host": request.host,
            "port": request.port,
            "serverSelectionTimeoutMS": 5000,
        }

        if request.username:
            kwargs.update({
                "username": request.username,
                "password": request.password or "",
                "authSource": auth_source,
            })

        return MongoClient(**kwargs)

    def _create_redis_client(self, request: ConnectionRequest) -> Redis:
        if Redis is None:
            raise RuntimeError("缺少 Redis 驱动 redis，请安装后重试")
        if not request.host:
            raise ValueError("Redis 主机不能为空")
        if not request.port:
            raise ValueError("Redis 端口不能为空")

        try:
            database = int(request.database or 0)
        except ValueError as exc:
            raise ValueError("Redis 数据库必须是数字序号，例如 0") from exc

        if database < 0:
            raise ValueError("Redis 数据库序号不能小于 0")

        return Redis(
            host=request.host,
            port=request.port,
            username=request.username or None,
            password=request.password or None,
            db=database,
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=False,
            health_check_interval=0,
        )

    def _create_clickhouse_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("ClickHouse 主机不能为空")
        if not request.port:
            raise ValueError("ClickHouse 端口不能为空")

        _ensure_clickhouse_dialect_registered()
        primary_port, _ = _resolve_clickhouse_port(request.port)
        if not primary_port:
            raise ValueError("ClickHouse 端口不能为空")

        url = URL.create(
            "clickhousedb",
            username=request.username or "default",
            password=request.password or "",
            host=request.host,
            port=primary_port,
            database=request.database or "default",
        )
        request_snapshot = request.model_copy(deep=True)
        engine = create_engine(
            url,
            pool_pre_ping=False,
            connect_args={
                "connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
                "send_receive_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS,
            },
        )
        setattr(
            engine,
            "_datadjinn_engine_factory",
            lambda database_name: self._create_clickhouse_engine(
                request_snapshot.model_copy(update={"database": database_name})
            ),
        )
        return engine

    def _create_dm_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("达梦主机不能为空")
        if not request.port:
            raise ValueError("达梦端口不能为空")
        if not request.username:
            raise ValueError("达梦用户名不能为空")

        driver_id = _manual_driver_id(request)
        driver = driver_manager.get_driver(driver_id) if driver_id else None
        if driver is None:
            raise RuntimeError("请选择达梦驱动，请先在驱动管理中手动添加 JDBC jar、dmPython pyd 或 dmPython whl 驱动")
        if driver.database_type != "dm":
            raise RuntimeError("请选择达梦驱动")
        if not driver.enabled:
            raise RuntimeError("当前选择的达梦驱动已停用，请重新选择可用驱动")
        if not driver.path:
            raise RuntimeError("当前选择的达梦驱动路径为空，请重新添加驱动")

        driver_path = driver.path if driver.driver_type in {"python", "whl"} else None

        if driver_path:
            dm_python = _load_dm_python(driver_path, is_whl=driver.driver_type == "whl")

            def connect():
                return dm_python.connect(
                    user=request.username,
                    password=request.password or "",
                    host=request.host,
                    port=request.port,
                )

            url = URL.create("dm+dmPython", username=request.username, host=request.host, port=request.port)
            return create_engine(url, creator=connect, pool_pre_ping=True)

        if driver and driver.driver_type == "jdbc" and driver.path:
            java_enabled, java_home = driver_manager.get_jdbc_runtime_config()
            if not java_enabled or not java_home:
                raise RuntimeError("JDBC Java 环境未开启或未配置，请先在驱动管理中开启并配置全局 JDBC Java 环境")

            jdbc_path = _resolve_runtime_path(driver.path)
            if not jdbc_path.exists():
                raise RuntimeError(f"达梦 JDBC 驱动文件不存在：{jdbc_path}")

            required_java_major = java_runtime.required_java_major_from_jar(jdbc_path)
            jvm_path = java_runtime.prepare_jdbc_runtime(required_java_major, java_home)
            if jvm_path is None:
                raise RuntimeError("未找到可用的 Java JVM，请先在驱动管理中配置全局 JDBC Java 环境")

            jdbc_url = f"jdbc:dm://{request.host}:{request.port}"

            try:
                jpype, jaydebeapi = load_jdbc_bridge()
                jpype_support_library = _ensure_jpype_support_library(jpype)
                if jpype.isJVMStarted():
                    jpype.addClassPath(str(jpype_support_library))
                    jpype.addClassPath(str(jdbc_path))
                else:
                    jpype.startJVM(jvm_path, classpath=[str(jpype_support_library), str(jdbc_path)])
            except ImportError as exc:
                raise RuntimeError("JDBC 桥接模块无法加载，请在“设置 -> 扩展”中重新安装 JDBC 桥接模块。") from exc

            def connect_jdbc():
                connection = jaydebeapi.connect("dm.jdbc.driver.DmDriver", jdbc_url, [request.username, request.password or ""], str(jdbc_path))
                _set_jdbc_autocommit(connection, False)
                return DmJdbcConnectionAdapter(connection)

            dialect = JdbcReconnectDialect("dm", "SELECT 1 FROM DUAL")
            engine = Engine(
                QueuePool(connect_jdbc, pre_ping=True, dialect=dialect),
                dialect,
                URL.create("dm-jdbc", username=request.username, host=request.host, port=request.port),
            )
            return engine

        raise RuntimeError("未配置达梦驱动，请先在驱动管理中手动添加 JDBC jar、dmPython pyd 或 dmPython whl 驱动")

    def _create_gaussdb_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("高斯数据库主机不能为空")
        if not request.port:
            raise ValueError("高斯数据库端口不能为空")
        if not request.username:
            raise ValueError("高斯数据库用户名不能为空")
        if not request.database:
            raise ValueError("高斯数据库名不能为空")

        driver_id = _manual_driver_id(request)
        driver = driver_manager.get_driver(driver_id) if driver_id else None
        if driver is None:
            raise RuntimeError("请选择高斯数据库 JDBC 驱动，请先在驱动管理中手动添加 JDBC jar 驱动")
        if driver.database_type != "gaussdb":
            raise RuntimeError("请选择高斯数据库驱动")
        if not driver.enabled:
            raise RuntimeError("当前选择的高斯数据库驱动已停用，请重新选择可用驱动")
        if driver.driver_type != "jdbc":
            raise RuntimeError("高斯数据库当前仅支持 JDBC jar 驱动")
        if not driver.path:
            raise RuntimeError("当前选择的高斯数据库驱动路径为空，请重新添加驱动")

        java_enabled, java_home = driver_manager.get_jdbc_runtime_config()
        if not java_enabled or not java_home:
            raise RuntimeError("JDBC Java 环境未开启或未配置，请先在驱动管理中开启并配置全局 JDBC Java 环境")

        jdbc_path = _resolve_runtime_path(driver.path)
        if not jdbc_path.exists():
            raise RuntimeError(f"高斯数据库 JDBC 驱动文件不存在：{jdbc_path}")

        required_java_major = java_runtime.required_java_major_from_jar(jdbc_path)
        jvm_path = java_runtime.prepare_jdbc_runtime(required_java_major, java_home)
        if jvm_path is None:
            raise RuntimeError("未找到可用的 Java JVM，请先在驱动管理中配置全局 JDBC Java 环境")

        driver_class, jdbc_scheme = _detect_gaussdb_jdbc_driver(jdbc_path)
        jdbc_url = f"{jdbc_scheme}://{request.host}:{request.port}/{request.database}"

        try:
            jpype, jaydebeapi = load_jdbc_bridge()
            jpype_support_library = _ensure_jpype_support_library(jpype)
            if jpype.isJVMStarted():
                jpype.addClassPath(str(jpype_support_library))
                jpype.addClassPath(str(jdbc_path))
            else:
                jpype.startJVM(jvm_path, classpath=[str(jpype_support_library), str(jdbc_path)])
        except ImportError as exc:
            raise RuntimeError("JDBC 桥接模块无法加载，请在“设置 -> 扩展”中重新安装 JDBC 桥接模块。") from exc

        def connect_jdbc():
            connection = jaydebeapi.connect(driver_class, jdbc_url, [request.username, request.password or ""], str(jdbc_path))
            _set_jdbc_autocommit(connection, False)
            return DmJdbcConnectionAdapter(connection)

        dialect = JdbcReconnectDialect("gaussdb", "SELECT 1")
        request_snapshot = request.model_copy(deep=True)

        engine = Engine(
            QueuePool(connect_jdbc, pre_ping=True, dialect=dialect),
            dialect,
            URL.create("gaussdb-jdbc", username=request.username, host=request.host, port=request.port, database=request.database),
        )
        setattr(
            engine,
            "_datadjinn_engine_factory",
            lambda database_name: self._create_gaussdb_engine(request_snapshot.model_copy(update={"database": database_name})),
        )
        return engine

    def _create_oracle_engine(self, request: ConnectionRequest) -> Engine:
        if not request.host:
            raise ValueError("Oracle 主机不能为空")
        if not request.port:
            raise ValueError("Oracle 端口不能为空")
        if not request.username:
            raise ValueError("Oracle 用户名不能为空")
        if not request.database:
            raise ValueError("Oracle 服务名不能为空")

        try:
            import oracledb
        except ImportError as exc:
            raise RuntimeError("缺少 Oracle Python 驱动 oracledb，请先安装后重试") from exc

        def connect():
            return oracledb.connect(
                user=request.username,
                password=request.password or "",
                host=request.host,
                port=request.port,
                service_name=request.database,
                tcp_connect_timeout=DATABASE_CONNECT_TIMEOUT_SECONDS,
            )

        url = URL.create(
            "oracle+oracledb",
            username=request.username,
            password=request.password or "",
            host=request.host,
            port=request.port,
        )
        return create_engine(url, creator=connect, pool_pre_ping=True)

    def _detect_server_version(self, engine: Engine | MongoClient | Redis) -> str | None:
        if is_redis_client(engine):
            try:
                info = engine.info("server")
                return str(info.get("redis_version")) if info.get("redis_version") else None
            except Exception:
                return None

        if is_mongo_client(engine):
            return None

        if _is_clickhouse_engine(engine) or engine.dialect.name == "gaussdb":
            try:
                with engine.connect() as connection:
                    version = connection.execute(text("SELECT version()")).scalar()
                    return str(version) if version is not None else None
            except Exception:
                return None

        if engine.dialect.name == "oracle":
            sql_candidates = [
                "SELECT BANNER FROM V$VERSION",
                "SELECT VERSION_FULL FROM PRODUCT_COMPONENT_VERSION WHERE PRODUCT LIKE 'Oracle%'",
                "SELECT VERSION FROM PRODUCT_COMPONENT_VERSION WHERE PRODUCT LIKE 'Oracle%'",
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
            host=request.host,
            port=request.port,
            database=self._display_database(request),
            has_password=bool(request.password) or bool(
                stored
                and stored.encrypted_password
                and "password" not in self._unavailable_secret_fields.get(connection_id, set())
            ),
            is_open=is_open,
            server_version=server_version,
            git_versioning_enabled=request.git_versioning_enabled,
        )

    def _stored_connection(self, connection_id: str, request: ConnectionRequest) -> StoredConnection:
        normalized_private_key_path = None
        if request.ssh_private_key_path:
            normalized_private_key_path = str(Path(request.ssh_private_key_path).expanduser().resolve())

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
            driver_id=_manual_driver_id(request),
            driver_path=_manual_driver_path(request),
            dm_driver_id=request.dm_driver_id,
            dm_driver_path=request.dm_driver_path,
            ssh_enabled=bool(request.ssh_enabled),
            ssh_host=request.ssh_host,
            ssh_port=(request.ssh_port or 22) if request.ssh_enabled else None,
            ssh_username=request.ssh_username,
            ssh_auth_type=(request.ssh_auth_type or "password") if request.ssh_enabled else None,
            encrypted_ssh_password=_encrypt_password(request.ssh_password) if request.ssh_enabled else None,
            ssh_private_key_path=normalized_private_key_path if request.ssh_enabled else None,
            encrypted_ssh_passphrase=_encrypt_password(request.ssh_passphrase) if request.ssh_enabled else None,
            git_versioning_enabled=bool(request.git_versioning_enabled),
            git_versioning_scopes=list(dict.fromkeys(request.git_versioning_scopes)),
        )

    def _display_database(self, request: ConnectionRequest) -> str:
        if request.database_type == "sqlite":
            return str(Path(request.sqlite_path or "").expanduser().resolve())

        if request.database_type == "postgresql":
            return f"{request.database}@{request.host}:{request.port}"

        if request.database_type == "dm":
            return request.database or f"{request.host}:{request.port}"

        if request.database_type == "gaussdb":
            return f"{request.database}@{request.host}:{request.port}"

        if request.database_type == "oracle":
            return f"{request.database}@{request.host}:{request.port}"

        if request.database_type == "mongodb":
            return request.database or f"{request.host}:{request.port}"

        if request.database_type == "redis":
            return f"db{request.database or 0}@{request.host}:{request.port}"

        if request.database_type == "clickhouse":
            return f"{request.database or 'default'}@{request.host}:{request.port}"

        return request.database or f"{request.host}:{request.port}"


connection_manager = ConnectionManager()
