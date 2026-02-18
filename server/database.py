"""AI Office — Database layer (SQLite via aiosqlite)."""

import aiosqlite
import json
import os
import tempfile
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .runtime_config import APP_ROOT, DB_PATH as RUNTIME_DB_PATH, ensure_runtime_dirs


def resolve_db_path() -> Path:
    explicit = (os.environ.get("AI_OFFICE_DB_PATH") or "").strip()
    testing = (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1"
    if explicit:
        return Path(explicit).expanduser().resolve()
    if testing:
        return (Path(tempfile.gettempdir()) / "ai-office-tests" / "office-test.db").resolve()
    return Path(RUNTIME_DB_PATH).expanduser().resolve()


DB_PATH = resolve_db_path()
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
VALID_AUTONOMY_MODES = {"SAFE", "TRUSTED", "ELEVATED"}
VALID_PERMISSION_MODES = {"locked", "ask", "trusted"}
DEFAULT_PERMISSION_SCOPES = ["read", "search", "run", "write", "task"]


def _task_title_key(value: Optional[str]) -> str:
    return " ".join(((value or "").strip().lower()).split())

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
    why TEXT,
    acceptance_criteria TEXT,
    status TEXT DEFAULT 'backlog',
    assigned_to TEXT,
    channel TEXT NOT NULL DEFAULT 'main',
    project_name TEXT NOT NULL DEFAULT 'ai-office',
    branch TEXT NOT NULL DEFAULT 'main',
    subtasks TEXT DEFAULT '[]',
    linked_files TEXT DEFAULT '[]',
    depends_on TEXT DEFAULT '[]',
    created_by TEXT,
    source_message_id INTEGER,
    source_tool_log_id INTEGER,
    duplicate_count INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 2,
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
    channel TEXT,
    task_id TEXT,
    approval_request_id TEXT,
    approved_by TEXT,
    policy_mode TEXT,
    reason TEXT,
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

CREATE TABLE IF NOT EXISTS channel_branches (
    channel TEXT NOT NULL,
    project_name TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel, project_name)
);

CREATE TABLE IF NOT EXISTS spec_states (
    channel TEXT NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'none',
    spec_version TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel, project_name)
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

