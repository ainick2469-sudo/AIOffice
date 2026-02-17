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
- codex: implementation oversight, coding execution help, technical handoffs, deep debugging
- ops: deployment, reliability, observability, incident response, DevOps
- scribe: technical writing, docs, onboarding guides, runbooks
- critic: formal critique, adversarial review, anti-groupthink, logic checks

Rules:
- ALWAYS select 2-4 agents, never just 1
- Always include personality diversity: avoid selecting 3+ agents with the same stance
- For brainstorming/ideas: spark, producer, and 1-2 others
- For code: builder, reviewer, codex
- For design: uiux, art
- For general/greeting: producer, spark
- For "what should we build": spark, architect, producer, director
- For complex decisions or strategy: director, architect, sage
- For "how to" or "best way": researcher, architect, codex
- For research/docs: researcher
- For scope/focus/priority questions: sage, producer, director
- When many features are discussed: ALWAYS include sage
- For "are we done" or "what's left" or "ship it": sage, producer
- For risky shortcuts ("skip tests", "hardcode", "ignore security", "just ship"): include reviewer, sage, and codex
- When a message suggests a major decision, include at least one dissent-capable agent (reviewer or sage)
- For deployment/operations topics: ops, reviewer, qa
- For docs/readme/handoff topics: scribe, producer, codex
- For major trade-offs with weak evidence: critic, researcher, director

