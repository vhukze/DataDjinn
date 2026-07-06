import json
import os
import sys
import threading
import time
import ctypes
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
VENDORED_JPYPE_PATH = BACKEND_DIR / "vendor" / "jpype15"
VENDORED_JPYPE_MANIFEST = BACKEND_DIR / "vendor" / "jpype15.json"


def _is_complete_vendored_jpype_path(vendor_path: Path) -> bool:
    return (
        (vendor_path / "jpype" / "__init__.py").exists()
        and (vendor_path / "org.jpype.jar").exists()
        and (any(vendor_path.glob("_jpype*.pyd")) or any(vendor_path.glob("_jpype*.so")))
    )


def _resolve_vendored_jpype_path() -> Path:
    if VENDORED_JPYPE_MANIFEST.exists():
        try:
            manifest = json.loads(VENDORED_JPYPE_MANIFEST.read_text(encoding="utf-8"))
            manifest_vendor_path = Path(manifest.get("vendor_dir", ""))
            if _is_complete_vendored_jpype_path(manifest_vendor_path):
                return manifest_vendor_path
        except (OSError, json.JSONDecodeError, TypeError):
            pass

    return VENDORED_JPYPE_PATH


vendored_jpype_path = _resolve_vendored_jpype_path()
if _is_complete_vendored_jpype_path(vendored_jpype_path):
    sys.path.insert(0, str(vendored_jpype_path))

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
    uvicorn.run(app if not reload else "app.main:app", host="127.0.0.1", port=port, reload=reload)
