from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

from PyInstaller.__main__ import run

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
VENDOR_JPYPE_DIR = BACKEND_DIR / "vendor" / "jpype15"
DIST_DIR = BACKEND_DIR / "dist" / "modules"
BUILD_DIR = BACKEND_DIR / "build" / "mcp-module"
MODULE_VERSION = os.environ.get("DATADJINN_MCP_MODULE_VERSION", "1.0.0")
MODULE_NAME = "datadjinn-mcp"
MODULE_ROOT = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64"
ARCHIVE_PATH = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64.zip"
PYINSTALLER_DATA_SEPARATOR = ";" if sys.platform == "win32" else ":"


def _is_complete_vendor_jpype_dir(vendor_dir: Path) -> bool:
    return (
        (vendor_dir / "jpype" / "__init__.py").exists()
        and (vendor_dir / "org.jpype.jar").exists()
        and any(vendor_dir.glob("_jpype*.pyd"))
    )


def _app_version() -> str:
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    return str(package["version"])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_archive(source: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source))


def main() -> None:
    if sys.platform != "win32":
        raise RuntimeError("MCP 模块当前仅生成 Windows x64 包")
    if not _is_complete_vendor_jpype_dir(VENDOR_JPYPE_DIR):
        raise RuntimeError(f"JPype vendor 不完整：{VENDOR_JPYPE_DIR}")

    if MODULE_ROOT.exists():
        shutil.rmtree(MODULE_ROOT)
    if ARCHIVE_PATH.exists():
        ARCHIVE_PATH.unlink()

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    os.chdir(BACKEND_DIR)
    sys.path.insert(0, str(VENDOR_JPYPE_DIR))
    os.environ["PYTHONPATH"] = f"{VENDOR_JPYPE_DIR}{os.pathsep}{os.environ.get('PYTHONPATH', '')}"

    run([
        "app/mcp_server.py",
        "--name",
        MODULE_NAME,
        "--onedir",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(BUILD_DIR),
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
        "clickhouse_connect",
        "--collect-submodules",
        "clickhouse_connect",
        "--hidden-import",
        "oracledb",
        "--collect-submodules",
        "oracledb",
        "--hidden-import",
        "jaydebeapi",
        "--hidden-import",
        "jpype",
        "--collect-data",
        "jpype",
        "--collect-submodules",
        "jpype",
        "--add-data",
        f"{VENDOR_JPYPE_DIR / 'org.jpype.jar'}{PYINSTALLER_DATA_SEPARATOR}.",
        "--exclude-module",
        "dmPython",
        "--exclude-module",
        "dmSQLAlchemy",
        "--exclude-module",
        "dmssl",
    ])

    generated_root = DIST_DIR / MODULE_NAME
    if not generated_root.exists():
        raise RuntimeError(f"MCP 模块构建产物不存在：{generated_root}")
    generated_root.rename(MODULE_ROOT)
    executable = MODULE_ROOT / f"{MODULE_NAME}.exe"
    if not executable.exists():
        raise RuntimeError(f"MCP 模块缺少启动程序：{executable}")

    manifest = {
        "id": "mcp",
        "version": MODULE_VERSION,
        "platform": "win32",
        "arch": "x64",
        "minAppVersion": _app_version(),
        "entryPoint": executable.name,
    }
    (MODULE_ROOT / "module.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _write_archive(MODULE_ROOT, ARCHIVE_PATH)
    print(json.dumps({"archive": str(ARCHIVE_PATH), "sha256": _sha256(ARCHIVE_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
