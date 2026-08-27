from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any

from app.db.connection_manager import _data_dir


_PREFERENCES_FILE_NAME = "connection-tree-preferences.json"
_preferences_lock = RLock()


def _preferences_path() -> Path:
    return _data_dir() / _PREFERENCES_FILE_NAME


def load_connection_tree_preferences() -> tuple[bool, dict[str, Any]]:
    path = _preferences_path()
    if not path.exists():
        return False, {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, {}

    return isinstance(payload, dict), payload if isinstance(payload, dict) else {}


def save_connection_tree_preferences(preferences: dict[str, Any]) -> dict[str, Any]:
    path = _preferences_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(preferences, ensure_ascii=False, indent=2, sort_keys=True)
    temporary_path = path.with_suffix(".tmp")

    with _preferences_lock:
        temporary_path.write_text(content, encoding="utf-8")
        temporary_path.replace(path)

    return preferences
