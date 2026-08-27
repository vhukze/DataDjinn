from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_fixture_db(db_path: Path) -> None:
    if db_path.exists():
        db_path.unlink()

    connection = sqlite3.connect(db_path)
    try:
        cursor = connection.cursor()
        cursor.executescript(
            """
            PRAGMA journal_mode = WAL;

            CREATE TABLE small_items (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              note TEXT
            );

            CREATE TABLE large_items (
              id INTEGER PRIMARY KEY,
              category TEXT NOT NULL,
              title TEXT NOT NULL,
              payload TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE medium_items (
              id INTEGER PRIMARY KEY,
              code TEXT NOT NULL,
              description TEXT NOT NULL
            );

            CREATE TABLE three_column_items (
              id INTEGER PRIMARY KEY,
              datasource_id INTEGER NOT NULL,
              time TEXT NOT NULL
            );

            CREATE TABLE single_column_items (
              f1 TEXT NOT NULL
            );

            CREATE VIEW active_large_items AS
            SELECT id, category, title, created_at
            FROM large_items
            WHERE id % 2 = 0;
            """
        )

        wide_columns = ",\n".join(
            f"column_{index:03d} TEXT NOT NULL" for index in range(1, 121)
        )
        cursor.execute(f"CREATE TABLE wide_items (id INTEGER PRIMARY KEY, {wide_columns})")

        cursor.executemany(
            "INSERT INTO small_items(id, name, note) VALUES (?, ?, ?)",
            [
                (1, "alpha", "first row"),
                (2, "beta", "second row"),
                (3, "gamma", "third row"),
                (4, "delta", "fourth row"),
            ],
        )

        medium_rows = [
            (index, f"CODE_{index:03d}", f"medium description row {index}")
            for index in range(1, 121)
        ]
        cursor.executemany(
            "INSERT INTO medium_items(id, code, description) VALUES (?, ?, ?)",
            medium_rows,
        )

        three_column_rows = [
            (index, index % 17, f"2026-08-13 10:{index % 60:02d}:{index % 60:02d}")
            for index in range(1, 10001)
        ]
        cursor.executemany(
            "INSERT INTO three_column_items(id, datasource_id, time) VALUES (?, ?, ?)",
            three_column_rows,
        )
        single_column_rows = [
            (f"AYZ505={index} 3303291972121523 deliberately long value {index}",)
            for index in range(1, 10001)
        ]
        cursor.executemany("INSERT INTO single_column_items(f1) VALUES (?)", single_column_rows)

        wide_rows = [
            (index, *(f"column_{column:03d}_row_{index:03d}" for column in range(1, 121)))
            for index in range(1, 1001)
        ]
        wide_placeholders = ", ".join("?" for _ in range(121))
        cursor.executemany(
            f"INSERT INTO wide_items VALUES ({wide_placeholders})",
            wide_rows,
        )

        extra_table_statements = []
        for index in range(1, 41):
            extra_table_statements.append(
                f"""
                CREATE TABLE extra_items_{index:02d} (
                  id INTEGER PRIMARY KEY,
                  name TEXT NOT NULL
                );
                """
            )
        cursor.executescript("\n".join(extra_table_statements))

        payload = "x" * 256
        large_rows = [
            (
                index,
                f"category_{index % 12}",
                f"large row {index}",
                f"{payload}_{index}",
                f"2026-01-{(index % 28) + 1:02d} 10:{index % 60:02d}:00",
            )
            for index in range(1, 10001)
        ]
        cursor.executemany(
            "INSERT INTO large_items(id, category, title, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            large_rows,
        )
        connection.commit()
    finally:
        connection.close()


def write_connections(data_dir: Path, db_path: Path) -> None:
    connections_path = data_dir / "connections.json"
    payload = {
        "connections": [
            {
                "connection_id": "regression-sqlite-fixture",
                "name": "回归测试 SQLite",
                "database_type": "sqlite",
                "host": None,
                "port": None,
                "username": None,
                "encrypted_password": None,
                "database": str(db_path),
                "sqlite_path": str(db_path),
                "driver_id": None,
                "driver_path": None,
                "dm_driver_id": None,
                "dm_driver_path": None,
            }
        ]
    }
    connections_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    root_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (Path.cwd() / ".tmp" / "regression-user-data").resolve()
    ensure_dir(root_dir)
    run_dir = ensure_dir(root_dir / f"run-{int(time.time() * 1000)}")
    db_path = run_dir / "regression-fixture.sqlite"
    build_fixture_db(db_path)
    write_connections(run_dir, db_path)
    (root_dir / "current.json").write_text(
        json.dumps({"current_user_data_dir": str(run_dir)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(str(run_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
