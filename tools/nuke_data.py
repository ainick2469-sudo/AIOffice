"""Hard reset of dynamic database tables for the active AI Office environment."""

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


def main() -> int:
    db_path = resolve_db_path()
    print(f"DB path: {db_path}")
    if not db_path.exists():
        print("Database does not exist; nothing to clear.")
        return 0

    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    try:
        tables = [row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        print(f"Tables detected: {tables}")

        targets = ["messages", "tool_logs", "decisions", "tasks", "message_reactions", "build_results", "api_usage"]
        for table in targets:
            if table in tables:
                cur.execute(f"DELETE FROM [{table}]")
                print(f"Cleared {table}")

        conn.commit()
        print("Done.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
