"""AI Office — Memory system. Shared + per-agent persistent memory."""

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


# ── Memory Entry Format ────────────────────────────────────
# Each line in JSONL:
# {"type": "decision|preference|fact|todo|constraint|lore",
#  "content": "...", "source": "channel", "agent": "agent_id|shared",
#  "timestamp": "ISO", "tags": ["tag1"]}


def write_memory(agent_id: Optional[str], entry: dict):
    """Write a memory entry. agent_id=None writes to shared memory."""
    _ensure_dirs()
    entry.setdefault("timestamp", datetime.now().isoformat())

    if agent_id:
        filepath = _agent_file(agent_id)
        entry["agent"] = agent_id
    else:
        filepath = SHARED_FILE
        entry["agent"] = "shared"

    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    logger.debug(f"Memory written: [{entry.get('agent')}] {entry.get('type')}: {entry.get('content', '')[:60]}")


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


def read_all_memory_for_agent(agent_id: str, limit: int = 30) -> list[dict]:
    """Read both shared + agent-specific memory, merged by time."""
    shared = read_memory(None, limit=limit)
    personal = read_memory(agent_id, limit=limit)
    combined = shared + personal
    combined.sort(key=lambda x: x.get("timestamp", ""))
    return combined[-limit:]
