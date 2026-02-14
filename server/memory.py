"""AI Office — Memory system v2. Shared + per-agent persistent memory with deduplication."""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ai-office.memory")

MEMORY_DIR = Path(__file__).parent.parent / "memory"
SHARED_FILE = MEMORY_DIR / "shared_memory.jsonl"
AGENTS_DIR = MEMORY_DIR / "agents"


def _ensure_dirs():
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)


def _agent_file(agent_id: str) -> Path:
    return AGENTS_DIR / f"{agent_id}.jsonl"


def _normalize(text: str) -> str:
    """Normalize text for dedup comparison."""
    return " ".join(text.lower().split())


def _is_duplicate(filepath: Path, content: str, threshold: float = 0.85) -> bool:
    """Check if a similar memory already exists in the file."""
    if not filepath.exists():
        return False
    norm_new = _normalize(content)
    if len(norm_new) < 10:
        return True  # Too short to be useful

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                norm_old = _normalize(entry.get("content", ""))
                # Exact match
                if norm_new == norm_old:
                    return True
                # Substring match (one contains the other)
                if len(norm_new) > 20 and len(norm_old) > 20:
                    if norm_new in norm_old or norm_old in norm_new:
                        return True
                # Simple word overlap ratio
                words_new = set(norm_new.split())
                words_old = set(norm_old.split())
                if words_new and words_old:
                    overlap = len(words_new & words_old) / max(len(words_new), len(words_old))
                    if overlap >= threshold:
                        return True
            except json.JSONDecodeError:
                continue
    return False


def write_memory(agent_id: Optional[str], entry: dict) -> bool:
    """Write a memory entry with deduplication. Returns True if written, False if duplicate."""
    _ensure_dirs()
    content = entry.get("content", "")
    if not content or len(content.strip()) < 5:
        return False

    entry.setdefault("timestamp", datetime.now().isoformat())

    if agent_id:
        filepath = _agent_file(agent_id)
        entry["agent"] = agent_id
    else:
        filepath = SHARED_FILE
        entry["agent"] = "shared"

    # Dedup check
    if _is_duplicate(filepath, content):
        logger.debug(f"Duplicate memory skipped: {content[:60]}")
        return False

    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    logger.debug(f"Memory written: [{entry.get('agent')}] {entry.get('type')}: {content[:60]}")
    return True


def read_memory(agent_id: Optional[str], limit: int = 50, type_filter: Optional[str] = None) -> list[dict]:
    """Read memory entries. agent_id=None reads shared memory."""
    _ensure_dirs()
    filepath = _agent_file(agent_id) if agent_id else SHARED_FILE

    if not filepath.exists():
        return []

    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if type_filter and entry.get("type") != type_filter:
                    continue
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries[-limit:]


def read_all_memory_for_agent(agent_id: str, limit: int = 50) -> list[dict]:
    """Read both shared + agent-specific memory, merged by time, deduped."""
    shared = read_memory(None, limit=limit)
    personal = read_memory(agent_id, limit=limit)

    # Merge and deduplicate
    seen = set()
    combined = []
    for entry in shared + personal:
        key = _normalize(entry.get("content", ""))
        if key not in seen:
            seen.add(key)
            combined.append(entry)

    combined.sort(key=lambda x: x.get("timestamp", ""))
    return combined[-limit:]


def cleanup_memories(agent_id: Optional[str] = None):
    """Remove duplicate entries from a memory file."""
    _ensure_dirs()
    filepath = _agent_file(agent_id) if agent_id else SHARED_FILE
    if not filepath.exists():
        return 0

    entries = []
    seen = set()
    removed = 0

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                key = _normalize(entry.get("content", ""))
                if key in seen or len(key) < 10:
                    removed += 1
                    continue
                seen.add(key)
                entries.append(entry)
            except json.JSONDecodeError:
                removed += 1

    with open(filepath, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    if removed:
        logger.info(f"Cleaned {removed} duplicates from {filepath.name}")
    return removed
