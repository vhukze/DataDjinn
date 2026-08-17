import unittest

from app.git_sync.sync_payload import (
    DataDjinnSyncPayload,
    merge_sync_payloads,
    resolve_sync_conflicts,
)


def payload(
    *,
    device_id: str,
    connections: dict | None = None,
    settings: dict | None = None,
    preferences: dict | None = None,
) -> DataDjinnSyncPayload:
    return DataDjinnSyncPayload(
        device_id=device_id,
        connections=connections or {},
        settings=settings or {},
        preferences=preferences or {},
    )


class SyncPayloadMergeTests(unittest.TestCase):
    def test_merges_changes_to_different_fields(self) -> None:
        base = payload(
            device_id="base",
            connections={"connection-1": {"name": "测试库", "host": "127.0.0.1"}},
            settings={"theme": "dark", "query_timeout": 15},
        )
        local = payload(
            device_id="local",
            connections={"connection-1": {"name": "本地名称", "host": "127.0.0.1"}},
            settings={"theme": "dark", "query_timeout": 30},
        )
        remote = payload(
            device_id="remote",
            connections={"connection-1": {"name": "测试库", "host": "10.0.0.8"}},
            settings={"theme": "light", "query_timeout": 15},
        )

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual(result.conflicts, [])
        self.assertEqual(
            result.payload.connections["connection-1"],
            {"name": "本地名称", "host": "10.0.0.8"},
        )
        self.assertEqual(result.payload.settings, {"theme": "light", "query_timeout": 30})
        self.assertEqual(result.payload.device_id, "local")

    def test_reports_only_the_field_changed_differently_on_both_devices(self) -> None:
        base = payload(device_id="base", settings={"theme": "dark", "timeout": 15})
        local = payload(device_id="local", settings={"theme": "light", "timeout": 30})
        remote = payload(device_id="remote", settings={"theme": "system", "timeout": 15})

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual([item.path for item in result.conflicts], ["settings.theme"])
        self.assertEqual(result.payload.settings["theme"], "light")
        self.assertEqual(result.payload.settings["timeout"], 30)

    def test_merges_connections_added_independently(self) -> None:
        base = payload(device_id="base")
        local = payload(device_id="local", connections={"local-id": {"name": "本地库"}})
        remote = payload(device_id="remote", connections={"remote-id": {"name": "远程库"}})

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual(result.conflicts, [])
        self.assertEqual(set(result.payload.connections), {"local-id", "remote-id"})

    def test_delete_against_remote_edit_is_a_conflict(self) -> None:
        base = payload(device_id="base", connections={"id": {"name": "原名称"}})
        local = payload(device_id="local")
        remote = payload(device_id="remote", connections={"id": {"name": "远程名称"}})

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual([item.path for item in result.conflicts], ["connections.id"])
        self.assertFalse(result.conflicts[0].local_exists)
        self.assertNotIn("id", result.payload.connections)

    def test_delete_propagates_when_other_side_is_unchanged(self) -> None:
        base = payload(device_id="base", connections={"id": {"name": "原名称"}})
        local = payload(device_id="local")
        remote = payload(device_id="remote", connections={"id": {"name": "原名称"}})

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual(result.conflicts, [])
        self.assertNotIn("id", result.payload.connections)

    def test_resolves_conflict_using_structured_path_segments(self) -> None:
        base = payload(device_id="base", connections={"connection.with.dot": {"name": "原名称"}})
        local = payload(device_id="local", connections={"connection.with.dot": {"name": "本地名称"}})
        remote = payload(device_id="remote", connections={"connection.with.dot": {"name": "远程名称"}})
        result = merge_sync_payloads(base, local, remote)

        resolved = resolve_sync_conflicts(
            result.payload,
            result.conflicts,
            {result.conflicts[0].key: "remote"},
        )

        self.assertEqual(resolved.connections["connection.with.dot"]["name"], "远程名称")

    def test_refuses_to_resolve_when_any_choice_is_missing(self) -> None:
        base = payload(device_id="base", settings={"theme": "dark"})
        local = payload(device_id="local", settings={"theme": "light"})
        remote = payload(device_id="remote", settings={"theme": "system"})
        result = merge_sync_payloads(base, local, remote)

        with self.assertRaisesRegex(ValueError, "仍有 1 项同步冲突未处理"):
            resolve_sync_conflicts(result.payload, result.conflicts, {})

    def test_merges_all_connection_tree_order_fields_as_one_conflict(self) -> None:
        base = payload(
            device_id="base",
            preferences={
                "root_item_order": ["folder:one", "connection:one"],
                "folder_connection_order": {"folder:one": ["connection:one"]},
            },
        )
        local = payload(
            device_id="local",
            preferences={
                "root_item_order": ["folder:one", "connection:two"],
                "folder_connection_order": {"folder:one": ["connection:two"]},
            },
        )
        remote = payload(
            device_id="remote",
            preferences={
                "root_item_order": ["connection:two", "folder:one"],
                "folder_connection_order": {"folder:one": ["connection:one"]},
            },
        )

        result = merge_sync_payloads(base, local, remote)

        self.assertEqual([item.path for item in result.conflicts], ["preferences.tree_order"])
        self.assertNotIn("root_item_order", result.payload.preferences)
        self.assertNotIn("folder_connection_order", result.payload.preferences)

        resolved = resolve_sync_conflicts(
            result.payload,
            result.conflicts,
            {result.conflicts[0].key: "remote"},
        )
        self.assertEqual(
            resolved.preferences["tree_order"]["roots"],
            ["connection:two", "folder:one"],
        )

    def test_remote_tree_choice_keeps_a_locally_added_connection_in_its_group(self) -> None:
        base = payload(
            device_id="base",
            connections={"existing": {"name": "已有连接"}},
            preferences={
                "connection_folders": [{"id": "team", "name": "团队"}],
                "connection_folder_assignments": {"existing": "team"},
                "tree_order": {
                    "roots": ["folder:team", "connection:root"],
                    "children": {"team": ["connection:existing"]},
                },
            },
        )
        local = payload(
            device_id="local",
            connections={
                "existing": {"name": "已有连接"},
                "new-local": {"name": "本机新连接"},
            },
            preferences={
                "connection_folders": [{"id": "team", "name": "团队"}],
                "connection_folder_assignments": {"existing": "team", "new-local": "team"},
                "tree_order": {
                    "roots": ["folder:team", "connection:root"],
                    "children": {"team": ["connection:existing", "connection:new-local"]},
                },
            },
        )
        remote = payload(
            device_id="remote",
            connections={"existing": {"name": "已有连接"}},
            preferences={
                "connection_folders": [{"id": "team", "name": "团队"}],
                "connection_folder_assignments": {"existing": "team"},
                "tree_order": {
                    "roots": ["connection:root", "folder:team"],
                    "children": {"team": ["connection:existing"]},
                },
            },
        )

        merged = merge_sync_payloads(base, local, remote)
        resolved = resolve_sync_conflicts(
            merged.payload,
            merged.conflicts,
            {merged.conflicts[0].key: "remote"},
        )

        self.assertEqual(set(resolved.connections), {"existing", "new-local"})
        self.assertEqual(
            resolved.preferences["connection_folder_assignments"]["new-local"], "team"
        )
        self.assertEqual(
            resolved.preferences["tree_order"]["children"]["team"],
            ["connection:existing", "connection:new-local"],
        )

    def test_normalizes_legacy_order_to_nested_connection_tree(self) -> None:
        payload_value = payload(
            device_id="local",
            preferences={
                "connection_folders": [
                    {"id": "production", "name": "生产"},
                    {"id": "reporting", "name": "报表", "parentId": "production"},
                ],
                "connection_folder_order": ["production", "reporting"],
                "root_item_order": ["folder:production", "connection:root"],
                "folder_connection_order": {
                    "production": ["connection:main"],
                    "reporting": ["connection:analytics"],
                },
            },
        )

        result = merge_sync_payloads(payload_value, payload_value, payload_value)

        self.assertEqual(
            result.payload.preferences["tree_order"],
            {
                "roots": ["folder:production", "connection:root"],
                "children": {
                    "production": ["folder:reporting", "connection:main"],
                    "reporting": ["connection:analytics"],
                },
            },
        )


if __name__ == "__main__":
    unittest.main()
