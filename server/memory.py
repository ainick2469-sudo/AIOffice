"""Project-scoped memory with lightweight SQLite FTS indexing."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from .runtime_paths import MEMORY_DIR as RUNTIME_MEMORY_DIR

logger = logging.getLogger("ai-office.memory")

MEMORY_DIR = RUNTIME_MEMORY_DIR
PROJECTS_DIR = MEMORY_DIR / "projects"
DEFAULT_PROJECT = "ai-office"
INDEX_DB = MEMORY_DIR / "memory_index.db"


def _project_name(value: Optional[str]) -> str:
    text = (value or DEFAULT_PROJECT).strip()
    return text or DEFAULT_PROJECT


def _project_root(project_name: Optional[str]) -> Path:
    return PROJECTS_DIR / _project_name(project_name)


def _facts_file(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "facts.json"


def _decisions_file(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "decisions.json"


def _daily_dir(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "daily"


def _agents_dir(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "agents"


def _agent_file(project_name: Optional[str], agent_id: str) -> Path:
    return _agents_dir(project_name) / f"{agent_id}.jsonl"


def _ensure_dirs(project_name: Optional[str] = None) -> None:
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    root = _project_root(project_name)
    root.mkdir(parents=True, exist_ok=True)
    _daily_dir(project_name).mkdir(parents=True, exist_ok=True)
    _agents_dir(project_name).mkdir(parents=True, exist_ok=True)
    _ensure_index()


def _ensure_index() -> None:
    conn = sqlite3.connect(str(INDEX_DB))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memory_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_name TEXT NOT NULL,
                agent_id TEXT,
                type TEXT,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
            USING fts5(content, project_name, agent_id, type, timestamp)
            """
        )
        conn.commit()
    finally:
        conn.close()


def _normalize(text: str) -> str:
    return " ".join((text or "").lower().split())


def _json_load(filepath: Path, fallback):
    if not filepath.exists():
        return fallback
    try:
        data = json.loads(filepath.read_text(encoding="utf-8"))
    except Exception:
        return fallback
    return data if isinstance(data, type(fallback)) else fallback


def _json_save(filepath: Path, value) -> None:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    filepath.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def _is_duplicate(entries: list[dict], content: str) -> bool:
    norm_new = _normalize(content)
    if len(norm_new) < 10:
        return True
    for entry in entries[-120:]:
        old = _normalize(entry.get("content", ""))
        if not old:
            continue
        if old == norm_new:
            return True
        if len(old) > 20 and len(norm_new) > 20 and (old in norm_new or norm_new in old):
            return True
    return False


def _index_entry(project_name: str, agent_id: Optional[str], entry_type: str, content: str, timestamp: str) -> None:
    conn = sqlite3.connect(str(INDEX_DB))
    try:
        conn.execute(
            """INSERT INTO memory_entries (project_name, agent_id, type, content, timestamp)
               VALUES (?, ?, ?, ?, ?)""",
            (project_name, agent_id, entry_type, content, timestamp),
        )
        conn.execute(
            "INSERT INTO memory_fts (content, project_name, agent_id, type, timestamp) VALUES (?, ?, ?, ?, ?)",
            (content, project_name, agent_id or "", entry_type, timestamp),
        )
        conn.commit()
    finally:
        conn.close()


def _append_daily_note(project_name: str, entry: dict) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d")
    daily_file = _daily_dir(project_name) / f"{stamp}.md"
    line = f"- [{entry.get('timestamp')}] ({entry.get('type')}) {entry.get('content')}\n"
    with open(daily_file, "a", encoding="utf-8") as f:
        f.write(line)


def write_memory(agent_id: Optional[str], entry: dict, project_name: Optional[str] = None) -> bool:
    """Write memory entry scoped to a project. Returns True if written."""
    project = _project_name(project_name)
    _ensure_dirs(project)
    content = (entry.get("content") or "").strip()
    if len(content) < 5:
        return False

    timestamp = entry.get("timestamp") or datetime.now().isoformat()
    entry_type = (entry.get("type") or "fact").strip().lower()
    payload = dict(entry)
    payload["timestamp"] = timestamp
    payload["project"] = project
    payload["type"] = entry_type

    if agent_id:
        payload["agent"] = agent_id
        filepath = _agent_file(project, agent_id)
        existing = _json_load(filepath, [])
        if _is_duplicate(existing, content):
            return False
        existing.append(payload)
        _json_save(filepath, existing[-500:])
    else:
        filepath = _decisions_file(project) if entry_type in {"decision", "constraint", "preference"} else _facts_file(project)
        existing = _json_load(filepath, [])
        if _is_duplicate(existing, content):
            return False
        existing.append(payload)
        _json_save(filepath, existing[-1000:])

    _append_daily_note(project, payload)
    try:
        _index_entry(project, agent_id, entry_type, content, timestamp)
    except Exception:
        logger.exception("Failed to update memory FTS index")
    return True


