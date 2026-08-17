from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from PyInstaller.__main__ import run

BACKEND_DIR = Path(__file__).resolve().parents[1]
DIST_BACKEND_DIR = BACKEND_DIR / "dist" / "datadjinn-backend"
BACKEND_EXE_NAME = "datadjinn-backend.exe" if sys.platform == "win32" else "datadjinn-backend"
DIST_BACKEND_EXE = DIST_BACKEND_DIR / BACKEND_EXE_NAME
def _format_dist_tree(dist_dir: Path) -> str:
    if not dist_dir.exists():
        return f"{dist_dir} 不存在"

    entries = []
    for path in sorted(dist_dir.rglob("*")):
        relative_path = path.relative_to(dist_dir)
        suffix = "/" if path.is_dir() else ""
        entries.append(f"  - {relative_path}{suffix}")

    return "\n".join(entries) if entries else f"{dist_dir} 为空"


def _find_packaged_backend_exe() -> Path | None:
    if DIST_BACKEND_EXE.exists():
        return DIST_BACKEND_EXE

    if not DIST_BACKEND_DIR.exists():
        return None

    matches = sorted(DIST_BACKEND_DIR.rglob(BACKEND_EXE_NAME))
    return matches[0] if matches else None


def _normalize_packaged_backend_exe(packaged_exe: Path) -> None:
    if packaged_exe == DIST_BACKEND_EXE:
        return

    DIST_BACKEND_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(packaged_exe, DIST_BACKEND_EXE)


def main() -> None:
    os.chdir(BACKEND_DIR)
    if DIST_BACKEND_DIR.exists():
        shutil.rmtree(DIST_BACKEND_DIR)

    run([
        "run.py",
        "--name",
        "datadjinn-backend",
        "--onedir",
        "--clean",
        "--noconfirm",
        "--distpath",
        str(BACKEND_DIR / "dist"),
        "--workpath",
        str(BACKEND_DIR / "build"),
        "--specpath",
        str(BACKEND_DIR),
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
        "--hidden-import",
        "clickhouse_connect.cc_sqlalchemy",
        "--hidden-import",
        "clickhouse_connect.cc_sqlalchemy.dialect",
        "--collect-submodules",
        "clickhouse_connect",
        "--hidden-import",
        "oracledb",
        "--collect-submodules",
        "oracledb",
        "--exclude-module",
        "app.git_versioning.data_history",
        "--exclude-module",
        "jaydebeapi",
        "--exclude-module",
        "jpype",
        "--exclude-module",
        "dmPython",
        "--exclude-module",
        "dmSQLAlchemy",
        "--exclude-module",
        "dmssl",
    ])

    packaged_exe = _find_packaged_backend_exe()
    if packaged_exe is None:
        dist_tree = _format_dist_tree(BACKEND_DIR / "dist")
        raise RuntimeError(f"后端打包产物不存在：{DIST_BACKEND_EXE}\n当前 dist 目录内容：\n{dist_tree}")

    _normalize_packaged_backend_exe(packaged_exe)

if __name__ == "__main__":
    main()
