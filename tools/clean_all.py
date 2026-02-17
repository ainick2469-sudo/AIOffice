"""Clean messages/logs/tasks/decisions from the active AI Office database."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from platformdirs import user_data_dir


def resolve_db_path() -> Path:
    explicit = os.environ.get("AI_OFFICE_DB_PATH", "").strip()
    if explicit:
        return Path(explicit).expanduser().resolve()

    home = os.environ.get("AI_OFFICE_HOME", "").strip()
    if home:
        return (Path(home).expanduser().resolve() / "data" / "office.db")

    default_home = Path(user_data_dir("AIOffice", appauthor=False))
    return (default_home / "data" / "office.db").resolve()


def table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
    row = cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return bool(row)


def main() -> int:
    db_path = resolve_db_path()
    if not db_path.exists():
        print(f"Database not found: {db_path}")
        return 1

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    try:
        targets = ["messages", "tool_logs", "decisions", "tasks", "reactions", "build_results", "api_usage"]

        print(f"Using database: {db_path}")
        print("Before cleanup:")
        for table in targets:
            if table_exists(cur, table):
                count = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                print(f"  {table}: {count}")
        print()

        deleted_summary: dict[str, int] = {}
        for table in targets:
            if table_exists(cur, table):
                deleted = cur.execute(f"DELETE FROM {table}").rowcount or 0
                deleted_summary[table] = int(deleted)

        conn.commit()

        print("Cleanup complete:")
        for table, deleted in deleted_summary.items():
            print(f"  {table}: deleted {deleted}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
