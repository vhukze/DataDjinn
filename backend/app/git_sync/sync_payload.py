from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

SYNC_PAYLOAD_FORMAT = "datadjinn-sync"
SYNC_PAYLOAD_VERSION = 1
_MISSING = object()


class DataDjinnSyncPayload(BaseModel):
    format: Literal["datadjinn-sync"] = SYNC_PAYLOAD_FORMAT
    version: Literal[1] = SYNC_PAYLOAD_VERSION
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    device_id: str = Field(min_length=1)
    connections: dict[str, dict[str, Any]] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    preferences: dict[str, Any] = Field(default_factory=dict)


class SyncConflict(BaseModel):
    key: str
    path: str
    path_segments: list[str]
    base_exists: bool
    local_exists: bool
    remote_exists: bool
    base: Any = None
    local: Any = None
    remote: Any = None


class SyncMergeResult(BaseModel):
    payload: DataDjinnSyncPayload
    conflicts: list[SyncConflict]


def resolve_sync_conflicts(
    payload: DataDjinnSyncPayload,
    conflicts: list[SyncConflict],
    choices: dict[str, Literal["local", "remote"]],
) -> DataDjinnSyncPayload:
    unresolved = [conflict.path for conflict in conflicts if conflict.key not in choices]
    if unresolved:
        raise ValueError(f"仍有 {len(unresolved)} 项同步冲突未处理")

    resolved = payload.model_dump(mode="python")
    for conflict in conflicts:
        choice = choices[conflict.key]
        exists = conflict.local_exists if choice == "local" else conflict.remote_exists
        value = conflict.local if choice == "local" else conflict.remote
        if (
            conflict.path_segments == ["preferences", "tree_order"]
            and isinstance(value, dict)
            and isinstance(conflict.base, dict)
            and isinstance(conflict.local, dict)
            and isinstance(conflict.remote, dict)
        ):
            other_value = conflict.remote if choice == "local" else conflict.local
            value = _preserve_independently_added_tree_items(value, other_value, conflict.base)
        _set_path_value(resolved, conflict.path_segments, value, exists=exists)
    resolved["generated_at"] = datetime.now(timezone.utc)
    return DataDjinnSyncPayload.model_validate(resolved)


def merge_sync_payloads(
    base: DataDjinnSyncPayload,
    local: DataDjinnSyncPayload,
    remote: DataDjinnSyncPayload,
) -> SyncMergeResult:
    base = _normalize_sync_payload(base)
    local = _normalize_sync_payload(local)
    remote = _normalize_sync_payload(remote)
    conflicts: list[SyncConflict] = []
    merged_connections = _merge_value(
        base.connections,
        local.connections,
        remote.connections,
        ("connections",),
        conflicts,
    )
    merged_settings = _merge_value(
        base.settings,
        local.settings,
        remote.settings,
        ("settings",),
        conflicts,
    )
    merged_preferences = _merge_value(
        base.preferences,
        local.preferences,
        remote.preferences,
        ("preferences",),
        conflicts,
    )
    return SyncMergeResult(
        payload=DataDjinnSyncPayload(
            device_id=local.device_id,
            connections=merged_connections,
            settings=merged_settings,
            preferences=merged_preferences,
        ),
        conflicts=conflicts,
    )


