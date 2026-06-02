from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PyInstaller.__main__ import run

BACKEND_DIR = Path(__file__).resolve().parents[1]
VENDOR_JPYPE_DIR = BACKEND_DIR / "vendor" / "jpype15"
VENDOR_MANIFEST = BACKEND_DIR / "vendor" / "jpype15.json"
DIST_BACKEND_EXE = BACKEND_DIR / "dist" / "datadjinn-backend" / (
    "datadjinn-backend.exe" if sys.platform == "win32" else "datadjinn-backend"
)


def _is_complete_vendor_jpype_dir(vendor_dir: Path) -> bool:
    return (
        (vendor_dir / "jpype" / "__init__.py").exists()
        and (vendor_dir / "org.jpype.jar").exists()
        and (any(vendor_dir.glob("_jpype*.pyd")) or any(vendor_dir.glob("_jpype*.so")))
    )


def _resolve_vendor_jpype_dir() -> Path:
    if VENDOR_MANIFEST.exists():
        manifest = json.loads(VENDOR_MANIFEST.read_text(encoding="utf-8"))
        manifest_vendor_dir = Path(manifest.get("vendor_dir", ""))
        if _is_complete_vendor_jpype_dir(manifest_vendor_dir):
            return manifest_vendor_dir

    return VENDOR_JPYPE_DIR


def main() -> None:
    vendor_jpype_dir = _resolve_vendor_jpype_dir()
    if not _is_complete_vendor_jpype_dir(vendor_jpype_dir):
        raise RuntimeError(f"JPype vendor 不完整：{vendor_jpype_dir}，请先运行 prepare_jpype_vendor.py")

    os.chdir(BACKEND_DIR)
    sys.path.insert(0, str(vendor_jpype_dir))
    os.environ["PYTHONPATH"] = f"{vendor_jpype_dir}{os.pathsep}{os.environ.get('PYTHONPATH', '')}"

    run([
        "run.py",
        "--name",
        "datadjinn-backend",
        "--onedir",
        "--clean",
        "--noconfirm",
        "--paths",
        str(vendor_jpype_dir),
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
        f"{vendor_jpype_dir / 'org.jpype.jar'};.",
        "--exclude-module",
        "dmPython",
        "--exclude-module",
        "dmSQLAlchemy",
        "--exclude-module",
        "dmssl",
    ])

    if not DIST_BACKEND_EXE.exists():
        raise RuntimeError(f"后端打包产物不存在：{DIST_BACKEND_EXE}")

    bundled_jar = DIST_BACKEND_EXE.parent / "_internal" / "org.jpype.jar"
    if not bundled_jar.exists():
        raise RuntimeError(f"后端打包缺少 JPype 支持库：{bundled_jar}")


if __name__ == "__main__":
    main()
