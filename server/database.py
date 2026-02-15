"""AI Office — Database layer (SQLite via aiosqlite)."""

import aiosqlite
import json
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data" / "office.db"
ALLOWED_AGENT_UPDATE_FIELDS = {
    "display_name",
    "role",
    "backend",
    "model",
    "permissions",
    "active",
    "color",
    "emoji",
    "system_prompt",
}

TASK_STATUSES = {"backlog", "in_progress", "review", "done", "blocked"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'group',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'user',
    emoji TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, actor_id, actor_type, emoji)
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

CREATE TABLE IF NOT EXISTS channel_projects (
    channel TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,
    channel TEXT,
    project_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS build_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    project_name TEXT NOT NULL,
    stage TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    exit_code INTEGER,
    summary TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        await _run_migrations(db)
        await _seed_agents(db)
        await _seed_channels(db)
        await db.commit()
    finally:
        await db.close()


async def _run_migrations(db: aiosqlite.Connection):
    """Non-destructive schema migrations for existing local DBs."""
    await _ensure_column(db, "tasks", "assigned_by", "TEXT")


async def _ensure_column(db: aiosqlite.Connection, table: str, column: str, column_def: str):
    rows = await db.execute(f"PRAGMA table_info({table})")
    cols = {row["name"] for row in await rows.fetchall()}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def}")


async def _seed_agents(db: aiosqlite.Connection):
    """Load agents from registry.json into DB if not already present."""
    registry_path = Path(__file__).parent.parent / "agents" / "registry.json"
    agents = []
    if not registry_path.exists():
        agents = []
    else:
        with open(registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        agents = data.get("agents", [])

    # Built-in fallback staff members that should always exist even if registry drifts.
    if not any(a.get("id") == "codex" for a in agents):
        agents.append({
            "id": "codex",
            "display_name": "Codex",
            "role": "Implementation Overseer",
            "skills": [],
            "backend": "openai",
            "model": "gpt-4o-mini",
            "permissions": "read,run,write",
            "active": True,
            "color": "#0EA5E9",
            "emoji": "C",
            "system_prompt": (
                "You are Codex, a senior implementation teammate. "
                "Help with coding, debugging, architecture sanity checks, and technical execution. "
                "Give concise, direct guidance and call out risks early. "
                "Coordinate with Nova and Scout when strategy or research is needed. "
                "If a teammate suggests a brittle or unsafe implementation shortcut, challenge it and propose a safer minimal alternative."
            ),
        })

    for agent in agents:
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


async def _seed_channels(db: aiosqlite.Connection):
    """Create default main channel if it doesn't exist."""
    existing = await db.execute("SELECT id FROM channels WHERE id = ?", ("main",))
    if not await existing.fetchone():
        await db.execute(
            "INSERT INTO channels (id, name, type) VALUES (?, ?, ?)",
            ("main", "Main Room", "group"))


# ── Channel CRUD ───────────────────────────────────────────

async def get_channels() -> list[dict]:
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM channels ORDER BY created_at")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


async def create_channel(channel_id: str, name: str, ch_type: str = "group") -> dict:
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO channels (id, name, type) VALUES (?, ?, ?)",
            (channel_id, name, ch_type))
        await db.commit()
        row = await db.execute("SELECT * FROM channels WHERE id = ?", (channel_id,))
        return dict(await row.fetchone())
    finally:
        await db.close()


async def delete_channel(channel_id: str, delete_messages: bool = True):
    db = await get_db()
    try:
        if delete_messages:
            await db.execute("DELETE FROM messages WHERE channel = ?", (channel_id,))
        await db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        await db.execute("DELETE FROM channel_names WHERE channel_id = ?", (channel_id,))
        await db.commit()
    finally:
        await db.close()


async def rename_channel_db(channel_id: str, name: str):
    db = await get_db()
    try:
        await db.execute("UPDATE channels SET name = ? WHERE id = ?", (name, channel_id))
        await db.commit()
    finally:
        await db.close()


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


async def get_message_by_id(message_id: int) -> Optional[dict]:
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        result = await row.fetchone()
        return dict(result) if result else None
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


