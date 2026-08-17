import os
import sys
import threading
import time
import ctypes
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


def _configure_optional_jdbc_runtime() -> None:
    """Expose the separately installed JDBC bridge before importing the API app."""
    configured_path = os.environ.get("DATADJINN_JDBC_RUNTIME_PATH", "").strip()
    if not configured_path:
        return

    runtime_path = Path(configured_path).expanduser()
    python_path = runtime_path / "python"
    required_paths = [
        python_path / "jpype" / "__init__.py",
        python_path / "org.jpype.jar",
        python_path / "jaydebeapi" / "__init__.py",
    ]
    if all(path.exists() for path in required_paths):
        sys.path.insert(0, str(python_path))


_configure_optional_jdbc_runtime()

import uvicorn

from app.main import app


def _process_exists(pid: int) -> bool:
    if os.name == "nt":
        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
        if handle == 0:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _start_parent_watchdog() -> None:
    parent_pid = os.environ.get("DATADJINN_PARENT_PID", "").strip()
    if not parent_pid:
        return

    try:
        target_pid = int(parent_pid)
    except ValueError:
        return

    if target_pid <= 0:
        return

    def watch_parent() -> None:
        while True:
            time.sleep(2)
            if not _process_exists(target_pid):
                os._exit(0)

    threading.Thread(target=watch_parent, name="datadjinn-parent-watchdog", daemon=True).start()

if __name__ == "__main__":
    port = int(os.environ.get("DATADJINN_BACKEND_PORT", "8000"))
    reload = os.environ.get("DATADJINN_BACKEND_RELOAD", "0") == "1"
    _start_parent_watchdog()
    uvicorn.run(
        app if not reload else "app.main:app",
        host="127.0.0.1",
        port=port,
        reload=reload,
        reload_dirs=[str(BACKEND_DIR / "app")] if reload else None,
    )
