"""Remove smoke/test junk tasks from the local AI Office SQLite database.

Usage:
  python tools/clean_test_data.py
  python tools/clean_test_data.py --dry-run
  python tools/clean_test_data.py --all
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "office.db"

DEFAULT_PATTERNS = (
    "smoke",
    "test",
    "dummy",
    "placeholder",
    "sample",
    "tmp",
    "e2e",
)


def find_matching_tasks(conn: sqlite3.Connection, include_all: bool = False) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    if include_all:
        return list(cur.execute("SELECT * FROM tasks ORDER BY id"))

    task_cols = {row["name"] for row in cur.execute("PRAGMA table_info(tasks)").fetchall()}
    searchable = ["title", "description", "created_by"]
    if "assigned_by" in task_cols:
        searchable.append("assigned_by")

    where = " OR ".join([f"LOWER(COALESCE({col}, '')) LIKE ?" for col in searchable])
    args = []
    for token in DEFAULT_PATTERNS:
        like = f"%{token}%"
        args.extend([like] * len(searchable))

    query = f"SELECT * FROM tasks WHERE ({where}) ORDER BY id"
    return list(cur.execute(query, args))


def delete_tasks(conn: sqlite3.Connection, task_ids: list[int]) -> int:
    if not task_ids:
        return 0
    cur = conn.cursor()
    placeholders = ",".join("?" for _ in task_ids)
    cur.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", task_ids)
    conn.commit()
    return cur.rowcount


def main() -> int:
    parser = argparse.ArgumentParser(description="Delete smoke/test junk tasks from AI Office DB.")
    parser.add_argument("--dry-run", action="store_true", help="Only show matching tasks.")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Delete all tasks (dangerous).",
    )
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return 1

    conn = sqlite3.connect(DB_PATH)
    try:
        rows = find_matching_tasks(conn, include_all=args.all)
        if not rows:
            print("No matching tasks found.")
            return 0

        print(f"Matched {len(rows)} task(s):")
        for row in rows[:60]:
            print(f"  #{row['id']:>4} [{row['status']}] {row['title']}")
        if len(rows) > 60:
            print(f"  ... and {len(rows) - 60} more")

        if args.dry_run:
            print("Dry run complete. No rows deleted.")
            return 0

        deleted = delete_tasks(conn, [int(r["id"]) for r in rows])
        print(f"Deleted {deleted} task(s).")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
