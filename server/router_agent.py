"""AI Office — Router Agent v2. Classifies messages and selects responders."""

import json
import logging
import re
from typing import Optional
from . import ollama_client

logger = logging.getLogger("ai-office.router")

ROUTER_MODEL = "qwen3:1.7b"

ROUTER_SYSTEM = """You route messages to the right team members. 

Team:
- spark: creative ideas, brainstorming, "what should we build", concepts
- architect: system design, architecture, APIs, scalability
- builder: coding, debugging, implementation, programming
- reviewer: code review, security, quality, best practices
- qa: testing, edge cases, bugs, regression
- uiux: UI design, UX flow, user experience, accessibility
- art: visual design, colors, typography, aesthetics
- producer: project management, planning, priorities, coordination
- lore: storytelling, narrative, world-building, creative writing
- director: big decisions, strategy, task assignment, leadership, complex problems
- researcher: research, documentation, best practices, fact-checking, "how should we"
- sage: scope check, focus, "are we overbuilding?", priorities, shipping, realism, big picture

Rules:
- ALWAYS select 2-4 agents, never just 1
- For brainstorming/ideas: spark, producer, and 1-2 others
- For code: builder, reviewer
- For design: uiux, art
- For general/greeting: producer, spark
- For "what should we build": spark, architect, producer, director
- For complex decisions or strategy: director, architect, sage
- For "how to" or "best way": researcher, architect
- For research/docs: researcher
- For scope/focus/priority questions: sage, producer, director
- When many features are discussed: ALWAYS include sage
- For "are we done" or "what's left" or "ship it": sage, producer

/no_think
Respond ONLY with JSON: {"agents": ["id1", "id2", "id3"]}"""

# Keyword routing — much more inclusive now
KEYWORD_MAP = {
    "idea": ["spark", "producer", "architect"],
    "brainstorm": ["spark", "producer", "lore", "director"],
    "build": ["spark", "builder", "architect"],
    "make": ["spark", "builder", "architect"],
    "create": ["spark", "builder", "uiux"],
    "app": ["spark", "architect", "builder", "uiux"],
    "game": ["spark", "lore", "builder", "uiux"],
    "design": ["uiux", "art", "spark"],
    "code": ["builder", "reviewer"],
    "bug": ["builder", "qa"],
    "test": ["qa", "builder"],
    "ui": ["uiux", "art"],
    "color": ["art", "uiux"],
    "style": ["art", "uiux"],
    "security": ["reviewer", "builder"],
    "review": ["reviewer", "qa"],
    "plan": ["director", "producer", "architect"],
    "decide": ["director", "producer"],
    "strategy": ["director", "architect", "producer"],
    "assign": ["director", "producer"],
    "research": ["researcher", "architect"],
    "best practice": ["researcher", "architect"],
    "how to": ["researcher", "builder"],
    "documentation": ["researcher"],
    "database": ["architect", "builder"],
    "api": ["architect", "builder"],
    "story": ["lore", "spark"],
    "schedule": ["producer", "director"],
    "release": ["producer", "qa", "director"],
    "deploy": ["producer", "builder"],
    "help": ["spark", "producer", "architect"],
    "what": ["spark", "producer", "architect"],
    "how": ["researcher", "architect", "builder"],
    "think": ["spark", "director"],
    "suggest": ["spark", "producer"],
    "opinion": ["spark", "director", "architect"],
    "complex": ["director", "researcher", "architect"],
    "hard": ["director", "researcher"],
    "nova": ["director"],
    "scout": ["researcher"],
    "sage": ["sage"],
    "scope": ["sage", "producer", "director"],
    "focus": ["sage", "producer"],
    "priority": ["sage", "producer", "director"],
    "ship": ["sage", "producer"],
    "done": ["sage", "producer"],
    "too many": ["sage", "producer"],
    "feature creep": ["sage", "director"],
    "mvp": ["sage", "architect", "producer"],
    "bloat": ["sage", "reviewer"],
    "realistic": ["sage", "reviewer"],
    "overbuil": ["sage", "reviewer"],
    "big picture": ["sage", "director"],
    "step back": ["sage", "director"],
    "are we": ["sage", "producer"],
    "what's left": ["sage", "producer"],
}

# Default for anything unmatched — get the conversation started
DEFAULT_AGENTS = ["spark", "producer", "architect"]


def _keyword_route(message: str) -> list[str]:
    """Keyword-based routing — always returns 2-4 agents."""
    msg_lower = message.lower()
    matched = []
    for keyword, agents in KEYWORD_MAP.items():
        if keyword in msg_lower:
            for a in agents:
                if a not in matched:
                    matched.append(a)

    if not matched:
        matched = list(DEFAULT_AGENTS)

    # Always return at least 2, max 4
    if len(matched) < 2:
        for fallback in DEFAULT_AGENTS:
            if fallback not in matched:
                matched.append(fallback)
            if len(matched) >= 2:
                break

    return matched[:4]


def _parse_router_response(text: str) -> Optional[list[str]]:
    """Parse router LLM response."""
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict) and "agents" in data:
            return data["agents"]
    except json.JSONDecodeError:
        pass

    match = re.search(r'\{[^}]+\}', text)
    if match:
        try:
            data = json.loads(match.group())
            if "agents" in data:
                return data["agents"]
        except json.JSONDecodeError:
            pass

    return None


VALID_IDS = {"spark", "architect", "builder", "reviewer", "qa", "uiux", "art", "producer", "lore", "director", "researcher", "sage"}


async def route(message: str) -> list[str]:
    """Route a message to 2-4 agents."""
    # Try LLM router
    try:
        response = await ollama_client.generate(
            model=ROUTER_MODEL,
            prompt=f"Route this message: {message}",
            system=ROUTER_SYSTEM,
            temperature=0.3,
            max_tokens=150,
        )
        logger.info(f"Router raw: {response[:200]}")

        agents = _parse_router_response(response)
        if agents:
            agents = [a for a in agents if a in VALID_IDS]
            if len(agents) >= 2:
                logger.info(f"Router LLM: {agents}")
                return agents[:4]
    except Exception as e:
        logger.warning(f"Router LLM failed: {e}")

    # Fallback to keywords
    agents = _keyword_route(message)
    logger.info(f"Router keywords: {agents}")
    return agents