def _merge_value(
    base: Any,
    local: Any,
    remote: Any,
    path_segments: tuple[str, ...],
    conflicts: list[SyncConflict],
) -> Any:
    if _values_equal(local, remote):
        return _copy_value(local)
    if _values_equal(local, base):
        return _copy_value(remote)
    if _values_equal(remote, base):
        return _copy_value(local)

    # 连接树排序是一个整体：顶级节点、分组顺序和分组内连接顺序必须一起选择，
    # 否则用户会看到多个看似不同但实际属于同一棵树的冲突项。
    if path_segments == ('preferences', 'tree_order'):
        conflicts.append(
            SyncConflict(
                key=json.dumps(path_segments, ensure_ascii=False, separators=(',', ':')),
                path='.'.join(path_segments),
                path_segments=list(path_segments),
                base_exists=base is not _MISSING,
                local_exists=local is not _MISSING,
                remote_exists=remote is not _MISSING,
                base=None if base is _MISSING else base,
                local=None if local is _MISSING else local,
                remote=None if remote is _MISSING else remote,
            )
        )
        return _copy_value(local)

    local_is_dict = isinstance(local, dict)
    remote_is_dict = isinstance(remote, dict)
    if local_is_dict and remote_is_dict and (isinstance(base, dict) or base is _MISSING):
        base_mapping = base if isinstance(base, dict) else {}
        result: dict[str, Any] = {}
        keys = set(base_mapping) | set(local) | set(remote)
        for key in sorted(keys):
            merged = _merge_value(
                base_mapping.get(key, _MISSING),
                local.get(key, _MISSING),
                remote.get(key, _MISSING),
                (*path_segments, key),
                conflicts,
            )
            if merged is not _MISSING:
                result[key] = merged
        return result

    conflicts.append(
        SyncConflict(
            key=json.dumps(path_segments, ensure_ascii=False, separators=(",", ":")),
            path=".".join(path_segments),
            path_segments=list(path_segments),
            base_exists=base is not _MISSING,
            local_exists=local is not _MISSING,
            remote_exists=remote is not _MISSING,
            base=None if base is _MISSING else base,
            local=None if local is _MISSING else local,
            remote=None if remote is _MISSING else remote,
        )
    )
    return _copy_value(local)


def _set_path_value(
    root: dict[str, Any], path_segments: list[str], value: Any, *, exists: bool
) -> None:
    if not path_segments:
        raise ValueError("同步冲突路径无效")
    current = root
    for segment in path_segments[:-1]:
        child = current.get(segment)
        if not isinstance(child, dict):
            child = {}
            current[segment] = child
        current = child
    key = path_segments[-1]
    if exists:
        current[key] = _copy_value(value)
    else:
        current.pop(key, None)


def _values_equal(left: Any, right: Any) -> bool:
    if left is _MISSING or right is _MISSING:
        return left is right
    return left == right


def _copy_value(value: Any) -> Any:
    if value is _MISSING:
        return _MISSING
    if isinstance(value, dict):
        return {key: _copy_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_value(item) for item in value]
    return value


_ORDER_PREFERENCE_KEYS = {
    'connection_folder_order',
    'root_connection_order',
    'root_item_order',
    'folder_connection_order',
}


def _normalize_sync_payload(payload: DataDjinnSyncPayload) -> DataDjinnSyncPayload:
    preferences = _normalize_sync_preferences(payload.preferences)
    if preferences == payload.preferences:
        return payload
    return payload.model_copy(update={'preferences': preferences})


def _normalize_sync_preferences(preferences: dict[str, Any]) -> dict[str, Any]:
    result = _copy_value(preferences)
    existing_tree_order = result.get('tree_order')
    if isinstance(existing_tree_order, dict):
        tree_order = _normalize_tree_order(existing_tree_order, result)
    else:
        tree_order = _build_tree_order_from_legacy_preferences(result)
    result['tree_order'] = tree_order
    for key in _ORDER_PREFERENCE_KEYS:
        result.pop(key, None)
    return result


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _ordered_ids(available: list[str], preferred: list[str]) -> list[str]:
    available_set = set(available)
    ordered = [item for item in preferred if item in available_set]
    ordered_set = set(ordered)
    return [*ordered, *[item for item in available if item not in ordered_set]]


def _tree_item_id(kind: str, item_id: str) -> str:
    prefix = f'{kind}:'
    return item_id if item_id.startswith(prefix) else f'{prefix}{item_id}'


def _tree_item_locations(tree_order: dict[str, Any]) -> dict[str, str | None]:
    locations = {item_id: None for item_id in _string_list(tree_order.get("roots"))}
    raw_children = tree_order.get("children")
    if not isinstance(raw_children, dict):
        return locations
    for parent_id, child_ids in raw_children.items():
        if not isinstance(parent_id, str):
            continue
        for child_id in _string_list(child_ids):
            locations[child_id] = parent_id
    return locations


