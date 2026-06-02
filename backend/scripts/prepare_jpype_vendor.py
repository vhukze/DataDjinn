from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

JPYPE_VERSION = "1.5.2"
BACKEND_DIR = Path(__file__).resolve().parents[1]
VENDOR_PARENT_DIR = BACKEND_DIR / "vendor"
VENDOR_DIR = VENDOR_PARENT_DIR / "jpype15"
VENDOR_MANIFEST = VENDOR_PARENT_DIR / "jpype15.json"


def _validate_vendor(vendor_dir: Path) -> None:
    missing: list[str] = []
    if not (vendor_dir / "jpype" / "__init__.py").exists():
        missing.append("jpype package")
    if not any(vendor_dir.glob("_jpype*.pyd")) and not any(vendor_dir.glob("_jpype*.so")):
        missing.append("_jpype native extension")
    if not (vendor_dir / "org.jpype.jar").exists():
        missing.append("org.jpype.jar")

    if missing:
        missing_text = ", ".join(missing)
        raise RuntimeError(f"JPype vendor 不完整：{vendor_dir} 缺少 {missing_text}")


def _write_manifest(vendor_dir: Path) -> None:
    VENDOR_PARENT_DIR.mkdir(parents=True, exist_ok=True)
    VENDOR_MANIFEST.write_text(
        json.dumps(
            {
                "jpype_version": JPYPE_VERSION,
                "vendor_dir": str(vendor_dir.resolve()),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _install_vendor(target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--only-binary=:all:",
        "--target",
        str(target_dir),
        "--upgrade",
        "--no-cache-dir",
        f"JPype1=={JPYPE_VERSION}",
    ])

    for path in [*target_dir.glob("packaging"), *target_dir.glob("packaging-*.dist-info")]:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)

    _validate_vendor(target_dir)


def _merge_vendor_contents(source_dir: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)

    for source_path in source_dir.rglob("*"):
        relative_path = source_path.relative_to(source_dir)
        target_path = target_dir / relative_path

        if source_path.is_dir():
            target_path.mkdir(parents=True, exist_ok=True)
            continue

        target_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source_path, target_path)
        except OSError:
            if not target_path.exists():
                raise


def _promote_vendor(staging_dir: Path) -> Path:
    if not VENDOR_DIR.exists():
        shutil.move(str(staging_dir), str(VENDOR_DIR))
        return VENDOR_DIR

    backup_dir = Path(tempfile.mkdtemp(prefix="jpype15-old-", dir=VENDOR_PARENT_DIR))
    backup_dir.rmdir()

    try:
        VENDOR_DIR.replace(backup_dir)
    except OSError:
        _merge_vendor_contents(staging_dir, VENDOR_DIR)
        _validate_vendor(VENDOR_DIR)
        shutil.rmtree(staging_dir, ignore_errors=True)
        return VENDOR_DIR

    try:
        shutil.move(str(staging_dir), str(VENDOR_DIR))
    except Exception:
        if not VENDOR_DIR.exists() and backup_dir.exists():
            backup_dir.replace(VENDOR_DIR)
        raise

    try:
        shutil.rmtree(backup_dir)
    except OSError as exc:
        print(f"warning: JPype 旧 vendor 目录清理失败，可稍后手动删除：{backup_dir} ({exc})")

    return VENDOR_DIR


def main() -> None:
    VENDOR_PARENT_DIR.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix="jpype15-build-", dir=VENDOR_PARENT_DIR))
    _install_vendor(staging_dir)

    vendor_dir = _promote_vendor(staging_dir)
    _validate_vendor(vendor_dir)
    _write_manifest(vendor_dir)

    if vendor_dir == VENDOR_DIR:
        print(f"JPype {JPYPE_VERSION} vendor ready: {vendor_dir}")
    else:
        print(f"JPype {JPYPE_VERSION} vendor ready from staging: {vendor_dir}")


if __name__ == "__main__":
    main()
