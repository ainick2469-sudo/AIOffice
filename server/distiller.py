"""AI Office — Memory Distiller. Extracts durable facts from conversations."""

import json
import logging
import re
from typing import Optional
from . import ollama_client
from .memory import write_memory, read_memory
from .database import get_messages, get_agents

logger = logging.getLogger("ai-office.distiller")

DISTILL_MODEL = "qwen2.5:14b"

DISTILL_SYSTEM = """You extract durable facts from a conversation for long-term memory.

Given a conversation, extract 2-8 important facts. Only extract things worth remembering:
- Decisions made (type: "decision")
- User preferences stated (type: "preference")  
- Technical constraints or requirements (type: "constraint")
- Important facts or information (type: "fact")
- Action items or TODOs (type: "todo")
- Lore, story, or world-building details (type: "lore")

Skip small talk, greetings, and trivial exchanges.
If the conversation has nothing worth remembering, return an empty array.

/no_think
Respond with ONLY a JSON array:
[{"type": "decision", "content": "We decided to use SQLite", "tags": ["tech", "database"]}]"""


# Track last distilled message ID per channel to avoid re-processing
_last_distilled = {}

# Distill every N messages
DISTILL_THRESHOLD = 5


def _parse_distill_response(text: str) -> list[dict]:
    """Parse the distiller's JSON output."""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    # Try direct parse
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass

    # Find JSON array in text
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass

    return []


async def maybe_distill(channel: str):
    """Check if we should distill, and if so, extract + store memories."""
    messages = await get_messages(channel, limit=DISTILL_THRESHOLD + 5)
    if not messages:
        return

    last_id = messages[-1]["id"]
    prev_id = _last_distilled.get(channel, 0)

    # Count new messages since last distill
    new_msgs = [m for m in messages if m["id"] > prev_id]
    if len(new_msgs) < DISTILL_THRESHOLD:
        return

    logger.info(f"Distilling {len(new_msgs)} messages from #{channel}")

    # Build conversation text
    convo_text = "\n".join(
        f"[{m['sender']}]: {m['content']}" for m in new_msgs
    )

    response = await ollama_client.generate(
        model=DISTILL_MODEL,
        prompt=f"Extract memories from this conversation:\n\n{convo_text}",
        system=DISTILL_SYSTEM,
        temperature=0.3,
        max_tokens=800,
    )

    facts = _parse_distill_response(response)
    if not facts:
        logger.info("Distiller found nothing worth remembering")
        _last_distilled[channel] = last_id
        return

    # Determine which agents participated
    participating_agents = set()
    for m in new_msgs:
        if m["sender"] != "user":
            participating_agents.add(m["sender"])

    # Write facts
    for fact in facts:
        if not isinstance(fact, dict) or "content" not in fact:
            continue

        fact["source"] = channel
        fact.setdefault("type", "fact")
        fact.setdefault("tags", [])

        # Shared memory for decisions and constraints
        if fact["type"] in ("decision", "constraint", "preference"):
            write_memory(None, fact.copy())

        # Per-agent memory for agents that participated
        for agent_id in participating_agents:
            write_memory(agent_id, fact.copy())

    logger.info(f"Distilled {len(facts)} facts from #{channel}")
    _last_distilled[channel] = last_id