CREATE TABLE IF NOT EXISTS project_autonomy_modes (
    project_name TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'SAFE',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permission_policies (
    channel TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'ask',
    expires_at TEXT,
    scopes TEXT,
    command_allowlist_profile TEXT NOT NULL DEFAULT 'safe',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    project_name TEXT,
    branch TEXT,
    expires_at TEXT,
    task_id TEXT,
    agent_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permission_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    project_name TEXT,
    scope TEXT NOT NULL,
    grant_level TEXT NOT NULL DEFAULT 'chat',
    source_request_id TEXT,
    expires_at TEXT,
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS managed_processes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id TEXT NOT NULL UNIQUE,
    session_id TEXT,
    channel TEXT NOT NULL,
    project_name TEXT,
    pid INTEGER,
    command TEXT NOT NULL,
    cwd TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at INTEGER,
    ended_at INTEGER,
    exit_code INTEGER,
    metadata_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS console_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    project_name TEXT,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    message TEXT,
    data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


async def get_db() -> aiosqlite.Connection:
    """Get a database connection."""
    testing = (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1"
    if not testing:
        ensure_runtime_dirs()
    db_path = resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(db_path))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Create all tables and seed default agents from registry."""
    testing = (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1"
    if not testing:
        ensure_runtime_dirs()
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
    await db.execute(
        """CREATE TABLE IF NOT EXISTS channel_branches (
               channel TEXT NOT NULL,
               project_name TEXT NOT NULL,
               branch TEXT NOT NULL DEFAULT 'main',
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (channel, project_name)
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS spec_states (
               channel TEXT NOT NULL,
               project_name TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'none',
               spec_version TEXT,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (channel, project_name)
           )"""
    )
    await _ensure_column(db, "tasks", "assigned_by", "TEXT")
    await _ensure_column(db, "tasks", "channel", "TEXT NOT NULL DEFAULT 'main'")
    await _ensure_column(db, "tasks", "project_name", "TEXT NOT NULL DEFAULT 'ai-office'")
    await _ensure_column(db, "tasks", "branch", "TEXT NOT NULL DEFAULT 'main'")
    await _ensure_column(db, "tasks", "why", "TEXT")
    await _ensure_column(db, "tasks", "acceptance_criteria", "TEXT")
    await _ensure_column(db, "tasks", "subtasks", "TEXT DEFAULT '[]'")
    await _ensure_column(db, "tasks", "linked_files", "TEXT DEFAULT '[]'")
    await _ensure_column(db, "tasks", "depends_on", "TEXT DEFAULT '[]'")
    await _ensure_column(db, "tasks", "source_message_id", "INTEGER")
    await _ensure_column(db, "tasks", "source_tool_log_id", "INTEGER")
    await _ensure_column(db, "tasks", "duplicate_count", "INTEGER DEFAULT 0")
    await _ensure_column(db, "tool_logs", "channel", "TEXT")
    await _ensure_column(db, "tool_logs", "task_id", "TEXT")
    await _ensure_column(db, "tool_logs", "approval_request_id", "TEXT")
    await _ensure_column(db, "tool_logs", "policy_mode", "TEXT")
    await _ensure_column(db, "tool_logs", "reason", "TEXT")

    await db.execute(
        """CREATE TABLE IF NOT EXISTS permission_policies (
               channel TEXT PRIMARY KEY,
               mode TEXT NOT NULL DEFAULT 'ask',
               expires_at TEXT,
               scopes TEXT,
               command_allowlist_profile TEXT NOT NULL DEFAULT 'safe',
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS approval_requests (
               id TEXT PRIMARY KEY,
               channel TEXT NOT NULL,
               project_name TEXT,
               branch TEXT,
               expires_at TEXT,
               task_id TEXT,
               agent_id TEXT NOT NULL,
               tool_type TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               risk_level TEXT NOT NULL DEFAULT 'medium',
               status TEXT NOT NULL DEFAULT 'pending',
               decided_by TEXT,
               decided_at TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
    )
    await _ensure_column(db, "approval_requests", "project_name", "TEXT")
    await _ensure_column(db, "approval_requests", "branch", "TEXT")
    await _ensure_column(db, "approval_requests", "expires_at", "TEXT")
    await db.execute(
        """CREATE TABLE IF NOT EXISTS permission_grants (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               channel TEXT NOT NULL,
               project_name TEXT,
               scope TEXT NOT NULL,
               grant_level TEXT NOT NULL DEFAULT 'chat',
               source_request_id TEXT,
               expires_at TEXT,
               created_by TEXT NOT NULL DEFAULT 'user',
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS managed_processes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               process_id TEXT NOT NULL UNIQUE,
               session_id TEXT,
               channel TEXT NOT NULL,
               project_name TEXT,
               pid INTEGER,
               command TEXT NOT NULL,
               cwd TEXT,
               status TEXT NOT NULL DEFAULT 'running',
               started_at INTEGER,
               ended_at INTEGER,
               exit_code INTEGER,
               metadata_json TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )

    await db.execute("UPDATE tasks SET branch = 'main' WHERE branch IS NULL OR TRIM(branch) = ''")
    await db.execute("UPDATE tasks SET channel = 'main' WHERE channel IS NULL OR TRIM(channel) = ''")
    await db.execute("UPDATE tasks SET project_name = 'ai-office' WHERE project_name IS NULL OR TRIM(project_name) = ''")
    await db.execute("UPDATE tasks SET duplicate_count = 0 WHERE duplicate_count IS NULL OR duplicate_count < 0")
    await db.execute("UPDATE tasks SET subtasks = '[]' WHERE subtasks IS NULL OR subtasks = ''")
    await db.execute("UPDATE tasks SET linked_files = '[]' WHERE linked_files IS NULL OR linked_files = ''")
    await db.execute("UPDATE tasks SET depends_on = '[]' WHERE depends_on IS NULL OR depends_on = ''")
    await db.execute("UPDATE tasks SET priority = 2 WHERE priority IS NULL OR priority < 1 OR priority > 3")


def _json_dumps(value, fallback):
    try:
        return json.dumps(value if value is not None else fallback)
    except Exception:
        return json.dumps(fallback)


def _json_loads(value, fallback):
    if value in (None, ""):
        return fallback
    try:
        parsed = json.loads(value)
    except Exception:
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


def _normalize_task_row(row: dict) -> dict:
    data = dict(row)
    data["channel"] = (data.get("channel") or "main").strip() or "main"
    data["project_name"] = (data.get("project_name") or "ai-office").strip() or "ai-office"
    data["branch"] = (data.get("branch") or "main").strip() or "main"
    data["priority"] = max(1, min(3, int(data.get("priority", 2) or 2)))
    data["subtasks"] = _json_loads(data.get("subtasks"), [])
    data["linked_files"] = _json_loads(data.get("linked_files"), [])
    data["depends_on"] = _json_loads(data.get("depends_on"), [])
    return data


async def _ensure_column(db: aiosqlite.Connection, table: str, column: str, column_def: str):
    rows = await db.execute(f"PRAGMA table_info({table})")
    cols = {row["name"] for row in await rows.fetchall()}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def}")


async def _seed_agents(db: aiosqlite.Connection):
    """Load agents from registry.json into DB if not already present."""
    registry_path = APP_ROOT / "agents" / "registry.json"
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
        await db.execute("DELETE FROM channel_projects WHERE channel = ?", (channel_id,))
        await db.execute("DELETE FROM channel_branches WHERE channel = ?", (channel_id,))
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


async def clear_channel_messages(channel: str) -> int:
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM messages WHERE channel = ?", (channel,))
        await db.commit()
        return int(cursor.rowcount or 0)
    finally:
        await db.close()


async def clear_tasks_for_scope(*, channel: str, project_name: Optional[str] = None) -> int:
    """Delete tasks for a channel, optionally limited to a project."""
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "").strip() or None
    db = await get_db()
    try:
        if project:
            cursor = await db.execute(
                "DELETE FROM tasks WHERE channel = ? AND project_name = ?",
                (channel_id, project),
            )
        else:
            cursor = await db.execute("DELETE FROM tasks WHERE channel = ?", (channel_id,))
        await db.commit()
        return int(cursor.rowcount or 0)
    finally:
        await db.close()


async def clear_approval_requests_for_scope(*, channel: str, project_name: Optional[str] = None) -> int:
    """Delete approval requests for a channel, optionally limited to a project."""
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "").strip() or None
    db = await get_db()
    try:
        if project:
            cursor = await db.execute(
                "DELETE FROM approval_requests WHERE channel = ? AND (project_name = ? OR project_name IS NULL)",
                (channel_id, project),
            )
        else:
            cursor = await db.execute("DELETE FROM approval_requests WHERE channel = ?", (channel_id,))
        await db.commit()
        return int(cursor.rowcount or 0)
    finally:
        await db.close()


async def create_task_record(
    task: dict,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> dict:
    selected_channel = (channel or "main").strip() or "main"
    selected_project = (project_name or "").strip()
    if not selected_project and selected_channel:
        selected_project = await get_channel_active_project(selected_channel) or "ai-office"
    selected_project = selected_project or "ai-office"

    branch = str(task.get("branch") or "").strip()
    if not branch:
        if selected_channel and selected_project:
            branch = await get_channel_active_branch(selected_channel, selected_project)
        else:
            branch = "main"

    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO tasks (
                   title, description, status, assigned_to, channel, project_name, branch,
                   subtasks, linked_files, depends_on, created_by, priority
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                (task.get("title") or "").strip(),
                (task.get("description") or "").strip(),
                task.get("status", "backlog"),
                (task.get("assigned_to") or "").strip() or None,
                selected_channel,
                selected_project,
                branch,
                _json_dumps(task.get("subtasks"), []),
                _json_dumps(task.get("linked_files"), []),
                _json_dumps(task.get("depends_on"), []),
                (task.get("created_by") or "user").strip() or "user",
                max(1, min(3, int(task.get("priority", 2) or 2))),
            ),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,))
        result = await row.fetchone()
        return _normalize_task_row(result) if result else {}
    finally:
        await db.close()


async def get_task(task_id: int) -> Optional[dict]:
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        result = await row.fetchone()
        return _normalize_task_row(result) if result else None
    finally:
        await db.close()


async def list_tasks(
    status: Optional[str] = None,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> list[dict]:
    db = await get_db()
    try:
        where: list[str] = []
        params: list = []
        safe_branch = (branch or "").strip()
        safe_channel = (channel or "").strip()
        safe_project = (project_name or "").strip()
        if status:
            where.append("status = ?")
            params.append(status)
        if safe_branch:
            where.append("COALESCE(NULLIF(branch, ''), 'main') = ?")
            params.append(safe_branch)
        if safe_channel:
            where.append("COALESCE(NULLIF(channel, ''), 'main') = ?")
            params.append(safe_channel)
        if safe_project:
            where.append("COALESCE(NULLIF(project_name, ''), 'ai-office') = ?")
            params.append(safe_project)

        sql = "SELECT * FROM tasks"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY priority DESC, updated_at DESC"
        rows = await db.execute(sql, tuple(params))
        results = await rows.fetchall()
        return [_normalize_task_row(r) for r in results]
    finally:
        await db.close()


async def update_task(task_id: int, updates: dict) -> Optional[dict]:
    allowed = {
        "title",
        "description",
        "status",
        "assigned_to",
        "channel",
        "project_name",
        "branch",
        "subtasks",
        "linked_files",
        "depends_on",
        "priority",
    }
    fields = {k: v for k, v in updates.items() if k in allowed}
    if not fields:
        return await get_task(task_id)

    params: list = []
    assignments: list[str] = []

    if "title" in fields:
        assignments.append("title = ?")
        params.append((fields["title"] or "").strip())
    if "description" in fields:
        assignments.append("description = ?")
        params.append((fields["description"] or "").strip())
    if "status" in fields:
        status = str(fields["status"]).strip().lower()
        if status not in TASK_STATUSES:
            return None
        assignments.append("status = ?")
        params.append(status)
    if "assigned_to" in fields:
        assignments.append("assigned_to = ?")
        params.append((fields["assigned_to"] or "").strip() or None)
    if "channel" in fields:
        assignments.append("channel = ?")
        params.append((fields["channel"] or "").strip() or "main")
    if "project_name" in fields:
        assignments.append("project_name = ?")
        params.append((fields["project_name"] or "").strip() or "ai-office")
    if "branch" in fields:
        next_branch = str(fields["branch"] or "").strip() or "main"
        assignments.append("branch = ?")
        params.append(next_branch)
    if "subtasks" in fields:
        assignments.append("subtasks = ?")
        params.append(_json_dumps(fields.get("subtasks"), []))
    if "linked_files" in fields:
        assignments.append("linked_files = ?")
        params.append(_json_dumps(fields.get("linked_files"), []))
    if "depends_on" in fields:
        assignments.append("depends_on = ?")
        params.append(_json_dumps(fields.get("depends_on"), []))
    if "priority" in fields:
        assignments.append("priority = ?")
        params.append(max(1, min(3, int(fields["priority"] or 2))))

    assignments.append("updated_at = CURRENT_TIMESTAMP")
    params.append(task_id)

    db = await get_db()
    try:
        cursor = await db.execute(
            f"UPDATE tasks SET {', '.join(assignments)} WHERE id = ?",
            tuple(params),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None
    finally:
        await db.close()

    return await get_task(task_id)


async def delete_task(task_id: int) -> bool:
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        await db.commit()
        return cursor.rowcount > 0
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
        existing = await db.execute(
            """SELECT branch FROM channel_branches
               WHERE channel = ? AND project_name = ?""",
            (channel, project_name),
        )
        if not await existing.fetchone():
            await db.execute(
                """INSERT INTO channel_branches (channel, project_name, branch, updated_at)
                   VALUES (?, ?, 'main', CURRENT_TIMESTAMP)
                   ON CONFLICT(channel, project_name) DO NOTHING""",
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


async def get_channel_active_branch(channel: str, project_name: str) -> str:
    db = await get_db()
    try:
        row = await db.execute(
            """SELECT branch FROM channel_branches
               WHERE channel = ? AND project_name = ?""",
            (channel, project_name),
        )
        result = await row.fetchone()
        if not result:
            return "main"
        value = str(result["branch"] or "").strip()
        return value or "main"
    finally:
        await db.close()


async def set_channel_active_branch(channel: str, project_name: str, branch: str) -> str:
    normalized = (branch or "").strip() or "main"
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO channel_branches (channel, project_name, branch, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(channel, project_name) DO UPDATE SET
                 branch = excluded.branch,
                 updated_at = CURRENT_TIMESTAMP""",
            (channel, project_name, normalized),
        )
        await db.commit()
        return normalized
    finally:
        await db.close()


async def list_project_branches_state(project_name: str) -> list[dict]:
    db = await get_db()
    try:
        rows = await db.execute(
            """SELECT channel, project_name, branch, updated_at
               FROM channel_branches
               WHERE project_name = ?
               ORDER BY updated_at DESC, channel ASC""",
            (project_name,),
        )
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


SPEC_STATUSES = {"none", "draft", "approved"}


def _normalize_spec_status(value: Optional[str]) -> str:
    text = str(value or "none").strip().lower()
    if text not in SPEC_STATUSES:
        return "none"
    return text


async def get_spec_state(channel: str, project_name: str) -> dict:
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "ai-office").strip() or "ai-office"
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT * FROM spec_states WHERE channel = ? AND project_name = ?",
            (channel_id, project),
        )
        result = await row.fetchone()
        if not result:
            return {
                "channel": channel_id,
                "project_name": project,
                "status": "none",
                "spec_version": None,
                "updated_at": None,
            }
        data = dict(result)
        data["status"] = _normalize_spec_status(data.get("status"))
        return data
    finally:
        await db.close()


async def set_spec_state(
    channel: str,
    project_name: str,
    *,
    status: str,
    spec_version: Optional[str] = None,
) -> dict:
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "ai-office").strip() or "ai-office"
    normalized = _normalize_spec_status(status)
    version = (spec_version or "").strip() or None

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO spec_states (channel, project_name, status, spec_version, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(channel, project_name) DO UPDATE SET
                 status = excluded.status,
                 spec_version = COALESCE(excluded.spec_version, spec_states.spec_version),
                 updated_at = CURRENT_TIMESTAMP""",
            (channel_id, project, normalized, version),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_spec_state(channel_id, project)


async def get_tasks_for_agent(
    agent_id: str,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> list[dict]:
    db = await get_db()
    try:
        safe_branch = (branch or "").strip()
        safe_channel = (channel or "").strip()
        safe_project = (project_name or "").strip()
        where = ["assigned_to = ?", "status != 'done'"]
        params: list = [agent_id]
        if safe_branch:
            where.append("COALESCE(NULLIF(branch, ''), 'main') = ?")
            params.append(safe_branch)
        if safe_channel:
            where.append("COALESCE(NULLIF(channel, ''), 'main') = ?")
            params.append(safe_channel)
        if safe_project:
            where.append("COALESCE(NULLIF(project_name, ''), 'ai-office') = ?")
            params.append(safe_project)
        rows = await db.execute(
            f"""SELECT * FROM tasks
                WHERE {' AND '.join(where)}
                ORDER BY priority DESC, updated_at DESC""",
            tuple(params),
        )
        return [_normalize_task_row(r) for r in await rows.fetchall()]
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
        return _normalize_task_row(result) if result else None
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


async def get_project_autonomy_mode(project_name: str) -> str:
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT mode FROM project_autonomy_modes WHERE project_name = ?",
            (project_name,),
        )
        result = await row.fetchone()
        if not result:
            return "SAFE"
        mode = str(result["mode"] or "SAFE").strip().upper()
        return mode if mode in VALID_AUTONOMY_MODES else "SAFE"
    finally:
        await db.close()


async def set_project_autonomy_mode(project_name: str, mode: str) -> str:
    normalized = str(mode or "SAFE").strip().upper()
    if normalized not in VALID_AUTONOMY_MODES:
        raise ValueError(f"Invalid autonomy mode: {mode}")

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO project_autonomy_modes (project_name, mode, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(project_name) DO UPDATE SET
                 mode = excluded.mode,
                 updated_at = CURRENT_TIMESTAMP""",
            (project_name, normalized),
        )
        await db.commit()
        return normalized
    finally:
        await db.close()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _normalize_permission_scopes(scopes: Optional[list[str] | str]) -> list[str]:
    if scopes is None:
        return list(DEFAULT_PERMISSION_SCOPES)
    if isinstance(scopes, str):
        text = scopes.strip()
        if not text:
            return list(DEFAULT_PERMISSION_SCOPES)
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                scopes = parsed
            else:
                scopes = [part.strip() for part in text.split(",") if part.strip()]
        except Exception:
            scopes = [part.strip() for part in text.split(",") if part.strip()]
    unique = []
    seen = set()
    for item in scopes or []:
        token = str(item or "").strip().lower()
        if not token or token in seen:
            continue
        seen.add(token)
        unique.append(token)
    return unique or list(DEFAULT_PERMISSION_SCOPES)


def _normalize_permission_mode(mode: Optional[str]) -> str:
    normalized = (mode or "ask").strip().lower()
    if normalized == "auto":
        normalized = "trusted"
    if normalized not in VALID_PERMISSION_MODES:
        return "ask"
    return normalized


def _permission_ui_mode(mode: str) -> str:
    normalized = _normalize_permission_mode(mode)
    if normalized == "locked":
        return "LOCKED"
    if normalized == "trusted":
        return "AUTO"
    return "ASK"


async def list_permission_grants(
    channel: str,
    *,
    project_name: Optional[str] = None,
    include_expired: bool = False,
) -> list[dict]:
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "").strip()
    now = _utc_now()
    db = await get_db()
    try:
        rows = await db.execute(
            "SELECT * FROM permission_grants WHERE channel = ? ORDER BY id DESC",
            (channel_id,),
        )
        result = []
        expired_ids: list[int] = []
        for row in await rows.fetchall():
            item = dict(row)
            expires = _parse_iso(item.get("expires_at"))
            if expires and expires <= now:
                expired_ids.append(int(item.get("id")))
                if not include_expired:
                    continue
            grant_project = (item.get("project_name") or "").strip()
            if project and grant_project and grant_project != project:
                continue
            result.append(item)

        if expired_ids:
            placeholders = ",".join("?" for _ in expired_ids)
            await db.execute(f"DELETE FROM permission_grants WHERE id IN ({placeholders})", tuple(expired_ids))
            await db.commit()
        return result
    finally:
        await db.close()


