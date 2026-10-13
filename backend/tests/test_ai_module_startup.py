"""Bug regression: saved ES connections must not crash source or frozen AI startup."""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class AiModuleStartupTests(unittest.TestCase):
    def _verify_startup(self, command: list[str], with_jdbc: bool = False) -> None:
        requests: list[dict] = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                pass

            def respond(self, body: dict) -> None:
                payload = json.dumps(body).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self) -> None:
                self.respond({"version": {"number": "7.10.2"}, "tagline": "You Know, for Search"})

            def do_POST(self) -> None:
                requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self.respond({"id": "startup-regression", "object": "chat.completion", "created": 1,
                              "model": "test", "choices": [{"index": 0, "finish_reason": "stop",
                              "message": {"role": "assistant", "content": "AI 已启动"}}]})

        fixture = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=fixture.serve_forever, daemon=True)
        thread.start()
        test_root = PROJECT_ROOT / ".tmp" / "ai-startup"
        test_root.mkdir(parents=True, exist_ok=True)
        data_dir = test_root / f"run-{time.time_ns()}"
        data_dir.mkdir()
        store = data_dir / "connections.json"
        store.write_text(json.dumps({"connections": [
            {"connection_id": "es", "name": "ES 测试", "database_type": "elasticsearch",
             "host": "127.0.0.1", "port": fixture.server_port, "es_auth_type": "none"},
            {"connection_id": "sqlite", "name": "SQLite", "database_type": "sqlite",
             "sqlite_path": str(data_dir / "test.db")},
            {"connection_id": "future", "name": "未来类型", "database_type": "future-db"},
        ]}, ensure_ascii=False), encoding="utf-8")
        original_store = store.read_bytes()
        if with_jdbc:
            runtime = PROJECT_ROOT / "backend/dist/modules/datadjinn-jdbc-runtime-1.0.0-win-x64"
            installed_runtime = data_dir / "modules/jdbc-runtime/current"
            shutil.copytree(runtime, installed_runtime)
            classes = data_dir / "jdbc-classes"
            classes.mkdir()
            source = PROJECT_ROOT / "backend/tests/fixtures/jdbc/dm/jdbc/driver/DmDriver.java"
            subprocess.run([shutil.which("javac"), "--release", "17", "-encoding", "UTF-8",
                            "-d", str(classes), str(source)], check=True, capture_output=True)
            jar = data_dir / "jdbc-fixture.jar"
            with zipfile.ZipFile(jar, "w") as archive:
                for file in classes.rglob("*.class"):
                    archive.write(file, file.relative_to(classes).as_posix())
            (data_dir / "drivers.json").write_text(json.dumps({"drivers": [
                {"id": "fixture", "name": "JDBC fixture", "database_type": "dm",
                 "driver_type": "jdbc", "path": str(jar), "enabled": True},
            ]}), encoding="utf-8")
            java_home = PROJECT_ROOT / "backend/dist/modules/datadjinn-jre-17.0.20+8-win-x64/jre"
            (data_dir / "jdbc_runtime.json").write_text(json.dumps({"enabled": True,
                "java_home": str(java_home)}), encoding="utf-8")
            connections = json.loads(store.read_text(encoding="utf-8"))
            connections["connections"].append({"connection_id": "dm", "name": "DM fixture",
                "database_type": "dm", "host": "127.0.0.1", "port": fixture.server_port,
                "username": "test", "driver_id": "fixture", "database": "APP"})
            store.write_text(json.dumps(connections, ensure_ascii=False), encoding="utf-8")
            original_store = store.read_bytes()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        env = {**os.environ, "DATADJINN_DATA_DIR": str(data_dir),
               "DATADJINN_AI_MODULE_PORT": str(port), "DATADJINN_API_TOKEN": "startup-token",
               "PYTHONIOENCODING": "utf-8"}
        # 模拟已发布主程序：AI 进程只有数据目录，没有普通后端的桥接环境变量。
        env.pop("DATADJINN_JDBC_RUNTIME_PATH", None)
        api = f"http://127.0.0.1:{port}/api"
        log_path = data_dir / "ai.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen(command, cwd=PROJECT_ROOT / "backend", env=env,
                                       stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            try:
                deadline = time.monotonic() + 90
                while True:
                    self.assertIsNone(process.poll(), log_path.read_text(encoding="utf-8", errors="replace"))
                    try:
                        with urlopen(f"{api}/health", timeout=1) as response:
                            self.assertEqual(json.load(response), {"ok": True})
                        break
                    except (URLError, TimeoutError):
                        self.assertLess(time.monotonic(), deadline, "AI 扩展启动超时")
                        time.sleep(0.2)

                # Opening ES through the real AI API also verifies frozen driver imports.
                for connection_id in ((None, "es", "sqlite", "dm") if with_jdbc else (None, "es", "sqlite")):
                    body = {"connection_id": connection_id, "messages": [{"role": "user", "content": "你好"}],
                            "config": {"base_url": f"http://127.0.0.1:{fixture.server_port}/v1",
                                       "api_key": "fixture", "model": "test"}}
                    request = Request(f"{api}/ai/chat", json.dumps(body).encode("utf-8"),
                                      {"Content-Type": "application/json", "X-DataDjinn-Api-Token": "startup-token"})
                    try:
                        with urlopen(request, timeout=20) as response:
                            self.assertEqual(json.load(response)["choices"][0]["message"]["content"], "AI 已启动")
                    except HTTPError as error:
                        self.fail(f"{connection_id}: {error.read().decode('utf-8')}")
                self.assertIn("elasticsearch", requests[1]["messages"][0]["content"])
                self.assertIn("sqlite", requests[2]["messages"][0]["content"])
                if with_jdbc:
                    self.assertIn("dm", requests[3]["messages"][0]["content"])
                self.assertEqual(store.read_bytes(), original_store, "启动不得改写或丢弃保存的连接")
            finally:
                process.terminate()
                process.wait(timeout=15)
                fixture.shutdown()
                fixture.server_close()
                thread.join(timeout=5)

    def test_source_startup_with_saved_es_and_other_connections_bug(self) -> None:
        self._verify_startup([sys.executable, str(PROJECT_ROOT / "backend" / "run_ai_module.py")])

    @unittest.skipUnless(os.environ.get("DATADJINN_TEST_AI_EXECUTABLE"), "需要实际扩展构建产物")
    def test_packaged_startup_with_saved_es_and_other_connections_bug(self) -> None:
        self._verify_startup([os.environ["DATADJINN_TEST_AI_EXECUTABLE"]])

    @unittest.skipUnless(shutil.which("javac"), "需要 JDK 编译隔离 JDBC 测试驱动")
    def test_source_chat_reuses_installed_jdbc_without_runtime_environment_bug(self) -> None:
        self._verify_startup([sys.executable, str(PROJECT_ROOT / "backend/run_ai_module.py")], with_jdbc=True)

    @unittest.skipUnless(os.environ.get("DATADJINN_TEST_AI_EXECUTABLE") and shutil.which("javac"), "需要扩展构建产物与 JDK")
    def test_packaged_chat_reuses_installed_jdbc_without_runtime_environment_bug(self) -> None:
        self._verify_startup([os.environ["DATADJINN_TEST_AI_EXECUTABLE"]], with_jdbc=True)
