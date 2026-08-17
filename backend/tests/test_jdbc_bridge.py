from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from app.db.jdbc_bridge import JDBC_RUNTIME_ENV, load_jdbc_bridge


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


if __name__ == "__main__":
    unittest.main()