async def update_agent(agent_id: str, updates: dict) -> Optional[dict]:
    filtered = {k: v for k, v in updates.items() if k in ALLOWED_AGENT_UPDATE_FIELDS}
    if not filtered:
        return await get_agent(agent_id)

    if "active" in filtered:
        filtered["active"] = 1 if filtered["active"] else 0

    assignments = ", ".join(f"{field} = ?" for field in filtered.keys())
    params = list(filtered.values()) + [agent_id]

    db = await get_db()
    try:
        cursor = await db.execute(
            f"UPDATE agents SET {assignments} WHERE id = ?",
            params,
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None

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


async def toggle_message_reaction(
    message_id: int,
    actor_id: str,
    emoji: str,
    actor_type: str = "user",
) -> dict:
    db = await get_db()
    try:
        existing = await db.execute(
            """SELECT id FROM message_reactions
               WHERE message_id = ? AND actor_id = ? AND actor_type = ? AND emoji = ?""",
            (message_id, actor_id, actor_type, emoji),
        )
        row = await existing.fetchone()
        if row:
            await db.execute("DELETE FROM message_reactions WHERE id = ?", (row["id"],))
            toggled_on = False
        else:
            await db.execute(
                """INSERT INTO message_reactions (message_id, actor_id, actor_type, emoji)
                   VALUES (?, ?, ?, ?)""",
                (message_id, actor_id, actor_type, emoji),
            )
            toggled_on = True
        await db.commit()
        summary = await get_message_reactions(message_id)
        return {
            "ok": True,
            "message_id": message_id,
            "emoji": emoji,
            "actor_id": actor_id,
            "actor_type": actor_type,
            "toggled_on": toggled_on,
            "summary": summary,
        }
    finally:
        await db.close()


async def get_message_reactions(message_id: int) -> dict:
    db = await get_db()
    try:
        rows = await db.execute(
            """SELECT emoji, actor_id, actor_type
               FROM message_reactions
               WHERE message_id = ?
               ORDER BY id ASC""",
            (message_id,),
        )
        records = [dict(r) for r in await rows.fetchall()]
        by_emoji: dict[str, dict] = {}
        for record in records:
            emoji = record["emoji"]
            entry = by_emoji.setdefault(emoji, {"count": 0, "reactors": []})
            entry["count"] += 1
            entry["reactors"].append({
                "actor_id": record["actor_id"],
                "actor_type": record["actor_type"],
            })
        return {"message_id": message_id, "reactions": by_emoji}
    finally:
        await db.close()


async def record_decision(title: str, description: str, decided_by: str = "system", rationale: str = "") -> dict:
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO decisions (title, description, decided_by, rationale)
               VALUES (?, ?, ?, ?)""",
            (title, description, decided_by, rationale),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM decisions WHERE id = ?", (cursor.lastrowid,))
        result = await row.fetchone()
        return dict(result) if result else {}
    finally:
        await db.close()


async def set_channel_active_project(channel: str, project_name: str):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO channel_projects (channel, project_name, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(channel) DO UPDATE SET
               project_name = excluded.project_name,
               updated_at = CURRENT_TIMESTAMP""",
            (channel, project_name),
        )
        await db.commit()
    finally:
        await db.close()


async def get_channel_active_project(channel: str) -> Optional[str]:
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT project_name FROM channel_projects WHERE channel = ?",
            (channel,),
        )
        result = await row.fetchone()
        return result["project_name"] if result else None
    finally:
        await db.close()


async def list_channel_projects() -> list[dict]:
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM channel_projects ORDER BY channel")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


async def get_tasks_for_agent(agent_id: str) -> list[dict]:
    db = await get_db()
    try:
        rows = await db.execute(
            """SELECT * FROM tasks
               WHERE assigned_to = ? AND status != 'done'
               ORDER BY priority DESC, updated_at DESC""",
            (agent_id,),
        )
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


async def update_task_from_tag(
    task_id: int,
    status: str,
    agent_id: str,
    summary: Optional[str] = None,
) -> Optional[dict]:
    normalized = status.strip().lower()
    if normalized not in TASK_STATUSES:
        return None

    db = await get_db()
    try:
        if summary:
            await db.execute(
                """UPDATE tasks
                   SET status = ?, description = COALESCE(description, '') || ?,
                       assigned_by = COALESCE(assigned_by, ?), updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (normalized, f"\n\n[{agent_id}] {summary.strip()}", agent_id, task_id),
            )
        else:
            await db.execute(
                """UPDATE tasks
                   SET status = ?, assigned_by = COALESCE(assigned_by, ?), updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (normalized, agent_id, task_id),
            )
        await db.commit()
        row = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        result = await row.fetchone()
        return dict(result) if result else None
    finally:
        await db.close()


