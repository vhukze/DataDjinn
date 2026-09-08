from __future__ import annotations

import json
import re
from typing import Any


def disable_elasticsearch_compatibility_headers() -> None:
    """Use ordinary JSON headers so Elasticsearch 7.x accepts requests from client 8.x."""
    try:
        from elasticsearch._sync.client import _base

        if getattr(_base, "_datadjinn_compatibility_disabled", False):
            return
        # 保留一个不可匹配的捕获组，兼容客户端内部 replacement 使用的 \g<1>。
        _base._COMPAT_MIMETYPE_RE = re.compile(r"(?!)()")
        _base._datadjinn_compatibility_disabled = True
    except (ImportError, AttributeError):
        # Keep the default behavior if a future client removes this private implementation detail.
        return


class ElasticsearchClient:
    """Adapter for Elasticsearch-compatible servers, including pre-8 clusters."""

    _datadjinn_elasticsearch_client = True

    def __init__(self, client: Any) -> None:
        self._client = client
        # elasticsearch-py 8 rejects ES 7.x/OpenSearch nodes which don't send
        # x-elastic-product. We verify the root response ourselves before
        # allowing requests to continue through the generated client methods.
        setattr(self._client, "_verified_elasticsearch", True)

    def close(self) -> None:
        self._client.close()

    def info(self) -> Any:
        response = self._client.info()
        body = response_body(response)
        version = body.get("version") if isinstance(body, dict) else None
        version_number = version.get("number") if isinstance(version, dict) else None
        if not isinstance(version_number, str) or not re.match(r"^\d+(?:\.\d+){1,3}(?:[-+].*)?$", version_number):
            raise RuntimeError(
                "目标服务不是受支持的 Elasticsearch 兼容服务：根接口未返回有效 version.number"
            )
        distribution = version.get("distribution") if isinstance(version, dict) else None
        tagline = body.get("tagline") if isinstance(body, dict) else None
        if distribution != "opensearch" and tagline != "You Know, for Search":
            raise RuntimeError(
                "目标服务不是受支持的 Elasticsearch 兼容服务：未识别为 Elasticsearch 或 OpenSearch"
            )
        return response

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


def is_elasticsearch_client(client: Any) -> bool:
    return bool(getattr(client, "_datadjinn_elasticsearch_client", False))


def response_body(response: Any) -> Any:
    return response.body if hasattr(response, "body") else response


def json_document(value: Any, field_name: str) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} 必须是有效 JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{field_name} 必须是 JSON 对象")
    return parsed


def flatten_mapping_properties(properties: dict[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = []
    for name, definition in properties.items():
        full_name = f"{prefix}.{name}" if prefix else str(name)
        if not isinstance(definition, dict):
            fields.append((full_name, "object"))
            continue
        field_type = str(definition.get("type") or ("nested" if definition.get("properties") else "object"))
        fields.append((full_name, field_type))
        nested_properties = definition.get("properties")
        if isinstance(nested_properties, dict):
            fields.extend(flatten_mapping_properties(nested_properties, full_name))
    return fields