/no_think
Respond ONLY with JSON: {"agents": ["id1", "id2", "id3"]}"""

# Keyword routing — much more inclusive now
KEYWORD_MAP = {
    "idea": ["spark", "producer", "architect"],
    "brainstorm": ["spark", "producer", "lore", "director"],
    "build": ["builder", "architect", "spark"],
    "make": ["builder", "architect", "spark"],
    "make it": ["builder", "codex", "architect"],
    "build it": ["builder", "codex", "architect"],
    "do it": ["builder", "codex", "producer"],
    "go": ["builder", "codex", "producer"],
    "start": ["builder", "codex", "producer"],
    "create": ["builder", "uiux", "spark"],
    "app": ["spark", "architect", "builder", "uiux"],
    "full app": ["director", "architect", "builder", "codex"],
    "complete app": ["director", "architect", "builder", "codex"],
    "from scratch": ["director", "architect", "builder", "codex"],
    "production-ready": ["director", "reviewer", "qa", "codex"],
    "deploy": ["ops", "reviewer", "qa"],
    "deployment": ["ops", "reviewer", "qa"],
    "reliability": ["ops", "reviewer", "qa"],
    "incident": ["ops", "reviewer"],
    "monitoring": ["ops", "architect"],
    "observability": ["ops", "architect"],
    "ops": ["ops", "builder"],
    "runbook": ["ops", "scribe"],
    "docs": ["scribe", "producer", "codex"],
    "readme": ["scribe", "producer"],
    "handoff": ["scribe", "producer", "codex"],
    "documentation": ["scribe", "researcher"],
    "writeup": ["scribe", "producer"],
    "groupthink": ["critic", "researcher", "sage"],
    "critic": ["critic", "director"],
    "challenge this": ["critic", "reviewer", "sage"],
    "devil's advocate": ["critic", "reviewer", "sage"],
    "game": ["spark", "lore", "builder", "uiux"],
    "design": ["uiux", "art", "spark"],
    "code": ["builder", "reviewer", "codex"],
    "codex": ["codex", "builder"],
    "openai": ["codex", "researcher"],
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
    "debug": ["codex", "builder", "reviewer"],
    "implement": ["builder", "codex", "architect"],
    "fix": ["builder", "codex", "reviewer"],
    "database": ["architect", "builder"],
    "api": ["architect", "builder"],
    "story": ["lore", "spark"],
    "schedule": ["producer", "director"],
    "release": ["producer", "qa", "director"],
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

VALID_IDS = {"spark", "architect", "builder", "reviewer", "qa", "uiux", "art", "producer", "lore", "director", "researcher", "sage", "codex", "ops", "scribe", "critic"}
SKEPTIC_IDS = ("reviewer", "sage", "critic")
RISK_CHECK_IDS = ("reviewer", "sage", "codex", "ops")

RISKY_KEYWORDS = (
    "skip test", "skip tests", "no tests", "without tests",
    "just ship", "ship now", "yolo", "quick hack", "hacky", "quick and dirty",
    "hardcode", "hard-coded", "disable auth", "bypass auth",
    "ignore security", "turn off security", "temporary prod", "push straight to prod",
)

# When user says these, they want ACTION not discussion — force builder in
ACTION_KEYWORDS = (
    "make it", "build it", "do it", "create it", "start building", "go build",
    "let's go", "let's do it", "just do it", "get started", "start coding",
    "write the code", "code it", "implement it", "ship it", "make this",
    "build this", "go ahead", "start now", "begin", "execute",
)

DECISION_KEYWORDS = (
    "decide", "decision", "approve", "sign off", "final call",
    "go with", "ship", "launch", "commit to", "pick one",
)


def _message_has_keyword(message: str, keywords: tuple[str, ...]) -> bool:
    msg_lower = message.lower()
    return any(keyword in msg_lower for keyword in keywords)


def _normalize_agents(agent_ids: list[str]) -> list[str]:
    seen = set()
    normalized = []
    for aid in agent_ids:
        if aid in VALID_IDS and aid not in seen:
            normalized.append(aid)
            seen.add(aid)
    return normalized


def _ensure_diverse_panel(message: str, agent_ids: list[str]) -> list[str]:
    """Apply deterministic guardrails so selected panel is diverse and dissent-capable."""
    selected = _normalize_agents(agent_ids)
    msg_lower = message.lower()

    if len(selected) < 2:
        for fallback in DEFAULT_AGENTS:
            if fallback not in selected:
                selected.append(fallback)
            if len(selected) >= 2:
                break

    if _message_has_keyword(msg_lower, RISKY_KEYWORDS):
        if not any(a in selected for a in SKEPTIC_IDS):
            selected.insert(0, "reviewer")
        if "codex" not in selected:
            insert_at = 1 if selected and selected[0] in SKEPTIC_IDS else 0
            selected.insert(insert_at, "codex")

    # When user wants ACTION, force builder to the front
    if _message_has_keyword(msg_lower, ACTION_KEYWORDS):
        if "builder" not in selected:
            selected.insert(0, "builder")
        elif selected.index("builder") > 1:
            selected.remove("builder")
            selected.insert(0, "builder")
        # Also ensure codex for implementation support
        if "codex" not in selected:
            selected.append("codex")
        # Remove non-action agents if panel is too big
        non_action = {"lore", "art", "scribe", "critic"}
        if len(selected) > 4:
            selected = [a for a in selected if a not in non_action][:4]

    if _message_has_keyword(msg_lower, DECISION_KEYWORDS):
        if not any(a in selected for a in SKEPTIC_IDS):
            selected.insert(0, "sage")
        if "director" not in selected:
            selected.insert(0, "director")
        if "critic" not in selected:
            selected.insert(1, "critic")

    selected = _normalize_agents(selected)
    if len(selected) > 4:
        if _message_has_keyword(msg_lower, RISKY_KEYWORDS):
            prioritized = []
            for must_keep in RISK_CHECK_IDS:
                if must_keep in selected and must_keep not in prioritized:
                    prioritized.append(must_keep)
            for aid in selected:
                if aid not in prioritized:
                    prioritized.append(aid)
            selected = prioritized[:4]
        elif _message_has_keyword(msg_lower, DECISION_KEYWORDS):
            prioritized = []
            for must_keep in ("director", "critic", "sage", "reviewer"):
                if must_keep in selected and must_keep not in prioritized:
                    prioritized.append(must_keep)
            for aid in selected:
                if aid not in prioritized:
                    prioritized.append(aid)
            selected = prioritized[:4]
        else:
            selected = selected[:4]
    if len(selected) < 2:
        selected = list(DEFAULT_AGENTS[:2])
    return selected


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

    return _ensure_diverse_panel(message, matched[:4])


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
            agents = _ensure_diverse_panel(message, agents)
            if len(agents) >= 2:
                logger.info(f"Router LLM: {agents}")
                return agents[:4]
    except Exception as e:
        logger.warning(f"Router LLM failed: {e}")

    # Fallback to keywords
    agents = _keyword_route(message)
    logger.info(f"Router keywords: {agents}")
    return agents
