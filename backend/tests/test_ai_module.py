import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app as core_app
from app.ai.product_knowledge import get_product_knowledge
from run_ai_module import app as ai_module_app
class AiModuleEntrypointTests(unittest.TestCase):
    def test_product_knowledge_keeps_interface_theme_on_the_current_device(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("界面主题属于设备配置，不会同步", knowledge)

    def test_product_knowledge_describes_connection_loading_indicator_location(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("只在连接名称右侧显示加载状态，左侧不重复显示加载动画", knowledge)

    def test_product_knowledge_describes_elasticsearch_read_only_workflow(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("Elasticsearch", knowledge)
        self.assertIn("JSON Query DSL", knowledge)
        self.assertIn("Git 表数据版本管理", knowledge)

    def test_product_knowledge_describes_snapshot_restore_and_postgresql_backup_scope(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("本机快照目前不加密", knowledge)
        self.assertIn("结构重建会迁移旧表中目标结构仍兼容的列数据", knowledge)
        self.assertIn("不指定 schema 时会覆盖该物理数据库下的用户 schema", knowledge)

    def test_product_knowledge_describes_encrypted_ai_storage_and_confirmation_expiry(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("AI API Key、配置和会话在本机通过系统加密存储", knowledge)
        self.assertIn("确认请求 30 分钟后过期且只能执行一次", knowledge)

    def test_product_knowledge_documents_csv_null_round_trip(self) -> None:
        knowledge = get_product_knowledge()

        self.assertIn("CSV 使用 `\\N` 表示 NULL", knowledge)
        self.assertIn("空字符串保持为空", knowledge)

    def test_core_api_does_not_expose_ai_routes(self) -> None:
        paths = {route.path for route in core_app.routes}

        self.assertNotIn("/api/ai/ping", paths)

    def test_ai_module_keeps_health_public_and_protects_ai_routes(self) -> None:
        with patch.dict(os.environ, {"DATADJINN_API_TOKEN": "module-token"}, clear=False):
            client = TestClient(ai_module_app)

            health = client.get("/api/health")
            unauthorized = client.post("/api/ai/ping", json={})

        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json(), {"ok": True})
        self.assertEqual(unauthorized.status_code, 401)