async def grant_permission_scope(
    *,
    channel: str,
    scope: str,
    grant_level: str = "chat",
    minutes: int = 10,
    project_name: Optional[str] = None,
    source_request_id: Optional[str] = None,
    created_by: str = "user",
) -> dict:
    channel_id = (channel or "main").strip() or "main"
    grant_scope = (scope or "").strip().lower()
    if not grant_scope:
        raise ValueError("scope is required")
    level = (grant_level or "chat").strip().lower()
    if level not in {"once", "chat", "project"}:
        raise ValueError("grant_level must be one of: once, chat, project")
    ttl_minutes = max(1, min(int(minutes or 10), 24 * 60))
    expires_at = None
    if level in {"once", "chat"}:
        expires_at = (_utc_now() + timedelta(minutes=ttl_minutes)).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO permission_grants (
                   channel, project_name, scope, grant_level, source_request_id, expires_at, created_by
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                channel_id,
                (project_name or "").strip() or None,
                grant_scope,
                level,
                (source_request_id or "").strip() or None,
                expires_at,
                (created_by or "user").strip() or "user",
            ),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM permission_grants WHERE id = ?", (cursor.lastrowid,))
        result = await row.fetchone()
        return dict(result) if result else {}
    finally:
        await db.close()


async def revoke_permission_grant(
    *,
    channel: str,
    grant_id: Optional[int] = None,
    scope: Optional[str] = None,
    project_name: Optional[str] = None,
) -> int:
    channel_id = (channel or "main").strip() or "main"
    db = await get_db()
    try:
        if grant_id:
            cursor = await db.execute(
                "DELETE FROM permission_grants WHERE id = ? AND channel = ?",
                (int(grant_id), channel_id),
            )
            await db.commit()
            return int(cursor.rowcount or 0)

        where = ["channel = ?"]
        params: list = [channel_id]
        if scope:
            where.append("scope = ?")
            params.append((scope or "").strip().lower())
        if project_name:
            where.append("COALESCE(project_name, '') = ?")
            params.append((project_name or "").strip())
        cursor = await db.execute(f"DELETE FROM permission_grants WHERE {' AND '.join(where)}", tuple(params))
        await db.commit()
        return int(cursor.rowcount or 0)
    finally:
        await db.close()


