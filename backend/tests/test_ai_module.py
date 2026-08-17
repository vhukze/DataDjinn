import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app as core_app
from run_ai_module import app as ai_module_app
class AiModuleEntrypointTests(unittest.TestCase):
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
