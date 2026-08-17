from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
DIST_DIR = BACKEND_DIR / "dist" / "modules"
MODULE_VERSION = os.environ.get("DATADJINN_JRE_MODULE_VERSION", "17.0.20+8")
MODULE_NAME = "datadjinn-jre"
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
                archive.write(path, path.relative_to(source))


def _resolve_jre_home() -> Path:
    configured_home = os.environ.get("DATADJINN_JRE_HOME", "").strip()
    if not configured_home:
        raise RuntimeError("请设置 DATADJINN_JRE_HOME 为要打包的 JRE 目录")

    home = Path(configured_home).expanduser().resolve()
    if not (home / "bin" / "server" / "jvm.dll").exists():
        raise RuntimeError(f"JRE 目录无效，缺少 bin/server/jvm.dll：{home}")
    if not (home / "release").exists():
        raise RuntimeError(f"JRE 目录无效，缺少 release 文件：{home}")
    return home


def main() -> None:
    if sys.platform != "win32":
        raise RuntimeError("Java 运行时模块当前仅生成 Windows x64 包")

    jre_home = _resolve_jre_home()
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="datadjinn-jre-module-", dir=DIST_DIR) as temp_dir:
        staging_root = Path(temp_dir) / MODULE_ROOT.name
        shutil.copytree(jre_home, staging_root / "jre")
        package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
        (staging_root / "module.json").write_text(
            json.dumps(
                {
                    "id": "jre-17",
                    "version": MODULE_VERSION,
                    "platform": "win32",
                    "arch": "x64",
                    "minAppVersion": str(package["version"]),
                    "entryPoint": "jre/bin/server/jvm.dll",
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        if MODULE_ROOT.exists():
            shutil.rmtree(MODULE_ROOT)
        shutil.move(str(staging_root), str(MODULE_ROOT))

    if ARCHIVE_PATH.exists():
        ARCHIVE_PATH.unlink()
    _write_archive(MODULE_ROOT, ARCHIVE_PATH)
    print(json.dumps({"archive": str(ARCHIVE_PATH), "sha256": _sha256(ARCHIVE_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