def _merge_scopes_with_grants(scopes: list[str], grants: list[dict]) -> list[str]:
    merged = list(scopes or [])
    seen = {item.strip().lower() for item in merged if str(item).strip()}
    for item in grants:
        token = str(item.get("scope") or "").strip().lower()
        if not token or token in seen:
            continue
        seen.add(token)
        merged.append(token)
    return merged


async def get_permission_policy(channel: str) -> dict:
    channel_id = (channel or "main").strip() or "main"
    db = await get_db()
    try:
        row = await db.execute(
            "SELECT * FROM permission_policies WHERE channel = ?",
            (channel_id,),
        )
        item = await row.fetchone()
        if not item:
            base_policy = {
                "channel": channel_id,
                "mode": "ask",
                "expires_at": None,
                "scopes": list(DEFAULT_PERMISSION_SCOPES),
                "command_allowlist_profile": "safe",
            }
            grants = await list_permission_grants(channel_id)
            base_policy["active_grants"] = grants
            base_policy["scopes"] = _merge_scopes_with_grants(base_policy["scopes"], grants)
            base_policy["ui_mode"] = _permission_ui_mode(base_policy["mode"])
            return base_policy

        policy = dict(item)
        policy["mode"] = _normalize_permission_mode(policy.get("mode"))
        policy["scopes"] = _normalize_permission_scopes(policy.get("scopes"))
        policy["command_allowlist_profile"] = (policy.get("command_allowlist_profile") or "safe").strip().lower()

        expires_at = _parse_iso(policy.get("expires_at"))
        if policy["mode"] == "trusted" and expires_at and expires_at <= _utc_now():
            await db.execute(
                """UPDATE permission_policies
                   SET mode = 'ask', expires_at = NULL, updated_at = CURRENT_TIMESTAMP
                   WHERE channel = ?""",
                (channel_id,),
            )
            await db.commit()
            policy["mode"] = "ask"
            policy["expires_at"] = None
        grants = await list_permission_grants(channel_id)
        policy["active_grants"] = grants
        policy["scopes"] = _merge_scopes_with_grants(policy["scopes"], grants)
        policy["ui_mode"] = _permission_ui_mode(policy["mode"])
        return policy
    finally:
        await db.close()


