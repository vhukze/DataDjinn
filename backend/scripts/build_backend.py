from __future__ import annotations

import os
import sys
from pathlib import Path

from PyInstaller.__main__ import run

BACKEND_DIR = Path(__file__).resolve().parents[1]
VENDOR_JPYPE_DIR = BACKEND_DIR / "vendor" / "jpype15"


def main() -> None:
    if not VENDOR_JPYPE_DIR.exists():
        raise RuntimeError(f"JPype vendor 目录不存在：{VENDOR_JPYPE_DIR}，请先运行 prepare_jpype_vendor.py")

    os.chdir(BACKEND_DIR)
    sys.path.insert(0, str(VENDOR_JPYPE_DIR))
    os.environ["PYTHONPATH"] = f"{VENDOR_JPYPE_DIR}{os.pathsep}{os.environ.get('PYTHONPATH', '')}"

    run([
        "run.py",
        "--name",
        "datadjinn-backend",
        "--onedir",
        "--clean",
        "--noconfirm",
        "--paths",
        str(VENDOR_JPYPE_DIR),
        "--hidden-import",
        "pymongo",
        "--hidden-import",
        "bson",
        "--hidden-import",
        "dns",
        "--hidden-import",
        "redis",
        "--hidden-import",
        "jaydebeapi",
        "--hidden-import",
        "jpype",
        "--collect-data",
        "jpype",
        "--collect-submodules",
        "jpype",
        "--add-data",
        f"{VENDOR_JPYPE_DIR / 'org.jpype.jar'};.",
        "--exclude-module",
        "dmPython",
        "--exclude-module",
        "dmSQLAlchemy",
        "--exclude-module",
        "dmssl",
    ])


if __name__ == "__main__":
    main()
