"""AI Office — Database layer (SQLite via aiosqlite)."""

import aiosqlite
import json
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data" / "office.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    msg_type TEXT DEFAULT 'message',
    parent_id INTEGER,
    pinned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'backlog',
    assigned_to TEXT,
    created_by TEXT,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    decided_by TEXT,
    rationale TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT,
    output TEXT,
    exit_code INTEGER,
    approved_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_names (
    channel_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    skills TEXT,
    backend TEXT DEFAULT 'ollama',
    model TEXT NOT NULL,
    permissions TEXT DEFAULT 'read',
    active INTEGER DEFAULT 1,
    color TEXT DEFAULT '#6B7280',
    emoji TEXT DEFAULT '🤖',
    system_prompt TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


async def get_db() -> aiosqlite.Connection:
    """Get a database connection."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Create all tables and seed default agents from registry."""
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        await _seed_agents(db)
        await db.commit()
    finally:
        await db.close()


async def _seed_agents(db: aiosqlite.Connection):
    """Load agents from registry.json into DB if not already present."""
    registry_path = Path(__file__).parent.parent / "agents" / "registry.json"
    if not registry_path.exists():
        return

    with open(registry_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for agent in data.get("agents", []):
        existing = await db.execute("SELECT id FROM agents WHERE id = ?", (agent["id"],))
        if await existing.fetchone():
            continue
        await db.execute(
            """INSERT INTO agents (id, display_name, role, skills, backend, model,
               permissions, active, color, emoji, system_prompt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                agent["id"],
                agent["display_name"],
                agent["role"],
                json.dumps(agent.get("skills", [])),
                agent.get("backend", "ollama"),
                agent["model"],
                agent.get("permissions", "read"),
                1 if agent.get("active", True) else 0,
                agent.get("color", "#6B7280"),
                agent.get("emoji", "🤖"),
                agent.get("system_prompt", ""),
            ),
        )


# ── Query helpers ──────────────────────────────────────────

async def insert_message(channel: str, sender: str, content: str,
                         msg_type: str = "message", parent_id: Optional[int] = None) -> dict:
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO messages (channel, sender, content, msg_type, parent_id)
               VALUES (?, ?, ?, ?, ?)""",
            (channel, sender, content, msg_type, parent_id),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,))
        msg = await row.fetchone()
        return dict(msg)
    finally:
        await db.close()


async def get_messages(channel: str, limit: int = 50, before_id: Optional[int] = None) -> list[dict]:
    db = await get_db()
    try:
        if before_id:
            rows = await db.execute(
                "SELECT * FROM messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?",
                (channel, before_id, limit),
            )
        else:
            rows = await db.execute(
                "SELECT * FROM messages WHERE channel = ? ORDER BY id DESC LIMIT ?",
                (channel, limit),
            )
        results = [dict(r) for r in await rows.fetchall()]
        results.reverse()
        return results
    finally:
        await db.close()


async def get_agents(active_only: bool = True) -> list[dict]:
    db = await get_db()
    try:
        if active_only:
            rows = await db.execute("SELECT * FROM agents WHERE active = 1")
        else:
            rows = await db.execute("SELECT * FROM agents")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


async def get_agent(agent_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        result = await row.fetchone()
        return dict(result) if result else None
    finally:
        await db.close()


async def get_channel_name(channel_id: str) -> Optional[str]:
    db = await get_db()
    try:
        row = await db.execute("SELECT display_name FROM channel_names WHERE channel_id = ?", (channel_id,))
        result = await row.fetchone()
        return result["display_name"] if result else None
    finally:
        await db.close()


async def set_channel_name(channel_id: str, display_name: str):
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO channel_names (channel_id, display_name, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (channel_id, display_name))
        await db.commit()
    finally:
        await db.close()


async def get_all_channel_names() -> dict:
    db = await get_db()
    try:
        rows = await db.execute("SELECT channel_id, display_name FROM channel_names")
        results = await rows.fetchall()
        return {r["channel_id"]: r["display_name"] for r in results}
    finally:
        await db.close()
