from __future__ import annotations

import os
import sys
from pathlib import Path
from types import ModuleType


JDBC_RUNTIME_ENV = "DATADJINN_JDBC_RUNTIME_PATH"


def _runtime_python_path() -> Path | None:
    configured_path = os.environ.get(JDBC_RUNTIME_ENV, "").strip()
    if not configured_path:
        return None
    return Path(configured_path).expanduser() / "python"


def load_jdbc_bridge() -> tuple[ModuleType, ModuleType]:
    """Load JPype and JayDeBeApi only from the installed JDBC runtime module."""
    python_path = _runtime_python_path()
    if python_path is None:
        raise RuntimeError(
            "JDBC 桥接模块未安装，请先在“设置 -> 扩展”中安装 JDBC 桥接模块。"
        )

    required_paths = [
        python_path / "jpype" / "__init__.py",
        python_path / "jaydebeapi" / "__init__.py",
        python_path / "org.jpype.jar",
    ]
    if not all(path.exists() for path in required_paths):
        raise RuntimeError(
            "JDBC 桥接模块文件不完整，请在“设置 -> 扩展”中重新安装 JDBC 桥接模块。"
        )

    normalized_path = str(python_path.resolve())
    if normalized_path not in sys.path:
        sys.path.insert(0, normalized_path)

    try:
        import jaydebeapi
        import jpype
    except ImportError as exc:
        raise RuntimeError(
            "JDBC 桥接模块无法加载，请在“设置 -> 扩展”中重新安装 JDBC 桥接模块。"
        ) from exc

    return jpype, jaydebeapi