async def set_permission_policy(
    channel: str,
    *,
    mode: str,
    expires_at: Optional[str] = None,
    scopes: Optional[list[str] | str] = None,
    command_allowlist_profile: str = "safe",
) -> dict:
    channel_id = (channel or "main").strip() or "main"
    normalized_mode = _normalize_permission_mode(mode)
    if normalized_mode not in VALID_PERMISSION_MODES:
        raise ValueError(f"Invalid permission mode: {mode}")

    normalized_scopes = _normalize_permission_scopes(scopes)
    profile = (command_allowlist_profile or "safe").strip().lower() or "safe"
    parsed_expiry = _parse_iso(expires_at)
    expires_text = parsed_expiry.replace(microsecond=0).isoformat().replace("+00:00", "Z") if parsed_expiry else None

    if normalized_mode != "trusted":
        expires_text = None

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO permission_policies (
                   channel, mode, expires_at, scopes, command_allowlist_profile
               ) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(channel) DO UPDATE SET
                 mode = excluded.mode,
                 expires_at = excluded.expires_at,
                 scopes = excluded.scopes,
                 command_allowlist_profile = excluded.command_allowlist_profile,
                 updated_at = CURRENT_TIMESTAMP""",
            (
                channel_id,
                normalized_mode,
                expires_text,
                json.dumps(normalized_scopes),
                profile,
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_permission_policy(channel_id)


async def issue_trusted_session(
    channel: str,
    *,
    minutes: int = 30,
    scopes: Optional[list[str] | str] = None,
    command_allowlist_profile: str = "safe",
) -> dict:
    safe_minutes = max(1, min(int(minutes or 30), 24 * 60))
    expires_at = (_utc_now() + timedelta(minutes=safe_minutes)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    trusted_scopes = scopes or ["read", "search", "run", "write", "task", "pip", "git"]
    policy = await set_permission_policy(
        channel,
        mode="trusted",
        expires_at=expires_at,
        scopes=trusted_scopes,
        command_allowlist_profile=command_allowlist_profile,
    )
    policy["ttl_minutes"] = safe_minutes
    return policy


async def create_approval_request(
    *,
    request_id: str,
    channel: str,
    agent_id: str,
    tool_type: str,
    payload: dict,
    risk_level: str = "medium",
    task_id: Optional[str] = None,
    project_name: Optional[str] = None,
    branch: Optional[str] = None,
    expires_at: Optional[str] = None,
) -> dict:
    channel_id = (channel or "main").strip() or "main"
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO approval_requests (
                   id, channel, project_name, branch, expires_at, task_id, agent_id, tool_type, payload_json, risk_level, status
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (
                request_id,
                channel_id,
                (project_name or "").strip() or None,
                (branch or "").strip() or None,
                (expires_at or "").strip() or None,
                (task_id or "").strip() or None,
                (agent_id or "unknown").strip() or "unknown",
                (tool_type or "").strip() or "run",
                json.dumps(payload or {}),
                (risk_level or "medium").strip().lower(),
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_approval_request(request_id)


async def get_approval_request(request_id: str) -> Optional[dict]:
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM approval_requests WHERE id = ?", (request_id,))
        result = await row.fetchone()
        if not result:
            return None
        data = dict(result)
        data["payload"] = _json_loads(data.get("payload_json"), {})
        return data
    finally:
        await db.close()


async def list_pending_approval_requests(
    channel: str,
    project_name: Optional[str] = None,
    *,
    limit: int = 50,
) -> list[dict]:
    channel_id = (channel or "main").strip() or "main"
    project = (project_name or "").strip() or None
    safe_limit = max(1, min(int(limit or 50), 200))
    db = await get_db()
    try:
        if project:
            cursor = await db.execute(
                """
                SELECT *
                FROM approval_requests
                WHERE channel = ?
                  AND status = 'pending'
                  AND (project_name = ? OR project_name IS NULL)
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (channel_id, project, safe_limit),
            )
        else:
            cursor = await db.execute(
                """
                SELECT *
                FROM approval_requests
                WHERE channel = ?
                  AND status = 'pending'
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (channel_id, safe_limit),
            )
        rows = await cursor.fetchall()
        pending: list[dict] = []
        for row in rows:
            data = dict(row)
            payload = _json_loads(data.get("payload_json"), {})
            # Ensure the payload has the same shape the websocket delivers.
            payload.setdefault("id", data.get("id"))
            payload.setdefault("channel", data.get("channel"))
            payload.setdefault("agent_id", data.get("agent_id"))
            payload.setdefault("tool_type", data.get("tool_type"))
            if data.get("project_name") and not payload.get("project_name"):
                payload["project_name"] = data.get("project_name")
            if data.get("branch") and not payload.get("branch"):
                payload["branch"] = data.get("branch")
            if data.get("expires_at") and not payload.get("expires_at"):
                payload["expires_at"] = data.get("expires_at")
            payload["status"] = data.get("status")
            pending.append(payload)
        return pending
    finally:
        await db.close()


async def resolve_approval_request(
    request_id: str,
    *,
    approved: bool,
    decided_by: str = "user",
) -> Optional[dict]:
    status = "approved" if approved else "denied"
    db = await get_db()
    try:
        await db.execute(
            """UPDATE approval_requests
               SET status = ?, decided_by = ?, decided_at = ?
               WHERE id = ? AND status = 'pending'""",
            (
                status,
                (decided_by or "user").strip() or "user",
                _utc_now_iso(),
                request_id,
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_approval_request(request_id)


async def expire_approval_request(
    request_id: str,
    *,
    decided_by: str = "system",
) -> Optional[dict]:
    db = await get_db()
    try:
        await db.execute(
            """UPDATE approval_requests
               SET status = 'expired', decided_by = ?, decided_at = ?
               WHERE id = ? AND status = 'pending'""",
            (
                (decided_by or "system").strip() or "system",
                _utc_now_iso(),
                request_id,
            ),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_approval_request(request_id)


async def log_console_event(
    *,
    channel: str,
    event_type: str,
    source: str,
    message: str = "",
    project_name: Optional[str] = None,
    severity: str = "info",
    data: Optional[dict] = None,
) -> dict:
    payload = _json_dumps(data or {}, {})
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO console_events (
                   channel, project_name, event_type, source, severity, message, data
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                channel,
                project_name,
                event_type,
                source,
                (severity or "info").strip().lower(),
                (message or "")[:1000],
                payload[:12000],
            ),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM console_events WHERE id = ?", (cursor.lastrowid,))
        result = await row.fetchone()
        entry = dict(result) if result else {}
        if entry:
            entry["data"] = _json_loads(entry.get("data"), {})
        return entry
    finally:
        await db.close()


async def get_console_events(
    *,
    channel: str,
    limit: int = 200,
    event_type: Optional[str] = None,
    source: Optional[str] = None,
) -> list[dict]:
    db = await get_db()
    try:
        where = ["channel = ?"]
        params: list = [channel]
        if event_type:
            where.append("event_type = ?")
            params.append(event_type)
        if source:
            where.append("source = ?")
            params.append(source)
        safe_limit = max(1, min(int(limit), 1000))
        rows = await db.execute(
            f"""SELECT * FROM console_events
                WHERE {' AND '.join(where)}
                ORDER BY id DESC
                LIMIT ?""",
            (*params, safe_limit),
        )
        results = [dict(r) for r in await rows.fetchall()]
        for item in results:
            item["data"] = _json_loads(item.get("data"), {})
        results.reverse()
        return results
    finally:
        await db.close()


async def upsert_managed_process(
    *,
    process_id: str,
    session_id: Optional[str],
    channel: str,
    project_name: Optional[str],
    pid: Optional[int],
    command: str,
    cwd: Optional[str],
    status: str = "running",
    started_at: Optional[int] = None,
    metadata: Optional[dict] = None,
) -> dict:
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO managed_processes (
                   process_id, session_id, channel, project_name, pid, command, cwd, status,
                   started_at, metadata_json
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(process_id) DO UPDATE SET
                   session_id = excluded.session_id,
                   channel = excluded.channel,
                   project_name = excluded.project_name,
                   pid = excluded.pid,
                   command = excluded.command,
                   cwd = excluded.cwd,
                   status = excluded.status,
                   started_at = COALESCE(excluded.started_at, managed_processes.started_at),
                   metadata_json = excluded.metadata_json""",
            (
                (process_id or "").strip(),
                (session_id or "").strip() or None,
                (channel or "main").strip() or "main",
                (project_name or "").strip() or None,
                int(pid) if pid is not None else None,
                (command or "").strip(),
                (cwd or "").strip() or None,
                (status or "running").strip().lower(),
                int(started_at) if started_at is not None else None,
                _json_dumps(metadata or {}, {}),
            ),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM managed_processes WHERE process_id = ?", ((process_id or "").strip(),))
        result = await row.fetchone()
        item = dict(result) if result else {}
        if item:
            item["metadata"] = _json_loads(item.get("metadata_json"), {})
        return item
    finally:
        await db.close()


async def mark_managed_process_ended(
    *,
    process_id: str,
    status: str,
    ended_at: Optional[int] = None,
    exit_code: Optional[int] = None,
) -> None:
    db = await get_db()
    try:
        await db.execute(
            """UPDATE managed_processes
               SET status = ?, ended_at = ?, exit_code = ?
               WHERE process_id = ?""",
            (
                (status or "exited").strip().lower(),
                int(ended_at) if ended_at is not None else None,
                int(exit_code) if exit_code is not None else None,
                (process_id or "").strip(),
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def list_managed_processes(
    *,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict]:
    db = await get_db()
    try:
        where: list[str] = []
        params: list = []
        if channel:
            where.append("channel = ?")
            params.append((channel or "main").strip() or "main")
        if project_name:
            where.append("COALESCE(project_name, '') = ?")
            params.append((project_name or "").strip())
        if status:
            where.append("status = ?")
            params.append((status or "").strip().lower())

        sql = "SELECT * FROM managed_processes"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY id DESC"
        rows = await db.execute(sql, tuple(params))
        results = [dict(r) for r in await rows.fetchall()]
        for item in results:
            item["metadata"] = _json_loads(item.get("metadata_json"), {})
        return results
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