def _filter_entries(entries: list[dict], type_filter: Optional[str]) -> list[dict]:
    if not type_filter:
        return entries
    target = type_filter.strip().lower()
    return [entry for entry in entries if (entry.get("type") or "").strip().lower() == target]


def read_memory(
    agent_id: Optional[str],
    limit: int = 50,
    type_filter: Optional[str] = None,
    project_name: Optional[str] = None,
) -> list[dict]:
    """Read project-scoped memory (agent-specific if agent_id provided)."""
    project = _project_name(project_name)
    _ensure_dirs(project)
    if agent_id:
        entries = _json_load(_agent_file(project, agent_id), [])
        entries = _filter_entries(entries, type_filter)
        return entries[-limit:]

    combined = _json_load(_facts_file(project), []) + _json_load(_decisions_file(project), [])
    combined = _filter_entries(combined, type_filter)
    combined.sort(key=lambda item: item.get("timestamp", ""))
    return combined[-limit:]


def read_all_memory_for_agent(
    agent_id: str,
    limit: int = 50,
    project_name: Optional[str] = None,
) -> list[dict]:
    """Read shared + personal project memory merged and deduped."""
    shared = read_memory(None, limit=limit, project_name=project_name)
    personal = read_memory(agent_id, limit=limit, project_name=project_name)
    seen = set()
    merged = []
    for entry in shared + personal:
        key = _normalize(entry.get("content", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    merged.sort(key=lambda item: item.get("timestamp", ""))
    return merged[-limit:]


def search_project_memory(project_name: str, query: str, limit: int = 20) -> list[dict]:
    project = _project_name(project_name)
    _ensure_dirs(project)
    query_text = (query or "").strip()
    conn = sqlite3.connect(str(INDEX_DB))
    conn.row_factory = sqlite3.Row
    try:
        if query_text:
            rows = conn.execute(
                """
                SELECT content, project_name, agent_id, type, timestamp
                FROM memory_fts
                WHERE memory_fts MATCH ? AND project_name = ?
                ORDER BY rank
                LIMIT ?
                """,
                (query_text, project, max(1, min(limit, 200))),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT content, project_name, agent_id, type, timestamp
                FROM memory_entries
                WHERE project_name = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (project, max(1, min(limit, 200))),
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        return []
    finally:
        conn.close()


def get_known_context(project_name: str, agent_id: str, query_hint: str = "", limit: int = 12) -> list[dict]:
    scoped = read_all_memory_for_agent(agent_id, limit=limit, project_name=project_name)
    searched = search_project_memory(project_name, query_hint, limit=limit // 2 if limit > 2 else limit)
    seen = set()
    merged = []
    for entry in scoped + searched:
        content = (entry.get("content") or "").strip()
        if not content:
            continue
        key = _normalize(content)
        if key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    return merged[:limit]


def cleanup_memories(agent_id: Optional[str] = None, project_name: Optional[str] = None) -> int:
    project = _project_name(project_name)
    _ensure_dirs(project)
    removed = 0
    if agent_id:
        path = _agent_file(project, agent_id)
        entries = _json_load(path, [])
        deduped = []
        seen = set()
        for entry in entries:
            key = _normalize(entry.get("content", ""))
            if not key or key in seen:
                removed += 1
                continue
            seen.add(key)
            deduped.append(entry)
        _json_save(path, deduped)
        return removed

    for path in (_facts_file(project), _decisions_file(project)):
        entries = _json_load(path, [])
        deduped = []
        seen = set()
        for entry in entries:
            key = _normalize(entry.get("content", ""))
            if not key or key in seen:
                removed += 1
                continue
            seen.add(key)
            deduped.append(entry)
        _json_save(path, deduped)
    return removed
