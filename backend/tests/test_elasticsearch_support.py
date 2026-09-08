from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.db import connection_manager as connection_manager_module
from app.db.metadata import apply_table_data_changes, get_object_ddl, list_columns, list_tables
from app.schemas.metadata import TableDataChangeRequest
from app.db.readonly_query import execute_query, preview_table
from app.schemas.connection import ConnectionRequest


class FakeResponse:
    def __init__(self, body: object) -> None:
        self.body = body


class FakeIndices:
    def get(self, **_kwargs):
        return FakeResponse({"orders": {"mappings": {"properties": {"customer": {"type": "keyword"}}}}})

    def stats(self, **_kwargs):
        return FakeResponse(
            {
                "indices": {
                    "orders": {
                        "primaries": {
                            "docs": {"count": 2},
                            "store": {"size_in_bytes": 128},
                        }
                    }
                }
            }
        )

    def get_mapping(self, **_kwargs):
        return FakeResponse(
            {
                "orders": {
                    "mappings": {
                        "properties": {
                            "customer": {"type": "keyword"},
                            "details": {"properties": {"amount": {"type": "double"}}},
                        }
                    }
                }
            }
        )


class FakeElasticsearch:
    _datadjinn_elasticsearch_client = True

    def __init__(self) -> None:
        self.indices = FakeIndices()
        self.search_calls: list[dict[str, object]] = []

    def search(self, **kwargs):
        self.search_calls.append(kwargs)
        return FakeResponse(
            {
                "hits": {
                    "total": {"value": 2, "relation": "eq"},
                    "hits": [
                        {"_id": "one", "_index": "orders", "_score": 1.0, "_source": {"customer": "Ada", "amount": 12}},
                        {"_id": "two", "_index": "orders", "_score": 1.0, "_source": {"customer": "Grace", "amount": 18}},
                    ],
                }
            }
        )

    def info(self):
        return FakeResponse(
            {
                "version": {"number": "7.10.2"},
                "tagline": "You Know, for Search",
            }
        )


class ElasticsearchMetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = FakeElasticsearch()

    def test_indices_are_exposed_as_tables_with_stats_and_mapping_fields(self) -> None:
        tables = list_tables(self.client)
        self.assertEqual([(table.name, table.row_count, table.size_bytes) for table in tables], [("orders", 2, 128)])

        columns = list_columns(self.client, "orders")
        self.assertEqual([column.name for column in columns], ["_id", "customer", "details", "details.amount"])
        self.assertTrue(columns[0].primary_key)

        mapping = get_object_ddl(self.client, "orders", "table")
        self.assertIn('"customer"', mapping)

    def test_preview_and_json_dsl_query_send_safe_search_requests(self) -> None:
        preview = preview_table(
            self.client,
            "orders",
            limit=100,
            where='{"term": {"customer": "Ada"}}',
            sort_column="amount",
            sort_direction="descend",
        )
        self.assertEqual(preview.total_count, 2)
        self.assertEqual(preview.rows[0]["_id"], "one")
        self.assertEqual(self.client.search_calls[-1]["query"], {"term": {"customer": "Ada"}})
        self.assertEqual(self.client.search_calls[-1]["sort"], [{"amount": {"order": "desc"}}])

        queried = execute_query(
            self.client,
            '{"index": "orders", "query": {"match": {"customer": "Ada"}}}',
            limit=50,
        )
        self.assertEqual(queried.row_count, 2)
        self.assertEqual(self.client.search_calls[-1]["index"], "orders")
        self.assertEqual(self.client.search_calls[-1]["query"], {"match": {"customer": "Ada"}})

    def test_document_edits_are_explicitly_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "不支持表格行内编辑"):
            apply_table_data_changes(self.client, "orders", TableDataChangeRequest())


class ElasticsearchConnectionPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.connection_store_path = Path(self.temp_dir.name) / "connections.json"
        self.connection_store_patch = patch.object(
            connection_manager_module, "CONNECTION_STORE_PATH", self.connection_store_path
        )
        self.connection_store_patch.start()
        self.manager = connection_manager_module.ConnectionManager()

    def tearDown(self) -> None:
        self.connection_store_patch.stop()
        self.temp_dir.cleanup()

    def test_api_key_is_encrypted_and_restored(self) -> None:
        created = self.manager.create_connection(
            ConnectionRequest(
                name="Elasticsearch",
                database_type="elasticsearch",
                host="es.internal",
                port=9243,
                es_auth_type="api_key",
                es_api_key="encoded-api-key",
                es_use_ssl=True,
            )
        )

        stored = self.manager._stored_connections[created.connection_id]
        self.assertNotEqual(stored.encrypted_es_api_key, "encoded-api-key")
        restored = self.manager.get_connection_request(created.connection_id)
        self.assertEqual(restored.es_auth_type, "api_key")
        self.assertEqual(restored.es_api_key, "encoded-api-key")
        self.assertTrue(restored.es_use_ssl)

    def test_anonymous_authentication_survives_manager_restart(self) -> None:
        created = self.manager.create_connection(
            ConnectionRequest(
                name="Anonymous Elasticsearch",
                database_type="elasticsearch",
                host="es.internal",
                port=9200,
                es_auth_type="none",
            )
        )

        restarted_manager = connection_manager_module.ConnectionManager()
        restored = restarted_manager.get_connection_request(created.connection_id)
        info = restarted_manager.list_connections()[0]
        self.assertEqual(restored.es_auth_type, "none")
        self.assertEqual(info.es_auth_type, "none")
        self.assertFalse(info.has_password)

    def test_client_uses_requested_https_and_api_key_configuration(self) -> None:
        request = ConnectionRequest(
            name="Elasticsearch",
            database_type="elasticsearch",
            host="es.internal",
            port=9243,
            es_auth_type="api_key",
            es_api_key="encoded-api-key",
            es_use_ssl=True,
            es_verify_certs=True,
        )
        with patch("elasticsearch.Elasticsearch") as client_factory:
            client = self.manager._create_elasticsearch_client(request)

        client_factory.assert_called_once_with(
            hosts=[{"host": "es.internal", "port": 9243, "scheme": "https"}],
            request_timeout=5,
            verify_certs=True,
            api_key="encoded-api-key",
        )
        self.assertTrue(client._datadjinn_elasticsearch_client)

    def test_client_does_not_send_es8_compatibility_header_to_es7(self) -> None:
        from elasticsearch import Elasticsearch
        from elasticsearch._sync.client import _base
        self.manager._create_elasticsearch_client(
            ConnectionRequest(
                name="Elasticsearch",
                database_type="elasticsearch",
                host="es.internal",
                port=9200,
                es_auth_type="none",
            )
        )

        self.assertTrue(getattr(_base, "_datadjinn_compatibility_disabled", False))
        self.assertEqual(
            _base._COMPAT_MIMETYPE_RE.sub(
                "application/vnd.elasticsearch+json; compatible-with=8", "application/json"
            ),
            "application/json",
        )

        client = Elasticsearch("http://es.internal:9200")
        client.transport.perform_request = Mock(side_effect=RuntimeError("captured"))
        with self.assertRaisesRegex(RuntimeError, "captured"):
            client.info()
        headers = client.transport.perform_request.call_args.kwargs["headers"]
        self.assertNotIn("compatible-with=8", str(headers))

    def test_client_allows_anonymous_authentication_without_username(self) -> None:
        request = ConnectionRequest(
            name="Elasticsearch",
            database_type="elasticsearch",
            host="es.internal",
            port=9200,
            es_auth_type="none",
        )
        with patch("elasticsearch.Elasticsearch") as client_factory:
            client = self.manager._create_elasticsearch_client(request)

        client_factory.assert_called_once_with(
            hosts=[{"host": "es.internal", "port": 9200, "scheme": "http"}],
            request_timeout=5,
            verify_certs=True,
        )
        self.assertTrue(client._datadjinn_elasticsearch_client)

    def test_legacy_connection_manager_skips_unknown_database_type_without_blocking_other_connections(self) -> None:
        valid_connection = {
            "connection_id": "mysql-1",
            "name": "MySQL",
            "database_type": "mysql",
            "host": "localhost",
            "port": 3306,
            "database": "app",
        }
        unsupported_connection = {
            "connection_id": "es-1",
            "name": "Elasticsearch",
            "database_type": "elasticsearch",
            "host": "localhost",
            "port": 9200,
        }
        self.connection_store_path.write_text(
            json.dumps({"connections": [unsupported_connection, valid_connection]}),
            encoding="utf-8",
        )

        original_validate = connection_manager_module.StoredConnection.model_validate

        def legacy_validate(payload, *args, **kwargs):
            if isinstance(payload, dict) and payload.get("database_type") == "elasticsearch":
                raise ValueError("Input should be 'mysql'")
            return original_validate(payload, *args, **kwargs)

        with patch.object(connection_manager_module.StoredConnection, "model_validate", side_effect=legacy_validate):
            manager = connection_manager_module.ConnectionManager()

        connections = manager.list_connections()
        self.assertEqual([item.connection_id for item in connections], ["mysql-1"])

    def test_legacy_elasticsearch_without_product_header_is_accepted(self) -> None:
        client = connection_manager_module.ElasticsearchClient(FakeElasticsearch())
        info = client.info()
        self.assertEqual(info.body["version"]["number"], "7.10.2")

    def test_opensearch_distribution_is_accepted(self) -> None:
        class OpenSearch:
            _verified_elasticsearch = False

            def info(self):
                return FakeResponse({"version": {"number": "2.15.0", "distribution": "opensearch"}})

        client = connection_manager_module.ElasticsearchClient(OpenSearch())
        self.assertEqual(client.info().body["version"]["distribution"], "opensearch")

    def test_unknown_http_service_is_rejected_after_root_probe(self) -> None:
        class UnknownService:
            _verified_elasticsearch = False

            def info(self):
                return FakeResponse({"status": "ok"})

        client = connection_manager_module.ElasticsearchClient(UnknownService())
        with self.assertRaisesRegex(RuntimeError, "不是受支持的 Elasticsearch"):
            client.info()
