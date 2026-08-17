from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
SOURCE_FILE = BACKEND_DIR / "app" / "git_versioning" / "data_history.py"
DIST_DIR = BACKEND_DIR / "dist" / "modules"
MODULE_NAME = "datadjinn-data-versioning"
MODULE_VERSION = os.environ.get("DATADJINN_DATA_VERSIONING_MODULE_VERSION", "1.0.0")
MODULE_ROOT = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64"
ARCHIVE_PATH = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64.zip"


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
                archive_path = path.relative_to(source).as_posix()
                metadata = zipfile.ZipInfo(archive_path, date_time=(2020, 1, 1, 0, 0, 0))
                metadata.compress_type = zipfile.ZIP_DEFLATED
                metadata.external_attr = 0o100644 << 16
                archive.writestr(metadata, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)


def main() -> None:
    if sys.platform != "win32":
        raise RuntimeError("表数据版本管理扩展当前仅生成 Windows x64 包")
    if not SOURCE_FILE.exists():
        raise RuntimeError(f"数据版本服务源码不存在：{SOURCE_FILE}")
    if MODULE_ROOT.exists():
        shutil.rmtree(MODULE_ROOT)
    if ARCHIVE_PATH.exists():
        ARCHIVE_PATH.unlink()

    MODULE_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_FILE, MODULE_ROOT / "data_history.py")
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
    (MODULE_ROOT / "module.json").write_text(
        json.dumps(
            {
                "id": "data-versioning",
                "version": MODULE_VERSION,
                "platform": "win32",
                "arch": "x64",
                "minAppVersion": str(package["version"]),
                "entryPoint": "data_history.py",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    _write_archive(MODULE_ROOT, ARCHIVE_PATH)
    print(json.dumps({"archive": str(ARCHIVE_PATH), "sha256": _sha256(ARCHIVE_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
