from datetime import date, datetime
from decimal import Decimal
from typing import Any

try:
    from bson import ObjectId
    from pymongo import MongoClient
except ImportError:  # pragma: no cover - optional dependency guard
    ObjectId = None  # type: ignore[assignment]
    MongoClient = None  # type: ignore[assignment]


def is_mongo_client(client: Any) -> bool:
    return MongoClient is not None and isinstance(client, MongoClient)


def mongo_default_database(client: Any, fallback: str | None = None) -> str | None:
    if not is_mongo_client(client):
        return fallback

    default_database = client.get_default_database(default=None)
    return default_database.name if default_database is not None else fallback


def serialize_mongo_value(value: Any) -> Any:
    if ObjectId is not None and isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, list):
        return [serialize_mongo_value(item) for item in value]

    if isinstance(value, dict):
        return {str(key): serialize_mongo_value(item) for key, item in value.items()}

    return value


def serialize_mongo_document(document: dict[str, Any]) -> dict[str, Any]:
    return {str(key): serialize_mongo_value(value) for key, value in document.items()}


def mongo_value_type(value: Any) -> str:
    if value is None:
        return "null"
    if ObjectId is not None and isinstance(value, ObjectId):
        return "ObjectId"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "double"
    if isinstance(value, str):
        return "string"
    if isinstance(value, datetime):
        return "date"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__
