from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from time import time
from typing import Any

from app.db.connection_manager import _data_dir


_PREFERENCES_FILE_NAME = "connection-tree-preferences.json"
_PREFERENCES_META_FILE_NAME = "connection-tree-preferences.meta.json"
_preferences_lock = RLock()


def _preferences_path() -> Path:
    return _data_dir() / _PREFERENCES_FILE_NAME


def _preferences_meta_path() -> Path:
    return _data_dir() / _PREFERENCES_META_FILE_NAME


def _read_updated_at() -> int | None:
    try:
        payload = json.loads(_preferences_meta_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    value = payload.get("updated_at") if isinstance(payload, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def get_connection_tree_preferences_updated_at() -> int | None:
    if not _preferences_path().exists():
        return None

    return _read_updated_at()


def load_connection_tree_preferences() -> tuple[bool, dict[str, Any]]:
    path = _preferences_path()
    if not path.exists():
        return False, {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, {}

    return isinstance(payload, dict), payload if isinstance(payload, dict) else {}


def save_connection_tree_preferences(
    preferences: dict[str, Any], updated_at: int | None = None
) -> dict[str, Any]:
    path = _preferences_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(preferences, ensure_ascii=False, indent=2, sort_keys=True)
    temporary_path = path.with_suffix(".tmp")

    with _preferences_lock:
        requested_updated_at = (
            int(updated_at)
            if isinstance(updated_at, (int, float)) and not isinstance(updated_at, bool)
            else int(time() * 1000)
        )
        current_updated_at = _read_updated_at()
        if current_updated_at is not None and current_updated_at >= requested_updated_at:
            _, current_preferences = load_connection_tree_preferences()
            return current_preferences
        temporary_path.write_text(content, encoding="utf-8")
        temporary_path.replace(path)
        temporary_meta_path = _preferences_meta_path().with_suffix(".tmp")
        temporary_meta_path.write_text(
            json.dumps({"updated_at": requested_updated_at}), encoding="utf-8"
        )
        temporary_meta_path.replace(_preferences_meta_path())

    return preferences
