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
DIST_DIR = BACKEND_DIR / "dist" / "modules"

RUNTIMES = {
    "clickhouse": {
        "package": "clickhouse-connect==0.10.0",
        "module_name": "datadjinn-clickhouse",
    },
    "elasticsearch": {
        "package": "elasticsearch==8.18.1",
        "module_name": "datadjinn-elasticsearch",
    },
    "oracle": {
        "package": "oracledb==3.1.1",
        "module_name": "datadjinn-oracle",
    },
}


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


def _install_runtime_package(package: str, target: Path) -> None:
    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--only-binary=:all:",
        "--target",
        str(target),
        "--upgrade",
        "--no-cache-dir",
        package,
    ])


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in RUNTIMES:
        supported = ", ".join(sorted(RUNTIMES))
        raise RuntimeError(f"请指定数据库运行时：{supported}")

    runtime_id = sys.argv[1]
    runtime = RUNTIMES[runtime_id]
    version = "1.0.0"
    module_name = runtime["module_name"]
    module_root = DIST_DIR / f"{module_name}-{version}-win-x64"
    archive_path = DIST_DIR / f"{module_name}-{version}-win-x64.zip"
    package = json.loads((PROJECT_ROOT / "package.json").read_text(encoding="utf-8"))

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"datadjinn-{runtime_id}-module-", dir=DIST_DIR) as temp_dir:
        staging_root = Path(temp_dir) / module_root.name
        python_root = staging_root / "python"
        python_root.mkdir(parents=True)
        _install_runtime_package(runtime["package"], python_root)
        (staging_root / "runtime.json").write_text(
            json.dumps({"pythonPath": "python"}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (staging_root / "module.json").write_text(
            json.dumps(
                {
                    "id": runtime_id,
                    "version": version,
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
        if module_root.exists():
            shutil.rmtree(module_root)
        shutil.move(str(staging_root), str(module_root))

    if archive_path.exists():
        archive_path.unlink()
    _write_archive(module_root, archive_path)
    print(json.dumps({"archive": str(archive_path), "sha256": _sha256(archive_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
