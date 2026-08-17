from __future__ import annotations

import os
import re
import shutil
import zipfile
from pathlib import Path


def _jvm_candidates_from_java_executable(java_executable: str | None) -> list[Path]:
    if not java_executable:
        return []

    java_path = Path(java_executable).expanduser()
    java_bin = java_path.parent
    java_home = java_bin.parent
    return [
        java_bin / "server" / "jvm.dll",
        java_home / "bin" / "server" / "jvm.dll",
        java_home / "jre" / "bin" / "server" / "jvm.dll",
    ]


def parse_java_major(version: str | None) -> int | None:
    if not version:
        return None

    parts = re.split(r"[._\-+]", version.strip().strip('"'))
    if not parts or not parts[0].isdigit():
        return None
    if parts[0] == "1" and len(parts) > 1 and parts[1].isdigit():
        return int(parts[1])
    return int(parts[0])


def java_home_from_jvm_dll(jvm_dll: Path) -> Path:
    home = jvm_dll.parent.parent.parent
    if home.name.lower() == "jre" and home.parent.exists():
        return home.parent
    return home


def java_major_from_home(java_home: Path) -> int | None:
    release_file = java_home / "release"
    if release_file.exists():
        try:
            for line in release_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                if line.startswith("JAVA_VERSION="):
                    return parse_java_major(line.split("=", 1)[1])
        except OSError:
            pass

    return parse_java_major(java_home.name)


def jvm_candidates_from_home(java_home: str | Path | None) -> list[Path]:
    if not java_home:
        return []

    home = Path(java_home).expanduser()
    return [
        home / "bin" / "server" / "jvm.dll",
        home / "jre" / "bin" / "server" / "jvm.dll",
    ]


def collect_jvm_candidates(preferred_java_home: str | Path | None = None) -> list[Path]:
    candidates: list[Path] = []
    candidates.extend(jvm_candidates_from_home(preferred_java_home))

    module_java_home = os.environ.get("DATADJINN_JRE_MODULE_HOME")
    candidates.extend(jvm_candidates_from_home(module_java_home))

    java_home = os.environ.get("JAVA_HOME")
    candidates.extend(jvm_candidates_from_home(java_home))

    candidates.extend(_jvm_candidates_from_java_executable(shutil.which("java")))
    candidates.extend(_jvm_candidates_from_java_executable(shutil.which("java.exe")))

    for base in [Path("C:/Program Files/Java"), Path("C:/Program Files/Eclipse Adoptium"), Path("C:/Program Files/Microsoft"), Path("C:/Program Files/Zulu"), Path("C:/Program Files/BellSoft")]:
        if not base.exists():
            continue
        for pattern in ["*/bin/server/jvm.dll", "*/jre/bin/server/jvm.dll"]:
            candidates.extend(base.glob(pattern))

    return [path.resolve() for path in dict.fromkeys(candidates) if path.exists()]


def find_jvm_dll(required_java_major: int | None = None, preferred_java_home: str | Path | None = None) -> Path | None:
    candidates = collect_jvm_candidates(preferred_java_home)
    if required_java_major is None:
        return next(iter(candidates), None)

    return next((path for path in candidates if (java_major_from_home(java_home_from_jvm_dll(path)) or 0) >= required_java_major), None)


def format_java_candidates() -> str:
    candidates = collect_jvm_candidates()
    if not candidates:
        return "未检测到 Java"

    displays = []
    for path in candidates[:8]:
        java_home = java_home_from_jvm_dll(path)
        major = java_major_from_home(java_home)
        displays.append(f"Java {major or '未知版本'}：{java_home}")
    return "；".join(displays)


def java_major_from_class_header(data: bytes) -> int | None:
    if len(data) != 8 or data[:4] != b"\xca\xfe\xba\xbe":
        return None

    class_major = int.from_bytes(data[6:8], "big")
    return class_major - 44 if class_major >= 49 else None


def required_java_major_from_jar(jar_path: Path) -> int | None:
    try:
        with zipfile.ZipFile(jar_path) as archive:
            if "dm/jdbc/driver/DmDriver.class" in archive.namelist():
                java_major = java_major_from_class_header(archive.read("dm/jdbc/driver/DmDriver.class", 8))
                if java_major:
                    return java_major

            majors = []
            for name in archive.namelist():
                if not name.endswith(".class") or name.startswith("META-INF/versions/"):
                    continue
                java_major = java_major_from_class_header(archive.read(name, 8))
                if java_major:
                    majors.append(java_major)
    except Exception:
        return None

    return max(majors, default=None)


def validate_java_home(java_home: str | None) -> tuple[Path, int | None, Path]:
    if not java_home:
        raise ValueError("请选择 Java 目录")

    home = Path(java_home).expanduser().resolve()
    if not home.exists() or not home.is_dir():
        raise ValueError(f"Java 目录不存在：{home}")

    jvm_dll = next((path.resolve() for path in jvm_candidates_from_home(home) if path.exists()), None)
    if jvm_dll is None:
        raise ValueError("所选目录不是有效的 64 位 JDK/JRE 目录，请选择包含 bin/server/jvm.dll 的 Java 安装目录")

    return home, java_major_from_home(home), jvm_dll


def prepare_jdbc_runtime(required_java_major: int | None = None, preferred_java_home: str | None = None) -> str | None:
    if preferred_java_home:
        java_home, java_major, jvm_dll = validate_java_home(preferred_java_home)
        if required_java_major and (java_major or 0) < required_java_major:
            raise RuntimeError(f"当前 JDBC 驱动至少需要 Java {required_java_major}，但全局 JDBC Java 环境是 Java {java_major or '未知版本'}：{java_home}。请在驱动管理中选择 Java {required_java_major} 或更高版本的 64 位 JDK/JRE，或更换兼容当前 Java 的 JDBC 驱动")
    else:
        jvm_dll = find_jvm_dll(required_java_major)
        if jvm_dll is None:
            if required_java_major:
                raise RuntimeError(f"当前 JDBC 驱动至少需要 Java {required_java_major}，但没有检测到满足要求的 64 位 JDK/JRE。已检测到：{format_java_candidates()}。请安装 Java {required_java_major} 或更高版本，或在驱动管理中配置全局 JDBC Java 环境")
            return None
        java_home = java_home_from_jvm_dll(jvm_dll)

    jvm_bin = str(jvm_dll.parent.parent)
    os.environ["PATH"] = f"{jvm_bin}{os.pathsep}{os.environ.get('PATH', '')}"
    os.environ["JAVA_HOME"] = str(java_home)
    return str(jvm_dll)


def detect_java_runtimes() -> list[dict[str, str | int | None]]:
    runtimes = []
    seen_homes: set[str] = set()
    for jvm_dll in collect_jvm_candidates():
        java_home = java_home_from_jvm_dll(jvm_dll)
        home = str(java_home)
        if home in seen_homes:
            continue
        seen_homes.add(home)
        runtimes.append({
            "home": home,
            "major": java_major_from_home(java_home),
            "jvm_path": str(jvm_dll),
        })
    return runtimes
