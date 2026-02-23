"""AI Office — Database layer (SQLite via aiosqlite)."""

import aiosqlite
import json
import logging
import os
import tempfile
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import provider_models
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
    "provider_key_ref",
    "base_url",
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
TABLE_VERIFICATION_TARGET = 26

logger = logging.getLogger("ai-office.db")


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
    meta_json TEXT,
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
    provider_key_ref TEXT,
    base_url TEXT,
    permissions TEXT DEFAULT 'read',
    active INTEGER DEFAULT 1,
    color TEXT DEFAULT '#6B7280',
    emoji TEXT DEFAULT '🤖',
    system_prompt TEXT,
    user_overrides TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_credentials (
    agent_id TEXT NOT NULL,
    backend TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    base_url TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, backend)
);

CREATE TABLE IF NOT EXISTS provider_configs (
    provider TEXT PRIMARY KEY,
    key_ref TEXT,
    base_url TEXT,
    default_model TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_secrets (
    key_ref TEXT PRIMARY KEY,
    api_key_enc TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS creation_drafts (
    draft_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_metadata (
    project_name TEXT PRIMARY KEY,
    display_name TEXT,
    last_opened_at TEXT,
    preview_focus_mode INTEGER NOT NULL DEFAULT 0,
    layout_preset TEXT DEFAULT 'full-ide',
    pane_layout_json TEXT,
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


def _schema_table_statements() -> dict[str, str]:
    statements: dict[str, str] = {}
    for fragment in SCHEMA.split(";"):
        statement = fragment.strip()
        if not statement:
            continue
        match = re.match(r"CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)\s*\(", statement, flags=re.IGNORECASE)
        if not match:
            continue
        statements[match.group(1)] = statement + ";"
    return statements


SCHEMA_TABLE_STATEMENTS = _schema_table_statements()
REQUIRED_USER_TABLES = tuple(sorted(SCHEMA_TABLE_STATEMENTS.keys()))


async def _existing_tables(db: aiosqlite.Connection) -> set[str]:
    rows = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {str(row["name"]) for row in await rows.fetchall()}


async def _ensure_schema_tables(db: aiosqlite.Connection):
    existing = await _existing_tables(db)
    missing = [name for name in REQUIRED_USER_TABLES if name not in existing]
    for table_name in missing:
        statement = SCHEMA_TABLE_STATEMENTS.get(table_name)
        if not statement:
            raise RuntimeError(f"Schema fragment missing for required table: {table_name}")
        try:
            await db.execute(statement)
        except Exception as exc:
            raise RuntimeError(f"Failed creating required table '{table_name}': {exc}") from exc


async def _verify_required_tables(db: aiosqlite.Connection, *, stage: str):
    existing = await _existing_tables(db)
    missing = [name for name in REQUIRED_USER_TABLES if name not in existing]
    verified_count = len(REQUIRED_USER_TABLES) - len(missing)
    if "sqlite_sequence" in existing:
        verified_count += 1
    logger.info("Database: %s/%s tables verified (%s).", verified_count, TABLE_VERIFICATION_TARGET, stage)
    if missing:
        raise RuntimeError(f"Database table verification failed ({stage}). Missing: {', '.join(sorted(missing))}")


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
        await _ensure_schema_tables(db)
        await _verify_required_tables(db, stage="pre-migration")
        await _run_migrations(db)
        await _verify_required_tables(db, stage="post-migration")
        await _seed_agents(db)
        await _sync_agents_from_registry_db(db, force=False)
        await _seed_provider_configs(db)
        await _migrate_provider_default_models(db)
        await _migrate_codex_defaults(db)
        await _seed_channels(db)
        await db.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO NOTHING""",
            ("providers.fallback_to_ollama", "false"),
        )
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
    await _ensure_column(db, "messages", "meta_json", "TEXT")
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
    await db.execute(
        """CREATE TABLE IF NOT EXISTS project_metadata (
               project_name TEXT PRIMARY KEY,
               display_name TEXT,
               last_opened_at TEXT,
               preview_focus_mode INTEGER NOT NULL DEFAULT 0,
               layout_preset TEXT DEFAULT 'full-ide',
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS provider_configs (
               provider TEXT PRIMARY KEY,
               key_ref TEXT,
               base_url TEXT,
               default_model TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS provider_secrets (
               key_ref TEXT PRIMARY KEY,
               api_key_enc TEXT NOT NULL,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS creation_drafts (
               draft_id TEXT PRIMARY KEY,
               payload_json TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    await _ensure_column(db, "agents", "provider_key_ref", "TEXT")
    await _ensure_column(db, "agents", "base_url", "TEXT")
    await _ensure_column(db, "agents", "user_overrides", "TEXT DEFAULT '{}'")
    await _ensure_column(db, "project_metadata", "display_name", "TEXT")
    await _ensure_column(db, "project_metadata", "last_opened_at", "TEXT")
    await _ensure_column(db, "project_metadata", "preview_focus_mode", "INTEGER NOT NULL DEFAULT 0")
    await _ensure_column(db, "project_metadata", "layout_preset", "TEXT DEFAULT 'full-ide'")
    await _ensure_column(db, "project_metadata", "pane_layout_json", "TEXT")

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


def _normalize_message_row(row: dict) -> dict:
    data = dict(row)
    data["meta"] = _json_loads(data.get("meta_json"), {})
    return data


async def _ensure_column(db: aiosqlite.Connection, table: str, column: str, column_def: str):
    rows = await db.execute(f"PRAGMA table_info({table})")
    cols = {row["name"] for row in await rows.fetchall()}
    if column not in cols:
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def}")


REGISTRY_SYNC_FIELDS = (
    "display_name",
    "role",
    "backend",
    "model",
    "permissions",
    "active",
    "color",
    "emoji",
    "system_prompt",
    "provider_key_ref",
    "base_url",
)


def _parse_overrides(value: Optional[str]) -> dict[str, bool]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, bool] = {}
    for key, raw in parsed.items():
        if isinstance(key, str) and raw:
            out[key] = True
    return out


def _registry_agent_fields(agent: dict) -> dict:
    backend = (agent.get("backend") or "ollama").strip().lower() or "ollama"
    provider_key_ref = (agent.get("provider_key_ref") or "").strip() or None
    if not provider_key_ref and agent.get("id") == "codex" and backend == "openai":
        provider_key_ref = "openai_default"
    return {
        "display_name": agent.get("display_name", "Agent"),
        "role": agent.get("role", "Assistant"),
        "backend": backend,
        "model": (agent.get("model") or "").strip(),
        "permissions": agent.get("permissions", "read"),
        "active": 1 if agent.get("active", True) else 0,
        "color": agent.get("color", "#6B7280"),
        "emoji": agent.get("emoji", "🤖"),
        "system_prompt": agent.get("system_prompt", ""),
        "provider_key_ref": provider_key_ref,
        "base_url": (agent.get("base_url") or "").strip() or None,
    }


def _load_registry_agents() -> list[dict]:
    registry_path = APP_ROOT / "agents" / "registry.json"
    if not registry_path.exists():
        return []
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    agents = data.get("agents", [])
    return agents if isinstance(agents, list) else []


async def _sync_agents_from_registry_db(db: aiosqlite.Connection, *, force: bool = False) -> dict:
    agents = _load_registry_agents()
    changed: list[dict] = []
    inserted: list[str] = []

    if not any(a.get("id") == "codex" for a in agents):
        agents.append(
            {
                "id": "codex",
                "display_name": "Codex",
                "role": "Implementation Overseer",
                "backend": "openai",
                "model": "gpt-5.2-codex",
                "permissions": "read,run,write",
                "active": True,
                "color": "#0EA5E9",
                "emoji": "C",
                "system_prompt": (
                    "You are Codex, a senior implementation teammate. "
                    "Help with coding, debugging, architecture sanity checks, and technical execution. "
                    "Give concise, direct guidance and call out risks early."
                ),
            }
        )

    for raw_agent in agents:
        agent_id = (raw_agent.get("id") or "").strip()
        if not agent_id:
            continue
        fields = _registry_agent_fields(raw_agent)
        row = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        existing = await row.fetchone()
        if not existing:
            await db.execute(
                """INSERT INTO agents (
                       id, display_name, role, skills, backend, model, provider_key_ref, base_url,
                       permissions, active, color, emoji, system_prompt, user_overrides
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    agent_id,
                    fields["display_name"],
                    fields["role"],
                    json.dumps(raw_agent.get("skills", [])),
                    fields["backend"],
                    fields["model"],
                    fields["provider_key_ref"],
                    fields["base_url"],
                    fields["permissions"],
                    fields["active"],
                    fields["color"],
                    fields["emoji"],
                    fields["system_prompt"],
                    "{}",
                ),
            )
            inserted.append(agent_id)
            continue

        overrides = _parse_overrides(existing["user_overrides"])
        updates: dict[str, object] = {}
        for field in REGISTRY_SYNC_FIELDS:
            if not force and overrides.get(field):
                continue
            desired = fields.get(field)
            current = existing[field]
            if field == "active":
                desired = 1 if desired else 0
                current = 1 if current else 0
            if current != desired:
                updates[field] = desired
        if updates:
            assignments = ", ".join(f"{field} = ?" for field in updates.keys())
            params = list(updates.values()) + [agent_id]
            await db.execute(f"UPDATE agents SET {assignments} WHERE id = ?", tuple(params))
            changed.append(
                {
                    "id": agent_id,
                    "updated_fields": sorted(updates.keys()),
                }
            )

    return {"changed": changed, "inserted": inserted}


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
            "model": "gpt-5.2-codex",
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
               provider_key_ref, base_url, permissions, active, color, emoji, system_prompt, user_overrides)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                agent["id"],
                agent["display_name"],
                agent["role"],
                json.dumps(agent.get("skills", [])),
                agent.get("backend", "ollama"),
                agent["model"],
                (
                    agent.get("provider_key_ref")
                    or ("openai_default" if agent.get("id") == "codex" and agent.get("backend") == "openai" else None)
                ),
                (agent.get("base_url") or "").strip() or None,
                agent.get("permissions", "read"),
                1 if agent.get("active", True) else 0,
                agent.get("color", "#6B7280"),
                agent.get("emoji", "🤖"),
                agent.get("system_prompt", ""),
                "{}",
            ),
        )


async def _migrate_codex_defaults(db: aiosqlite.Connection):
    """One-time codex migration to OpenAI defaults for legacy installs."""
    row = await db.execute(
        "SELECT id, backend, model, provider_key_ref, user_overrides FROM agents WHERE id = ?",
        ("codex",),
    )
    item = await row.fetchone()
    if not item:
        return

    backend = (item["backend"] or "").strip().lower()
    model = (item["model"] or "").strip()
    key_ref = (item["provider_key_ref"] or "").strip()
    overrides = _parse_overrides(item["user_overrides"] if "user_overrides" in item.keys() else None)

    if overrides.get("backend") or overrides.get("model"):
        return

    # Codex must not silently route to Ollama on startup, but only migrate known legacy defaults.
    legacy_models = {"qwen2.5:14b", "qwen2.5:32b", "qwen2.5:7b", "qwen3:14b", "qwen3:32b"}
    if backend == "ollama" and (not model or model in legacy_models):
        await db.execute(
            """UPDATE agents
               SET backend = ?, model = ?, provider_key_ref = COALESCE(NULLIF(provider_key_ref, ''), ?)
               WHERE id = ?""",
            ("openai", "gpt-5.2-codex", "openai_default", "codex"),
        )
        return

    # Keep OpenAI codex discoverable with a default key ref when unset.
    if backend == "openai" and not key_ref:
        await db.execute(
            "UPDATE agents SET provider_key_ref = ? WHERE id = ?",
            ("openai_default", "codex"),
        )

    # Upgrade old codex OpenAI default model if user has not overridden model.
    if backend == "openai" and model == "gpt-4o-mini" and not overrides.get("model"):
        await db.execute(
            "UPDATE agents SET model = ? WHERE id = ?",
            ("gpt-5.2-codex", "codex"),
        )


async def _seed_provider_configs(db: aiosqlite.Connection):
    defaults = [
        ("openai", "openai_default", None, provider_models.default_model_for_provider("openai")),
        ("claude", "claude_default", None, provider_models.default_model_for_provider("claude")),
        ("ollama", None, None, provider_models.default_model_for_provider("ollama")),
    ]
    for provider, key_ref, base_url, default_model in defaults:
        await db.execute(
            """INSERT INTO provider_configs (provider, key_ref, base_url, default_model, created_at, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(provider) DO NOTHING""",
            (provider, key_ref, base_url, default_model),
        )


async def _migrate_provider_default_models(db: aiosqlite.Connection):
    """Upgrade known legacy provider defaults without clobbering explicit custom models."""
    openai_default = provider_models.default_model_for_provider("openai") or "gpt-5.2"
    claude_default = provider_models.default_model_for_provider("claude") or "claude-opus-4-6"
    await db.execute(
        """
        UPDATE provider_configs
           SET default_model = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE provider = 'openai'
           AND (default_model IS NULL OR TRIM(default_model) = '' OR default_model = 'gpt-4o-mini')
        """,
        (openai_default,),
    )
    await db.execute(
        """
        UPDATE provider_configs
           SET default_model = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE provider = 'claude'
           AND (
                default_model IS NULL
                OR TRIM(default_model) = ''
                OR default_model = 'claude-sonnet-4-20250514'
                OR default_model = 'claude-sonnet-4-6'
           )
        """,
        (claude_default,),
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


async def get_channel_activity(limit: int = 200) -> list[dict]:
    safe_limit = max(1, min(int(limit or 200), 1000))
    db = await get_db()
    try:
        rows = await db.execute(
            """
            SELECT
              m.channel AS channel_id,
              m.id AS latest_message_id,
              m.created_at AS latest_message_ts,
              m.sender AS latest_sender,
              SUBSTR(
                REPLACE(REPLACE(COALESCE(m.content, ''), X'0D', ' '), X'0A', ' '),
                1,
                180
              ) AS latest_preview
            FROM messages m
            JOIN (
              SELECT channel, MAX(id) AS latest_id
              FROM messages
              GROUP BY channel
            ) latest
              ON latest.channel = m.channel
             AND latest.latest_id = m.id
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()


async def get_dashboard_summary(limit_recent: int = 8) -> dict:
    safe_recent = max(1, min(int(limit_recent or 8), 50))
    db = await get_db()
    try:
        channels_row = await db.execute("SELECT COUNT(*) AS c FROM channels")
        channels_count = int((await channels_row.fetchone())["c"] or 0)

        agents_row = await db.execute("SELECT COUNT(*) AS c FROM agents WHERE active = 1")
        agents_count = int((await agents_row.fetchone())["c"] or 0)

        task_rows = await db.execute(
            """
            SELECT LOWER(COALESCE(status, 'backlog')) AS status, COUNT(*) AS c
            FROM tasks
            WHERE LOWER(COALESCE(status, '')) != 'done'
            GROUP BY LOWER(COALESCE(status, 'backlog'))
            """
        )
        status_counts = {"backlog": 0, "in_progress": 0, "review": 0, "blocked": 0}
        tasks_open_count = 0
        for row in await task_rows.fetchall():
            status = (row["status"] or "backlog").strip().lower()
            count = int(row["c"] or 0)
            tasks_open_count += count
            if status in status_counts:
                status_counts[status] = count

        decisions_row = await db.execute("SELECT COUNT(*) AS c FROM decisions")
        decisions_count = int((await decisions_row.fetchone())["c"] or 0)

        activity_rows = await db.execute(
            """
            SELECT
              m.channel AS channel_id,
              m.id AS latest_message_id,
              m.created_at AS latest_message_ts,
              m.sender AS latest_sender,
              SUBSTR(
                REPLACE(REPLACE(COALESCE(m.content, ''), X'0D', ' '), X'0A', ' '),
                1,
                180
              ) AS latest_preview
            FROM messages m
            JOIN (
              SELECT channel, MAX(id) AS latest_id
              FROM messages
              GROUP BY channel
            ) latest
              ON latest.channel = m.channel
             AND latest.latest_id = m.id
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (safe_recent,),
        )
        recent_activity = [dict(r) for r in await activity_rows.fetchall()]

        provider_rows = await db.execute(
            """
            SELECT
              pc.provider,
              pc.default_model,
              pc.key_ref,
              CASE WHEN ps.key_ref IS NULL THEN 0 ELSE 1 END AS has_secret
            FROM provider_configs pc
            LEFT JOIN provider_secrets ps ON ps.key_ref = pc.key_ref
            WHERE pc.provider IN ('openai', 'claude', 'ollama')
            """
        )
        provider_status_summary: dict[str, dict] = {}
        for row in await provider_rows.fetchall():
            provider = (row["provider"] or "").strip().lower()
            if not provider:
                continue
            provider_status_summary[provider] = {
                "configured": bool(row["has_secret"]) or provider == "ollama",
                "default_model": row["default_model"],
                "key_ref": row["key_ref"],
            }
    finally:
        await db.close()

    return {
        "channels_count": channels_count,
        "agents_count": agents_count,
        "tasks_open_count": tasks_open_count,
        "task_status_counts": status_counts,
        "decisions_count": decisions_count,
        "provider_status_summary": provider_status_summary,
        "recent_activity": recent_activity,
    }


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

async def insert_message(
    channel: str,
    sender: str,
    content: str,
    msg_type: str = "message",
    parent_id: Optional[int] = None,
    meta: Optional[dict] = None,
) -> dict:
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO messages (channel, sender, content, msg_type, parent_id, meta_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (channel, sender, content, msg_type, parent_id, _json_dumps(meta or {}, {})),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,))
        msg = await row.fetchone()
        return _normalize_message_row(dict(msg))
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
        results = [_normalize_message_row(dict(r)) for r in await rows.fetchall()]
        results.reverse()
        return results
    finally:
        await db.close()


async def get_message_by_id(message_id: int) -> Optional[dict]:
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        result = await row.fetchone()
        return _normalize_message_row(dict(result)) if result else None
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


async def clear_tasks_for_project(project_name: str) -> int:
    """Delete all tasks for a specific project across channels."""
    project = (project_name or "").strip()
    if not project:
        return 0
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM tasks WHERE project_name = ?", (project,))
        await db.commit()
        return int(cursor.rowcount or 0)
    finally:
        await db.close()


async def clear_all_tasks() -> int:
    """Delete all tasks across all channels and projects."""
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM tasks")
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


async def reset_runtime_state() -> dict:
    """Clear runtime artifacts while preserving agents/providers/settings."""
    runtime_tables = (
        "messages",
        "message_reactions",
        "tasks",
        "decisions",
        "tool_logs",
        "build_results",
        "approval_requests",
        "managed_processes",
        "console_events",
        "creation_drafts",
        "channel_names",
        "channel_projects",
        "channel_branches",
    )
    deleted: dict[str, int] = {}
    db = await get_db()
    try:
        table_rows = await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        existing = {str(row["name"]) for row in await table_rows.fetchall()}

        for table in runtime_tables:
            if table not in existing:
                continue
            cursor = await db.execute(f"DELETE FROM {table}")
            deleted[table] = int(cursor.rowcount or 0)

        if "channels" in existing:
            channel_cursor = await db.execute("DELETE FROM channels WHERE id != ?", ("main",))
            deleted["channels"] = int(channel_cursor.rowcount or 0)

        # Ensure the main channel always exists after reset.
        await _seed_channels(db)
        await db.commit()
        return {"ok": True, "deleted": deleted}
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


async def update_agent(agent_id: str, updates: dict, *, mark_override: bool = True) -> Optional[dict]:
    filtered = {k: v for k, v in updates.items() if k in ALLOWED_AGENT_UPDATE_FIELDS}
    db = await get_db()
    try:
        row = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        existing = await row.fetchone()
        if not existing:
            return None

        if not filtered:
            return dict(existing)

        if "active" in filtered:
            filtered["active"] = 1 if filtered["active"] else 0

        if mark_override:
            overrides = _parse_overrides(existing["user_overrides"] if "user_overrides" in existing.keys() else None)
            for field, value in filtered.items():
                current = existing[field]
                if field == "active":
                    current = 1 if current else 0
                if current != value:
                    overrides[field] = True
            filtered["user_overrides"] = json.dumps(overrides)

        assignments = ", ".join(f"{field} = ?" for field in filtered.keys())
        params = list(filtered.values()) + [agent_id]
        cursor = await db.execute(
            f"UPDATE agents SET {assignments} WHERE id = ?",
            tuple(params),
        )
        await db.commit()
        if cursor.rowcount == 0:
            return None

        row = await db.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        result = await row.fetchone()
        return dict(result) if result else None
    finally:
        await db.close()


async def sync_agents_from_registry(*, force: bool = False) -> dict:
    db = await get_db()
    try:
        result = await _sync_agents_from_registry_db(db, force=force)
        await db.commit()
        return {
            "ok": True,
            "force": bool(force),
            "changed_count": len(result.get("changed", [])),
            "inserted_count": len(result.get("inserted", [])),
            "changed": result.get("changed", []),
            "inserted": result.get("inserted", []),
        }
    finally:
        await db.close()


def _normalize_credential_backend(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _normalize_provider_name(value: Optional[str]) -> str:
    return provider_models.normalize_provider(value)


async def upsert_agent_credential(
    agent_id: str,
    backend: str,
    api_key: str,
    base_url: Optional[str] = None,
) -> dict:
    backend = _normalize_credential_backend(backend)
    if backend not in {"openai", "claude"}:
        raise ValueError("backend must be one of: openai, claude")
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("api_key is required")

    from .secrets_vault import encrypt_secret

    enc = encrypt_secret(api_key)
    base_url = (base_url or "").strip() or None

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO agent_credentials (agent_id, backend, api_key_enc, base_url, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(agent_id, backend)
               DO UPDATE SET api_key_enc=excluded.api_key_enc,
                             base_url=excluded.base_url,
                             updated_at=CURRENT_TIMESTAMP""",
            (agent_id, backend, enc, base_url),
        )
        await db.commit()
    finally:
        await db.close()

    return await get_agent_credential_meta(agent_id, backend)


async def get_agent_credential_meta(agent_id: str, backend: str) -> dict:
    backend = _normalize_credential_backend(backend)
    if backend not in {"openai", "claude"}:
        raise ValueError("backend must be one of: openai, claude")

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT api_key_enc, base_url, updated_at FROM agent_credentials WHERE agent_id = ? AND backend = ?",
            (agent_id, backend),
        )
        result = await row.fetchone()
    finally:
        await db.close()

    if not result:
        return {
            "agent_id": agent_id,
            "backend": backend,
            "has_key": False,
            "last4": None,
            "base_url": None,
            "updated_at": None,
        }

    enc = (result["api_key_enc"] or "").strip()
    last4 = None
    if enc:
        try:
            from .secrets_vault import decrypt_secret

            raw = decrypt_secret(enc)
            raw = (raw or "").strip()
            if raw:
                last4 = raw[-4:] if len(raw) >= 4 else raw
        except Exception:
            last4 = None

    return {
        "agent_id": agent_id,
        "backend": backend,
        "has_key": bool(enc),
        "last4": last4,
        "base_url": (result["base_url"] or "").strip() or None,
        "updated_at": result["updated_at"],
    }


async def get_agent_api_key(agent_id: str, backend: str) -> str:
    """Internal use only: returns decrypted key or empty string."""
    backend = _normalize_credential_backend(backend)
    if backend not in {"openai", "claude"}:
        return ""

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT api_key_enc FROM agent_credentials WHERE agent_id = ? AND backend = ?",
            (agent_id, backend),
        )
        result = await row.fetchone()
    finally:
        await db.close()

    enc = (result["api_key_enc"] or "").strip() if result else ""
    if not enc:
        return ""

    try:
        from .secrets_vault import decrypt_secret

        return (decrypt_secret(enc) or "").strip()
    except Exception:
        return ""


async def clear_agent_credential(agent_id: str, backend: str) -> bool:
    backend = _normalize_credential_backend(backend)
    if backend not in {"openai", "claude"}:
        raise ValueError("backend must be one of: openai, claude")

    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM agent_credentials WHERE agent_id = ? AND backend = ?",
            (agent_id, backend),
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def has_any_backend_key(backend: str) -> bool:
    backend = _normalize_provider_name(backend)
    if backend not in {"openai", "claude"}:
        return False

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT 1 AS ok FROM agent_credentials WHERE backend = ? LIMIT 1",
            (backend,),
        )
        if await row.fetchone():
            return True
        cfg = await db.execute(
            "SELECT key_ref FROM provider_configs WHERE provider = ?",
            (backend,),
        )
        cfg_row = await cfg.fetchone()
        if not cfg_row:
            return False
        key_ref = (cfg_row["key_ref"] or "").strip()
        if not key_ref:
            return False
        secret = await db.execute(
            "SELECT 1 AS ok FROM provider_secrets WHERE key_ref = ? LIMIT 1",
            (key_ref,),
        )
        return bool(await secret.fetchone())
    finally:
        await db.close()


async def upsert_provider_secret(key_ref: str, api_key: str) -> dict:
    ref = (key_ref or "").strip()
    if not ref:
        raise ValueError("key_ref is required")
    api_key = (api_key or "").strip()
    if not api_key:
        raise ValueError("api_key is required")

    from .secrets_vault import encrypt_secret

    enc = encrypt_secret(api_key)
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO provider_secrets (key_ref, api_key_enc, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key_ref) DO UPDATE SET
                 api_key_enc = excluded.api_key_enc,
                 updated_at = CURRENT_TIMESTAMP""",
            (ref, enc),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_provider_secret_meta(ref)


async def get_provider_secret(key_ref: Optional[str]) -> str:
    ref = (key_ref or "").strip()
    if not ref:
        return ""

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT api_key_enc FROM provider_secrets WHERE key_ref = ?",
            (ref,),
        )
        result = await row.fetchone()
    finally:
        await db.close()

    enc = (result["api_key_enc"] or "").strip() if result else ""
    if not enc:
        return ""
    try:
        from .secrets_vault import decrypt_secret

        return (decrypt_secret(enc) or "").strip()
    except Exception:
        return ""


async def get_provider_secret_meta(key_ref: Optional[str]) -> dict:
    ref = (key_ref or "").strip()
    if not ref:
        return {"key_ref": None, "has_key": False, "last4": None, "updated_at": None}

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT api_key_enc, updated_at FROM provider_secrets WHERE key_ref = ?",
            (ref,),
        )
        result = await row.fetchone()
    finally:
        await db.close()

    if not result:
        return {"key_ref": ref, "has_key": False, "last4": None, "updated_at": None}

    enc = (result["api_key_enc"] or "").strip()
    last4 = None
    if enc:
        try:
            from .secrets_vault import decrypt_secret

            raw = (decrypt_secret(enc) or "").strip()
            if raw:
                last4 = raw[-4:] if len(raw) >= 4 else raw
        except Exception:
            last4 = None
    return {
        "key_ref": ref,
        "has_key": bool(enc),
        "last4": last4,
        "updated_at": result["updated_at"],
    }


async def clear_provider_secret(key_ref: str) -> bool:
    ref = (key_ref or "").strip()
    if not ref:
        return False
    db = await get_db()
    try:
        cursor = await db.execute("DELETE FROM provider_secrets WHERE key_ref = ?", (ref,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


async def upsert_provider_config(
    provider: str,
    *,
    key_ref: Optional[str] = None,
    base_url: Optional[str] = None,
    default_model: Optional[str] = None,
) -> dict:
    provider_name = _normalize_provider_name(provider)
    if provider_name not in {"openai", "claude", "ollama"}:
        raise ValueError("provider must be one of: openai, claude, ollama")

    normalized_key_ref = (key_ref or "").strip() or None
    normalized_base_url = (base_url or "").strip() or None
    normalized_model = (default_model or "").strip() or None

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO provider_configs (provider, key_ref, base_url, default_model, created_at, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(provider) DO UPDATE SET
                 key_ref = excluded.key_ref,
                 base_url = excluded.base_url,
                 default_model = excluded.default_model,
                 updated_at = CURRENT_TIMESTAMP""",
            (provider_name, normalized_key_ref, normalized_base_url, normalized_model),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_provider_config(provider_name)


async def get_provider_config(provider: str) -> dict:
    provider_name = _normalize_provider_name(provider)
    if provider_name not in {"openai", "claude", "ollama"}:
        raise ValueError("provider must be one of: openai, claude, ollama")

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT provider, key_ref, base_url, default_model, updated_at FROM provider_configs WHERE provider = ?",
            (provider_name,),
        )
        item = await row.fetchone()
    finally:
        await db.close()

    if not item:
        fallback = {
            "provider": provider_name,
            "key_ref": f"{provider_name}_default" if provider_name in {"openai", "claude"} else None,
            "base_url": None,
            "default_model": provider_models.default_model_for_provider(provider_name),
            "updated_at": None,
        }
        return fallback
    return dict(item)


async def list_provider_configs() -> list[dict]:
    providers = ["openai", "claude", "ollama"]
    results = []
    for provider in providers:
        cfg = await get_provider_config(provider)
        secret_meta = await get_provider_secret_meta(cfg.get("key_ref"))
        results.append(
            {
                **cfg,
                "has_key": bool(secret_meta.get("has_key")),
                "last4": secret_meta.get("last4"),
                "key_updated_at": secret_meta.get("updated_at"),
            }
        )
    return results


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


def _normalize_creation_draft_id(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    cleaned = re.sub(r"[^a-z0-9-]+", "-", raw)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    cleaned = cleaned[:120].strip("-")
    return cleaned


def _normalize_creation_phase(value: Optional[str]) -> str:
    phase = (value or "DISCUSS").strip().upper()
    if phase not in {"DISCUSS", "SPEC", "READY_TO_BUILD", "BUILDING"}:
        return "DISCUSS"
    return phase


def _normalize_creation_payload(payload: Optional[dict]) -> dict:
    base = payload if isinstance(payload, dict) else {}
    seed_prompt = str(base.get("seed_prompt") or base.get("seedPrompt") or base.get("text") or "").strip()
    template_id = (str(base.get("template_id") or base.get("templateId") or "").strip() or None)
    project_name = (str(base.get("project_name") or base.get("projectName") or base.get("suggestedName") or "").strip() or None)
    stack_hint = (str(base.get("stack_hint") or base.get("stackHint") or base.get("suggestedStack") or "").strip() or None)
    brainstorm_messages = base.get("brainstorm_messages") or base.get("brainstormMessages") or []
    if not isinstance(brainstorm_messages, list):
        brainstorm_messages = []
    spec_draft = str(base.get("spec_draft") or base.get("specDraft") or base.get("specDraftMd") or "").strip()
    phase = _normalize_creation_phase(base.get("phase"))
    extra_payload = base.get("payload") if isinstance(base.get("payload"), dict) else {}
    return {
        "seed_prompt": seed_prompt,
        "template_id": template_id,
        "project_name": project_name,
        "stack_hint": stack_hint,
        "brainstorm_messages": brainstorm_messages,
        "spec_draft": spec_draft,
        "phase": phase,
        "payload": extra_payload,
    }


async def upsert_creation_draft(
    draft_id: str,
    payload: dict,
    *,
    created_at: Optional[str] = None,
) -> dict:
    normalized_id = _normalize_creation_draft_id(draft_id)
    if not normalized_id:
        raise ValueError("draft_id is required")
    normalized_payload = _normalize_creation_payload(payload)
    now_iso = _utc_now_iso()
    created_value = created_at or now_iso
    encoded = json.dumps(
        {
            "draft_id": normalized_id,
            "created_at": created_value,
            "updated_at": now_iso,
            **normalized_payload,
        }
    )

    db = await get_db()
    try:
        await db.execute(
            """
            INSERT INTO creation_drafts (draft_id, payload_json, created_at, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(draft_id) DO UPDATE SET
              payload_json = excluded.payload_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (normalized_id, encoded, created_value),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_creation_draft(normalized_id)


async def get_creation_draft(draft_id: str) -> Optional[dict]:
    normalized_id = _normalize_creation_draft_id(draft_id)
    if not normalized_id:
        return None
    db = await get_db()
    try:
        row = await db.execute("SELECT draft_id, payload_json, created_at, updated_at FROM creation_drafts WHERE draft_id = ?", (normalized_id,))
        item = await row.fetchone()
    finally:
        await db.close()
    if not item:
        return None
    data = dict(item)
    payload = _json_loads(data.get("payload_json"), {})
    normalized_payload = _normalize_creation_payload(payload)
    created_at = str(payload.get("created_at") or data.get("created_at") or _utc_now_iso())
    updated_at = str(payload.get("updated_at") or data.get("updated_at") or created_at)
    return {
        "draft_id": normalized_id,
        "created_at": created_at,
        "updated_at": updated_at,
        **normalized_payload,
    }


async def list_creation_drafts(limit: int = 25) -> list[dict]:
    size = max(1, min(int(limit or 25), 200))
    db = await get_db()
    try:
        rows = await db.execute(
            "SELECT draft_id, payload_json, created_at, updated_at FROM creation_drafts ORDER BY updated_at DESC LIMIT ?",
            (size,),
        )
        items = [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()
    results = []
    for item in items:
        payload = _json_loads(item.get("payload_json"), {})
        normalized_payload = _normalize_creation_payload(payload)
        created_at = str(payload.get("created_at") or item.get("created_at") or _utc_now_iso())
        updated_at = str(payload.get("updated_at") or item.get("updated_at") or created_at)
        results.append(
            {
                "draft_id": str(item.get("draft_id") or ""),
                "created_at": created_at,
                "updated_at": updated_at,
                **normalized_payload,
            }
        )
    return results


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


def _normalize_layout_preset(value: Optional[str]) -> str:
    preset = (value or "").strip().lower()
    if preset == "chat-preview":
        preset = "split"
    if preset not in {"split", "chat-files", "full-ide", "focus"}:
        return "split"
    return preset


DEFAULT_PANE_LAYOUTS: dict[str, list[float]] = {
    "split": [0.52, 0.48],
    "full-ide": [0.28, 0.40, 0.32],
    "chat-files": [0.45, 0.55],
    "files-preview": [0.62, 0.38],
}
PANE_MIN_RATIOS: dict[str, float] = {
    "split": 0.22,
    "full-ide": 0.16,
    "chat-files": 0.22,
    "files-preview": 0.22,
}


def _clamp_pane_ratios(values: list[float], *, expected_len: int, min_ratio: float) -> Optional[list[float]]:
    if not isinstance(values, list) or len(values) != expected_len:
        return None
    try:
        parsed = [float(v) for v in values]
    except Exception:
        return None
    if any((not isinstance(v, float) and not isinstance(v, int)) for v in parsed):
        return None
    if any(v <= 0 for v in parsed):
        return None

    total = float(sum(parsed))
    if total <= 0:
        return None
    normalized = [v / total for v in parsed]

    # Enforce minimum pane widths while preserving normalized distribution.
    n = len(normalized)
    if n * min_ratio >= 1.0:
        equal = round(1.0 / n, 6)
        fixed = [equal for _ in range(n)]
        fixed[-1] = round(1.0 - sum(fixed[:-1]), 6)
        return fixed

    floors = [min_ratio for _ in range(n)]
    remaining = 1.0 - (n * min_ratio)
    slack = [max(0.0, v - min_ratio) for v in normalized]
    slack_total = sum(slack)
    if slack_total <= 0:
        extras = [remaining / n for _ in range(n)]
    else:
        extras = [remaining * (v / slack_total) for v in slack]

    result = [round(floors[i] + extras[i], 6) for i in range(n)]
    # Guard against floating-point drift.
    drift = round(1.0 - sum(result), 6)
    result[-1] = round(result[-1] + drift, 6)
    if any(v < min_ratio for v in result):
        return None
    return result


def _normalize_pane_layout(value: Optional[dict]) -> dict[str, list[float]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, list[float]] = {}
    for preset, default_ratios in DEFAULT_PANE_LAYOUTS.items():
        if preset not in value:
            continue
        ratios = _clamp_pane_ratios(
            value.get(preset),
            expected_len=len(default_ratios),
            min_ratio=PANE_MIN_RATIOS[preset],
        )
        normalized[preset] = ratios if ratios else list(default_ratios)
    return normalized


def _load_pane_layout_json(raw: Optional[str]) -> dict[str, list[float]]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return _normalize_pane_layout(parsed)


async def upsert_project_metadata(
    project_name: str,
    *,
    display_name: Optional[str] = None,
    last_opened_at: Optional[str] = None,
    preview_focus_mode: Optional[bool] = None,
    layout_preset: Optional[str] = None,
    pane_layout: Optional[dict[str, list[float]]] = None,
) -> dict:
    project = (project_name or "").strip().lower()
    if not project:
        raise ValueError("project_name is required")

    current = await get_project_metadata(project)
    merged_display = (display_name if display_name is not None else current.get("display_name")) or None
    merged_last_opened = (last_opened_at if last_opened_at is not None else current.get("last_opened_at")) or None
    merged_preview = int(bool(preview_focus_mode if preview_focus_mode is not None else current.get("preview_focus_mode")))
    merged_layout = _normalize_layout_preset(layout_preset if layout_preset is not None else current.get("layout_preset"))
    merged_pane_layout = current.get("pane_layout") if pane_layout is None else _normalize_pane_layout(pane_layout)
    if not isinstance(merged_pane_layout, dict):
        merged_pane_layout = {}
    pane_layout_json = json.dumps(merged_pane_layout) if merged_pane_layout else None

    db = await get_db()
    try:
        await db.execute(
            """
            INSERT INTO project_metadata (project_name, display_name, last_opened_at, preview_focus_mode, layout_preset, pane_layout_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_name) DO UPDATE SET
              display_name = excluded.display_name,
              last_opened_at = excluded.last_opened_at,
              preview_focus_mode = excluded.preview_focus_mode,
              layout_preset = excluded.layout_preset,
              pane_layout_json = excluded.pane_layout_json,
              updated_at = CURRENT_TIMESTAMP
            """,
            (project, merged_display, merged_last_opened, merged_preview, merged_layout, pane_layout_json),
        )
        await db.commit()
    finally:
        await db.close()
    return await get_project_metadata(project)


async def get_project_metadata(project_name: str) -> dict:
    project = (project_name or "").strip().lower()
    if not project:
        return {
            "project_name": "",
            "display_name": None,
            "last_opened_at": None,
            "preview_focus_mode": 0,
            "layout_preset": "split",
            "pane_layout": {},
        }

    db = await get_db()
    try:
        row = await db.execute(
            "SELECT * FROM project_metadata WHERE project_name = ?",
            (project,),
        )
        item = await row.fetchone()
    finally:
        await db.close()

    if not item:
        return {
            "project_name": project,
            "display_name": None,
            "last_opened_at": None,
            "preview_focus_mode": 0,
            "layout_preset": "split",
            "pane_layout": {},
        }
    data = dict(item)
    data["preview_focus_mode"] = 1 if bool(data.get("preview_focus_mode")) else 0
    data["layout_preset"] = _normalize_layout_preset(data.get("layout_preset"))
    data["pane_layout"] = _load_pane_layout_json(data.get("pane_layout_json"))
    return data


async def list_project_metadata() -> dict[str, dict]:
    db = await get_db()
    try:
        rows = await db.execute("SELECT * FROM project_metadata")
        items = [dict(r) for r in await rows.fetchall()]
    finally:
        await db.close()

    result: dict[str, dict] = {}
    for item in items:
        name = (item.get("project_name") or "").strip().lower()
        if not name:
            continue
        item["preview_focus_mode"] = 1 if bool(item.get("preview_focus_mode")) else 0
        item["layout_preset"] = _normalize_layout_preset(item.get("layout_preset"))
        item["pane_layout"] = _load_pane_layout_json(item.get("pane_layout_json"))
        result[name] = item
    return result


async def touch_project_last_opened(project_name: str) -> dict:
    return await upsert_project_metadata(project_name, last_opened_at=_utc_now_iso())


async def set_project_ui_state(
    project_name: str,
    *,
    preview_focus_mode: bool,
    layout_preset: str,
    pane_layout: Optional[dict[str, list[float]]] = None,
) -> dict:
    return await upsert_project_metadata(
        project_name,
        preview_focus_mode=bool(preview_focus_mode),
        layout_preset=layout_preset,
        pane_layout=pane_layout,
    )
