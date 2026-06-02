from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

JPYPE_VERSION = "1.5.2"
BACKEND_DIR = Path(__file__).resolve().parents[1]
VENDOR_DIR = BACKEND_DIR / "vendor" / "jpype15"


def main() -> None:
    if VENDOR_DIR.exists():
        shutil.rmtree(VENDOR_DIR)
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)

    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--only-binary=:all:",
        "--target",
        str(VENDOR_DIR),
        "--upgrade",
        "--no-cache-dir",
        f"JPype1=={JPYPE_VERSION}",
    ])

    for path in [*VENDOR_DIR.glob("packaging"), *VENDOR_DIR.glob("packaging-*.dist-info")]:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)

    jar_path = VENDOR_DIR / "org.jpype.jar"
    if not jar_path.exists():
        raise RuntimeError(f"JPype vendor 缺少 org.jpype.jar：{jar_path}")

    print(f"JPype {JPYPE_VERSION} vendor ready: {VENDOR_DIR}")


if __name__ == "__main__":
    main()
