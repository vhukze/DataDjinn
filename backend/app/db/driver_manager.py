import json
import os
import re
import sys
from pathlib import Path
from uuid import uuid4

from app.db.java_runtime import validate_java_home
from app.schemas.driver import DriverCreateRequest, DriverInfo


def _driver_data_dir() -> Path:
    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return Path(data_dir).expanduser().resolve()

    return Path(__file__).resolve().parents[2] / "data"


def _driver_store_path() -> Path:
    return _driver_data_dir() / "drivers.json"


def _jdbc_runtime_store_path() -> Path:
    return _driver_data_dir() / "jdbc_runtime.json"


DRIVER_STORE_PATH = _driver_store_path()
JDBC_RUNTIME_STORE_PATH = _jdbc_runtime_store_path()


def _validate_whl_compatibility(path: Path) -> None:
    name = path.name.lower()
    py_tags = [f"cp{tag}" for tag in re.findall(r"cp(\d{2,3})", name)]
    current_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if py_tags and all(tag != current_tag for tag in py_tags):
        supported = ", ".join(f"Python {tag.removeprefix('cp')[0]}.{tag.removeprefix('cp')[1:]}" for tag in sorted(set(py_tags)))
        raise ValueError(f"当前 Python 是 {sys.version_info.major}.{sys.version_info.minor}，该 whl 适用于 {supported}，请下载匹配 {current_tag} 的 Windows 64 位 whl")

    if any(tag in name for tag in ["linux", "manylinux", "musllinux"]):
        raise ValueError("当前选择的是 Linux 版 whl，请下载 Windows 版 win_amd64 whl")

    if "win" not in name:
        raise ValueError("当前 whl 文件名未包含 Windows 平台标识，请确认下载的是 Windows 64 位 win_amd64 版本")


def _resolve_runtime_path(path: str) -> Path:
    target = Path(path).expanduser()
    if target.is_absolute():
        return target.resolve()

    data_dir = os.environ.get("DATADJINN_DATA_DIR")
    if data_dir:
        return (Path(data_dir).expanduser().resolve() / target).resolve()

    return target.resolve()


class DriverManager:
    def __init__(self) -> None:
        self._drivers: dict[str, DriverInfo] = {}
        self._load_drivers()

    def list_drivers(self) -> list[DriverInfo]:
        return list(self._drivers.values())

    def get_driver(self, driver_id: str) -> DriverInfo | None:
        return self._drivers.get(driver_id)

    def get_jdbc_runtime_config(self) -> tuple[bool, str | None]:
        if not JDBC_RUNTIME_STORE_PATH.exists():
            return False, None

        try:
            data = json.loads(JDBC_RUNTIME_STORE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False, None

        java_home = data.get("java_home")
        return bool(data.get("enabled", False)), str(java_home) if java_home else None

    def is_jdbc_java_enabled(self) -> bool:
        enabled, _ = self.get_jdbc_runtime_config()
        return enabled

    def get_jdbc_java_home(self) -> str | None:
        _, java_home = self.get_jdbc_runtime_config()
        return java_home

    def set_jdbc_java_config(self, enabled: bool, java_home: str | None) -> tuple[Path | None, int | None, Path | None, bool]:
        home = None
        major = None
        jvm_dll = None

        if enabled:
            if not java_home:
                raise ValueError("开启 JDBC Java 环境前请选择 Java 目录")
            home, major, jvm_dll = validate_java_home(java_home)
        elif java_home:
            home = Path(java_home).expanduser().resolve()

        JDBC_RUNTIME_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        JDBC_RUNTIME_STORE_PATH.write_text(json.dumps({"enabled": enabled, "java_home": str(home) if home else None}, ensure_ascii=False, indent=2), encoding="utf-8")
        return home, major, jvm_dll, enabled

    def add_driver(self, request: DriverCreateRequest, source: str = "manual") -> DriverInfo:
        if request.database_type == "gaussdb" and request.driver_type != "jdbc":
            raise ValueError("高斯数据库当前仅支持 JDBC jar 驱动配置")
        if request.driver_type in {"python", "jdbc", "whl"} and not request.path:
            raise ValueError("请选择驱动文件")

        driver_path = str(_resolve_runtime_path(request.path)) if request.path else None
        if driver_path:
            path = Path(driver_path)
            if not path.exists():
                raise ValueError(f"驱动文件不存在：{path}")
            if request.driver_type == "python" and path.suffix.lower() != ".pyd":
                raise ValueError("dmPython 驱动请选择 .pyd 文件")
            if request.driver_type == "jdbc" and path.suffix.lower() != ".jar":
                raise ValueError("JDBC 驱动请选择 .jar 文件")
            if request.driver_type == "whl":
                if path.suffix.lower() != ".whl":
                    raise ValueError("达梦 whl 驱动请选择 .whl 文件")
                _validate_whl_compatibility(path)

        driver = DriverInfo(
            id=uuid4().hex,
            database_type=request.database_type,
            driver_type=request.driver_type,
            name=request.name,
            source=source,
            enabled=request.enabled,
            path=driver_path,
        )
        self._drivers[driver.id] = driver
        self._save_drivers()
        return driver

    def delete_driver(self, driver_id: str) -> bool:
        deleted = self._drivers.pop(driver_id, None)
        if deleted is None:
            return False
        self._save_drivers()
        return True

    def detect_drivers(self, database_type: str = "dm") -> tuple[list[DriverInfo], list[DriverInfo]]:
        return [], []

    def preferred_dm_driver(self) -> DriverInfo | None:
        enabled = [driver for driver in self._drivers.values() if driver.database_type == "dm" and driver.enabled]
        python_driver = next((driver for driver in enabled if driver.driver_type == "python" and driver.path), None)
        if python_driver:
            return python_driver
        whl_driver = next((driver for driver in enabled if driver.driver_type == "whl" and driver.path), None)
        if whl_driver:
            return whl_driver
        return next((driver for driver in enabled if driver.driver_type == "jdbc" and driver.path), None)

    def test_driver(self, driver_id: str) -> None:
        driver = self.get_driver(driver_id)
        if driver is None:
            raise ValueError("驱动不存在")

        if driver.driver_type not in {"python", "jdbc", "whl"}:
            raise ValueError("不支持的驱动类型")
        if not driver.path:
            raise ValueError("驱动路径为空")

        path = _resolve_runtime_path(driver.path)
        if not path.exists():
            raise ValueError(f"驱动文件不存在：{path}")
        if driver.driver_type == "python" and path.suffix.lower() != ".pyd":
            raise ValueError("dmPython 驱动请选择 .pyd 文件")
        if driver.driver_type == "jdbc" and path.suffix.lower() != ".jar":
            raise ValueError("JDBC 驱动请选择 .jar 文件")
        if driver.driver_type == "whl" and path.suffix.lower() != ".whl":
            raise ValueError("达梦 whl 驱动请选择 .whl 文件")

    def _load_drivers(self) -> None:
        if not DRIVER_STORE_PATH.exists():
            return

        data = json.loads(DRIVER_STORE_PATH.read_text(encoding="utf-8"))
        self._drivers = {item.id: item for item in [DriverInfo.model_validate(raw) for raw in data.get("drivers", [])]}

    def _save_drivers(self) -> None:
        DRIVER_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        data = {"drivers": [driver.model_dump() for driver in self._drivers.values()]}
        DRIVER_STORE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


driver_manager = DriverManager()
