import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.runtime_paths import DB_PATH

SQL_INSERT = """
INSERT INTO agents (
    id, display_name, role, skills, backend, model,
    permissions, active, color, emoji, system_prompt
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

VALUES = (
    "codex",
    "Codex",
    "Implementation Overseer",
    json.dumps([]),
    "openai",
    "gpt-4o-mini",
    "read,run,write",
    1,
    "#0EA5E9",
    "C",
    (
        "You are Codex, a senior implementation teammate. "
        "Help with coding, debugging, architecture sanity checks, and technical execution. "
        "Give concise, direct guidance and call out risks early. "
        "Coordinate with Nova and Scout when strategy or research is needed."
    ),
)


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    exists = cur.execute("SELECT 1 FROM agents WHERE id = ?", ("codex",)).fetchone()
    if exists:
        print("CODEX_AGENT_ALREADY_PRESENT")
        conn.close()
        return

    cur.execute(SQL_INSERT, VALUES)
    conn.commit()
    conn.close()
    print("CODEX_AGENT_INSERTED")


if __name__ == "__main__":
    main()
