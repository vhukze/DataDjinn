from __future__ import annotations

import os
import sys
import unittest
from contextlib import contextmanager
from uuid import uuid4
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from app.db.jdbc_bridge import JDBC_RUNTIME_ENV, load_jdbc_bridge


@contextmanager
def bridge_test_directory():
    root = Path(__file__).resolve().parents[2] / ".tmp" / "jdbc-bridge-tests"
    root.mkdir(parents=True, exist_ok=True)
    # 保留隔离的测试目录，方便诊断，不修改用户安装的模块。
    directory = root / uuid4().hex
    directory.mkdir()
    yield str(directory)


class JdbcBridgeTests(unittest.TestCase):
    def test_jdbc_bridge_requires_the_optional_module(self) -> None:
        with patch.dict(os.environ, {JDBC_RUNTIME_ENV: ""}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "JDBC 桥接模块未安装"):
                load_jdbc_bridge()

    def test_jdbc_bridge_rejects_an_incomplete_optional_module(self) -> None:
        with patch.dict(os.environ, {JDBC_RUNTIME_ENV: "C:/missing-jdbc-runtime"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "模块文件不完整"):
                load_jdbc_bridge()

    def test_optional_module_layout_contains_all_runtime_markers(self) -> None:
        with (
            patch.dict(os.environ, {JDBC_RUNTIME_ENV: "C:/jdbc-runtime"}, clear=False),
            patch("app.db.jdbc_bridge._runtime_python_path", return_value=Path("C:/jdbc-runtime/python")),
            patch("pathlib.Path.exists", return_value=True),
            patch.object(sys, "path", sys.path.copy()),
            patch("builtins.__import__", side_effect=ImportError("test-only")),
        ):
            with self.assertRaisesRegex(RuntimeError, "模块无法加载"):
                load_jdbc_bridge()

    def test_ai_process_loads_installed_bridge_without_core_backend_environment_bug(self) -> None:
        with bridge_test_directory() as directory:
            runtime = Path(directory) / "modules" / "jdbc-runtime" / "current"
            python_path = runtime / "python"
            for marker in ("jpype/__init__.py", "jaydebeapi/__init__.py", "org.jpype.jar"):
                target = python_path / marker
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
            (runtime / "runtime.json").write_text('{"pythonPath": "python"}', encoding="utf-8")
            jpype = ModuleType("jpype")
            jaydebeapi = ModuleType("jaydebeapi")
            with (
                patch.dict(os.environ, {JDBC_RUNTIME_ENV: "", "DATADJINN_DATA_DIR": directory}),
                patch.object(sys, "path", sys.path.copy()),
                patch.dict(sys.modules, {"jpype": jpype, "jaydebeapi": jaydebeapi}),
            ):
                self.assertEqual(load_jdbc_bridge(), (jpype, jaydebeapi))
                self.assertEqual(sys.path[0], str(python_path.resolve()))

    def test_installed_bridge_missing_files_reports_incomplete_bug(self) -> None:
        with bridge_test_directory() as directory:
            runtime = Path(directory) / "modules" / "jdbc-runtime" / "current"
            runtime.mkdir(parents=True)
            (runtime / "runtime.json").write_text('{}', encoding="utf-8")
            with patch.dict(os.environ, {JDBC_RUNTIME_ENV: "", "DATADJINN_DATA_DIR": directory}):
                with self.assertRaisesRegex(RuntimeError, "模块文件不完整"):
                    load_jdbc_bridge()

    def test_without_installed_bridge_ai_still_reports_missing_module(self) -> None:
        with bridge_test_directory() as directory:
            with patch.dict(os.environ, {JDBC_RUNTIME_ENV: "", "DATADJINN_DATA_DIR": directory}):
                with self.assertRaisesRegex(RuntimeError, "JDBC 桥接模块未安装"):
                    load_jdbc_bridge()

    def test_explicit_runtime_path_takes_precedence_over_data_directory(self) -> None:
        with patch.dict(os.environ, {JDBC_RUNTIME_ENV: "C:/configured-jdbc", "DATADJINN_DATA_DIR": "C:/other"}):
            with self.assertRaisesRegex(RuntimeError, "模块文件不完整"):
                load_jdbc_bridge()


if __name__ == "__main__":
    unittest.main()
