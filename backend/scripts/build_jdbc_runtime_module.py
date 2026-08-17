from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
VENDOR_JPYPE_DIR = BACKEND_DIR / "vendor" / "jpype15"
DIST_DIR = BACKEND_DIR / "dist" / "modules"
MODULE_VERSION = "1.0.0"
MODULE_NAME = "datadjinn-jdbc-runtime"
MODULE_ROOT = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64"
ARCHIVE_PATH = DIST_DIR / f"{MODULE_NAME}-{MODULE_VERSION}-win-x64.zip"


def _validate_jpype_vendor(vendor_dir: Path) -> None:
    required_paths = [
        vendor_dir / "jpype" / "__init__.py",
        vendor_dir / "org.jpype.jar",
    ]
    if not all(path.exists() for path in required_paths) or not any(vendor_dir.glob("_jpype*.pyd")):
        raise RuntimeError(f"JPype vendor 不完整：{vendor_dir}，请先运行 prepare_jpype_vendor.py")


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


def _copy_tree_contents(source: Path, target: Path) -> None:
    for path in source.rglob("*"):
        destination = target / path.relative_to(source)
        if path.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)


def _install_jaydebeapi(target: Path) -> None:
    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--only-binary=:all:",
        "--target",
        str(target),
        "--no-deps",
        "--upgrade",
        "--no-cache-dir",
        "jaydebeapi==1.2.3",
    ])
    for metadata in target.glob("*.dist-info"):
        shutil.rmtree(metadata)


def main() -> None:
    if sys.platform != "win32":
        raise RuntimeError("JDBC 桥接模块当前仅生成 Windows x64 包")
    _validate_jpype_vendor(VENDOR_JPYPE_DIR)

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="datadjinn-jdbc-module-", dir=DIST_DIR) as temp_dir:
        staging_root = Path(temp_dir) / MODULE_ROOT.name
        python_root = staging_root / "python"
        python_root.mkdir(parents=True)
        _copy_tree_contents(VENDOR_JPYPE_DIR, python_root)
        _install_jaydebeapi(python_root)

        if not (python_root / "jaydebeapi" / "__init__.py").exists():
            raise RuntimeError("JDBC 模块构建缺少 jaydebeapi")

        package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))
        (staging_root / "runtime.json").write_text(
            json.dumps({"pythonPath": "python"}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (staging_root / "module.json").write_text(
            json.dumps(
                {
                    "id": "jdbc-runtime",
                    "version": MODULE_VERSION,
                    "platform": "win32",
                    "arch": "x64",
                    "minAppVersion": str(package["version"]),
                    "entryPoint": "runtime.json",
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
