from __future__ import annotations

import importlib.util
import os
import sys
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Any


DATA_VERSIONING_MODULE_ENV = "DATADJINN_DATA_VERSIONING_MODULE_PATH"
DATA_VERSIONING_MODULE_ENTRY = "data_history.py"


class DataVersioningModuleUnavailable(ValueError):
    """Raised when an optional data versioning runtime is not installed."""


def data_versioning_module_path() -> Path | None:
    configured = os.environ.get(DATA_VERSIONING_MODULE_ENV, "").strip()
    if not configured:
        return None
    path = Path(configured).expanduser()
    return path if (path / DATA_VERSIONING_MODULE_ENTRY).is_file() else None


def is_data_versioning_module_installed() -> bool:
    return data_versioning_module_path() is not None


@lru_cache(maxsize=1)
def _load_data_versioning_module() -> ModuleType:
    module_path = data_versioning_module_path()
    if module_path is None:
        raise DataVersioningModuleUnavailable(
            "表数据版本管理扩展尚未安装，请先在“设置 -> 扩展”中安装“Git 表数据版本管理”"
        )
    spec = importlib.util.spec_from_file_location(
        "datadjinn_optional_data_versioning", module_path / DATA_VERSIONING_MODULE_ENTRY
    )
    if spec is None or spec.loader is None:
        raise DataVersioningModuleUnavailable("表数据版本管理扩展文件无效，请重新安装扩展")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def get_data_versioning_service() -> Any:
    service = getattr(_load_data_versioning_module(), "data_versioning_service", None)
    if service is None:
        raise DataVersioningModuleUnavailable("表数据版本管理扩展缺少服务入口，请重新安装扩展")
    return service


def schedule_data_snapshot(*args: Any, **kwargs: Any) -> None:
    """Skip background snapshots until the optional runtime has been installed."""
    if not is_data_versioning_module_installed():
        return
    get_data_versioning_service().schedule_snapshot(*args, **kwargs)
