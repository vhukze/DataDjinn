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
