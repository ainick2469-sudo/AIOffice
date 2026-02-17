"""AI Office — Memory Distiller v2. Extracts durable facts from conversations."""

import json
import logging
import re
from typing import Optional
from . import ollama_client
from .memory import write_memory, read_memory
from .database import get_messages, get_agents
from . import project_manager

logger = logging.getLogger("ai-office.distiller")

DISTILL_MODEL = "qwen2.5:14b"

DISTILL_SYSTEM = """You extract SPECIFIC, CONCRETE facts from conversations for long-term memory.

RULES:
- Only extract things that are ACTUALLY decided, stated, or agreed upon
- Be SPECIFIC: "Use PostgreSQL for the database" NOT "the team discussed database options"
- Include WHO said/decided it when relevant
- Skip vague agreements like "great idea" or "sounds good"
- Skip greetings, small talk, and pleasantries
- If nothing concrete was decided, return an empty array []
- Maximum 5 facts per extraction

Types:
- decision: A specific choice that was made. Include WHAT was decided.
- preference: User stated they want/like/dislike something specific.
- constraint: A hard requirement or limitation identified.
- fact: A concrete piece of information (file path, tech choice, etc.)
- todo: A specific action item someone committed to doing.

BAD examples (too vague - DO NOT extract these):
- "The team agreed to work together"
- "Everyone is on track"
- "The project is going well"

GOOD examples (specific - extract these):
- "User wants the app to use dark mode by default"
- "Ada proposed a REST API with WebSocket for real-time updates"
- "Max will implement the login page using React Hook Form"
- "The project is a multiplayer word game using WebSockets"

/no_think
Respond with ONLY a JSON array:
[{"type": "decision", "content": "Specific concrete fact here"}]"""

_last_distilled = {}
DISTILL_THRESHOLD = 8  # More messages between distills = better context


def _parse_distill_response(text: str) -> list[dict]:
    """Parse the distiller's JSON output."""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [f for f in data if isinstance(f, dict) and f.get("content")]
    except json.JSONDecodeError:
        pass
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, list):
                return [f for f in data if isinstance(f, dict) and f.get("content")]
        except json.JSONDecodeError:
            pass
    return []


def _is_vague(content: str) -> bool:
    """Filter out vague, useless memories."""
    vague_patterns = [
        "team agreed to work", "everyone is on track", "going well",
        "great progress", "fantastic", "sounds good", "good idea",
        "moving forward", "on the right track", "team discussed",
        "will continue", "team is aligned",
    ]
    lower = content.lower()
    return any(p in lower for p in vague_patterns) or len(content) < 15


async def maybe_distill(channel: str):
    """Check if we should distill, and if so, extract + store memories."""
    messages = await get_messages(channel, limit=DISTILL_THRESHOLD + 5)
    if not messages:
        return

    last_id = messages[-1]["id"]
    prev_id = _last_distilled.get(channel, 0)

    new_msgs = [m for m in messages if m["id"] > prev_id]
    if len(new_msgs) < DISTILL_THRESHOLD:
        return

    logger.info(f"Distilling {len(new_msgs)} messages from #{channel}")

    convo_text = "\n".join(
        f"{m['sender']}: {m['content'][:200]}" for m in new_msgs
    )

    response = await ollama_client.generate(
        model=DISTILL_MODEL,
        prompt=f"Extract specific memories from this conversation:\n\n{convo_text}",
        system=DISTILL_SYSTEM,
        temperature=0.2,
        max_tokens=600,
    )

    facts = _parse_distill_response(response)
    if not facts:
        logger.info("Distiller found nothing worth remembering")
        _last_distilled[channel] = last_id
        return

    # Filter vague facts
    facts = [f for f in facts if not _is_vague(f.get("content", ""))]

    participating_agents = set()
    for m in new_msgs:
        if m["sender"] != "user":
            participating_agents.add(m["sender"])
    active_project = await project_manager.get_active_project(channel)
    project_name = active_project["project"]

    written = 0
    for fact in facts[:5]:  # Cap at 5
        fact["source"] = channel
        fact.setdefault("type", "fact")

        # Shared memory for decisions and constraints
        if fact["type"] in ("decision", "constraint", "preference"):
            if write_memory(None, fact.copy(), project_name=project_name):
                written += 1

        # Per-agent memory for participants
        for agent_id in participating_agents:
            write_memory(agent_id, fact.copy(), project_name=project_name)

    logger.info(f"Distilled {written} new facts from #{channel} (filtered {len(facts) - written} dupes/vague)")
    _last_distilled[channel] = last_id