def _preserve_independently_added_tree_items(
    selected_tree: dict[str, Any], other_tree: dict[str, Any], base_tree: dict[str, Any]
) -> dict[str, Any]:
    """保留另一端在同步基线之后新增的节点，排序仍以用户选择的一端为准。"""
    result = _copy_value(selected_tree)
    if not isinstance(result, dict):
        return selected_tree
    base_items = set(_tree_item_locations(base_tree))
    selected_items = set(_tree_item_locations(result))
    other_locations = _tree_item_locations(other_tree)
    raw_children = result.get("children")
    children = _copy_value(raw_children) if isinstance(raw_children, dict) else {}
    roots = _string_list(result.get("roots"))

    for item_id, parent_id in other_locations.items():
        if item_id in base_items or item_id in selected_items:
            continue
        if parent_id is None:
            roots.append(item_id)
        else:
            current_children = _string_list(children.get(parent_id))
            current_children.append(item_id)
            children[parent_id] = current_children
        selected_items.add(item_id)

    result["roots"] = roots
    result["children"] = children
    return result


def _folder_parent_map(preferences: dict[str, Any]) -> dict[str, str | None]:
    raw_folders = preferences.get('connection_folders')
    folders = raw_folders if isinstance(raw_folders, list) else []
    folder_ids = {
        item.get('id')
        for item in folders
        if isinstance(item, dict) and isinstance(item.get('id'), str)
    }
    parents: dict[str, str | None] = {}
    for item in folders:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str):
            continue
        folder_id = item['id']
        parent_id = item.get('parentId')
        parents[folder_id] = (
            parent_id
            if isinstance(parent_id, str) and parent_id != folder_id and parent_id in folder_ids
            else None
        )
    return parents


def _build_tree_order_from_legacy_preferences(preferences: dict[str, Any]) -> dict[str, Any]:
    old_tree = {
        'roots': _string_list(preferences.get('root_item_order')),
        'folder_order': _string_list(preferences.get('connection_folder_order')),
        'folder_connections': preferences.get('folder_connection_order')
        if isinstance(preferences.get('folder_connection_order'), dict)
        else {},
        'customized': preferences.get('root_item_order_customized') is True,
    }
    if not old_tree['roots']:
        old_tree['roots'] = [
            f'folder:{folder_id}' for folder_id in old_tree['folder_order']
        ] + [
            f'connection:{connection_id}'
            for connection_id in _string_list(preferences.get('root_connection_order'))
        ]
    return _normalize_tree_order(old_tree, preferences)


def _normalize_tree_order(tree_order: dict[str, Any], preferences: dict[str, Any]) -> dict[str, Any]:
    """将新旧排序快照统一为完整的连接树：roots + 每个分组的 children。"""
    roots = _string_list(tree_order.get('roots'))
    raw_children = tree_order.get('children')
    if isinstance(raw_children, dict):
        children = {
            str(parent_id): _string_list(child_ids)
            for parent_id, child_ids in raw_children.items()
            if isinstance(parent_id, str) and isinstance(child_ids, list)
        }
        result: dict[str, Any] = {'roots': roots, 'children': children}
        if tree_order.get('customized') is True:
            result['customized'] = True
        return result

    # 兼容早期 tree_order：folder_order 和 folder_connections 仍是平铺字段，
    # 这里按 connection_folders.parentId 还原为每个分组的直接子节点。
    parent_by_folder = _folder_parent_map(preferences)
    folder_ids = list(parent_by_folder)
    flat_folder_order = _string_list(tree_order.get('folder_order'))
    folder_children_by_parent: dict[str | None, list[str]] = {}
    for folder_id, parent_id in parent_by_folder.items():
        folder_children_by_parent.setdefault(parent_id, []).append(folder_id)
    folder_order_by_parent = {
        parent_id: _ordered_ids(child_ids, flat_folder_order)
        for parent_id, child_ids in folder_children_by_parent.items()
    }
    raw_folder_connections = tree_order.get('folder_connections')
    folder_connections = raw_folder_connections if isinstance(raw_folder_connections, dict) else {}
    children: dict[str, list[str]] = {}
    for folder_id in folder_ids:
        child_folders = [
            f'folder:{child_id}'
            for child_id in folder_order_by_parent.get(folder_id, [])
        ]
        connection_ids = _string_list(folder_connections.get(folder_id))
        children[folder_id] = [
            *child_folders,
            *[_tree_item_id('connection', connection_id) for connection_id in connection_ids],
        ]

    if not roots:
        roots = [
            f'folder:{folder_id}'
            for folder_id in folder_order_by_parent.get(None, [])
        ] + [
            f'connection:{connection_id}'
            for connection_id in _string_list(preferences.get('root_connection_order'))
        ]
    result = {'roots': roots, 'children': children}
    if tree_order.get('customized') is True:
        result['customized'] = True
    return result