async def log_api_usage(
    provider: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    estimated_cost: float = 0.0,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO api_usage (
                   provider, model, prompt_tokens, completion_tokens, total_tokens,
                   estimated_cost, channel, project_name
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                provider,
                model,
                int(prompt_tokens or 0),
                int(completion_tokens or 0),
                int(total_tokens or 0),
                float(estimated_cost or 0.0),
                channel,
                project_name,
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def log_build_result(
    agent_id: str,
    channel: str,
    project_name: str,
    stage: str,
    success: bool,
    exit_code: Optional[int] = None,
    summary: str = "",
):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO build_results (
                   agent_id, channel, project_name, stage, success, exit_code, summary
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                agent_id,
                channel,
                project_name,
                stage,
                1 if success else 0,
                exit_code,
                summary[:1000],
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def get_agent_performance(agent_id: str) -> dict:
    db = await get_db()
    try:
        metrics = {
            "messages": 0,
            "tool_calls": 0,
            "build_pass": 0,
            "build_fail": 0,
            "tests_pass": 0,
            "tests_fail": 0,
            "tasks_done": 0,
            "tasks_blocked": 0,
        }

        row = await db.execute("SELECT COUNT(*) as c FROM messages WHERE sender = ?", (agent_id,))
        metrics["messages"] = int((await row.fetchone())["c"])

        row = await db.execute("SELECT COUNT(*) as c FROM tool_logs WHERE agent_id = ?", (agent_id,))
        metrics["tool_calls"] = int((await row.fetchone())["c"])

        row = await db.execute(
            "SELECT COUNT(*) as c FROM build_results WHERE agent_id = ? AND stage = 'build' AND success = 1",
            (agent_id,),
        )
        metrics["build_pass"] = int((await row.fetchone())["c"])
        row = await db.execute(
            "SELECT COUNT(*) as c FROM build_results WHERE agent_id = ? AND stage = 'build' AND success = 0",
            (agent_id,),
        )
        metrics["build_fail"] = int((await row.fetchone())["c"])

        row = await db.execute(
            "SELECT COUNT(*) as c FROM build_results WHERE agent_id = ? AND stage = 'test' AND success = 1",
            (agent_id,),
        )
        metrics["tests_pass"] = int((await row.fetchone())["c"])
        row = await db.execute(
            "SELECT COUNT(*) as c FROM build_results WHERE agent_id = ? AND stage = 'test' AND success = 0",
            (agent_id,),
        )
        metrics["tests_fail"] = int((await row.fetchone())["c"])

        row = await db.execute(
            "SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = 'done'",
            (agent_id,),
        )
        metrics["tasks_done"] = int((await row.fetchone())["c"])
        row = await db.execute(
            "SELECT COUNT(*) as c FROM tasks WHERE assigned_to = ? AND status = 'blocked'",
            (agent_id,),
        )
        metrics["tasks_blocked"] = int((await row.fetchone())["c"])
        return metrics
    finally:
        await db.close()


async def get_all_agent_performance() -> list[dict]:
    db = await get_db()
    try:
        rows = await db.execute("SELECT id FROM agents ORDER BY id")
        ids = [r["id"] for r in await rows.fetchall()]
    finally:
        await db.close()

    results = []
    for agent_id in ids:
        perf = await get_agent_performance(agent_id)
        perf["agent_id"] = agent_id
        results.append(perf)
    return results


async def get_setting(key: str) -> Optional[str]:
    db = await get_db()
    try:
        row = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        result = await row.fetchone()
        return result["value"] if result else None
    finally:
        await db.close()


async def set_setting(key: str, value: str):
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = CURRENT_TIMESTAMP""",
            (key, value),
        )
        await db.commit()
    finally:
        await db.close()


async def get_api_usage_summary(
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> dict:
    db = await get_db()
    try:
        query = "SELECT provider, total_tokens, estimated_cost FROM api_usage"
        clauses = []
        params = []
        if channel:
            clauses.append("channel = ?")
            params.append(channel)
        if project_name:
            clauses.append("project_name = ?")
            params.append(project_name)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        rows = await db.execute(query, tuple(params))
        items = [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()

    total_tokens = sum(int(item.get("total_tokens", 0) or 0) for item in items)
    total_cost = sum(float(item.get("estimated_cost", 0) or 0) for item in items)
    by_provider = {}
    for item in items:
        provider = item.get("provider") or "unknown"
        entry = by_provider.setdefault(provider, {"tokens": 0, "cost": 0.0})
        entry["tokens"] += int(item.get("total_tokens", 0) or 0)
        entry["cost"] += float(item.get("estimated_cost", 0) or 0)
    return {
        "total_tokens": total_tokens,
        "total_estimated_cost": total_cost,
        "by_provider": by_provider,
        "rows": len(items),
    }
