import json
from os import utime
from pathlib import Path

from app import connection_tree_preferences as preferences_store


def test_connection_tree_preferences_round_trip(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences_store, "_data_dir", lambda: Path(tmp_path))

    exists, preferences = preferences_store.load_connection_tree_preferences()

    assert exists is False
    assert preferences == {}

    expected = {
        "connection_folders": [{"id": "folder-1", "name": "生产"}],
        "selected_databases": {"connection-1": ["default"]},
    }
    assert preferences_store.save_connection_tree_preferences(expected) == expected
    assert (tmp_path / "connection-tree-preferences.json").exists()

    exists, preferences = preferences_store.load_connection_tree_preferences()

    assert exists is True
    assert preferences == expected


def test_older_tree_preferences_cannot_overwrite_newer_snapshot(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences_store, "_data_dir", lambda: Path(tmp_path))

    latest = {"connection_folder_assignments": {"new": "folder"}}
    older = {"connection_folder_assignments": {"old": "folder"}}
    preferences_store.save_connection_tree_preferences(latest, updated_at=2_000)
    preferences_store.save_connection_tree_preferences(older, updated_at=1_000)

    exists, preferences = preferences_store.load_connection_tree_preferences()
    assert exists is True
    assert preferences == latest


def test_logical_version_is_not_rejected_when_file_mtime_is_ahead(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences_store, "_data_dir", lambda: Path(tmp_path))

    latest = {"selected_databases": {"connection-1": ["orders"]}}
    newer = {"selected_databases": {"connection-1": ["customers"]}}
    preferences_store.save_connection_tree_preferences(latest, updated_at=2_000)
    preferences_path = tmp_path / "connection-tree-preferences.json"
    utime(preferences_path, ns=(9_999_999_999_000_000_000, 9_999_999_999_000_000_000))

    assert preferences_store.save_connection_tree_preferences(newer, updated_at=3_000) == newer
    assert preferences_store.get_connection_tree_preferences_updated_at() == 3_000
    assert preferences_store.load_connection_tree_preferences()[1] == newer


def test_legacy_snapshot_does_not_expose_file_mtime_as_logical_version(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(preferences_store, "_data_dir", lambda: Path(tmp_path))

    (tmp_path / "connection-tree-preferences.json").write_text(
        json.dumps({"selected_databases": {"connection-1": ["orders"]}}), encoding="utf-8"
    )

    assert preferences_store.get_connection_tree_preferences_updated_at() is None
