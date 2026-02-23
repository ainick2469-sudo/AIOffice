"""Deterministic task decomposition for action-oriented user requests."""

from __future__ import annotations

import re
from typing import Optional

ACTION_HINTS = (
    "build",
    "make",
    "create",
    "implement",
    "fix",
    "ship",
    "develop",
    "scaffold",
    "code",
    "start building",
    "go build",
)

DISCUSSION_HINTS = (
    "brainstorm",
    "idea",
    "discuss",
    "what should",
    "maybe",
    "should we",
    "thoughts",
)

ROLE_HINTS = {
    "ui": "uiux",
    "ux": "uiux",
    "design": "uiux",
    "frontend": "builder",
    "backend": "builder",
    "api": "architect",
    "database": "architect",
    "schema": "architect",
    "test": "qa",
    "qa": "qa",
    "deploy": "ops",
    "release": "ops",
    "security": "reviewer",
    "review": "reviewer",
}


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _looks_action_request(message: str) -> bool:
    normalized = _normalize_space(message).lower()
    if not normalized or normalized.startswith("/"):
        return False
    has_action = any(token in normalized for token in ACTION_HINTS)
    has_discussion = any(token in normalized for token in DISCUSSION_HINTS)
    return has_action and (not has_discussion or len(normalized.split()) > 10)


def _extract_focus_items(message: str) -> list[str]:
    text = _normalize_space(message)
    if not text:
        return []
    # Split on sentence boundaries and common conjunctions.
    rough_parts = re.split(r"[.;\n]|(?:\band then\b)|(?:\bwith\b)", text, flags=re.IGNORECASE)
    items: list[str] = []
    for part in rough_parts:
        piece = _normalize_space(part)
        if not piece:
            continue
        piece = re.sub(
            r"^(please|can you|could you|i want to|i need to|let's|lets|help me)\s+",
            "",
            piece,
            flags=re.IGNORECASE,
        )
        if not piece:
            continue
        # Keep short actionable fragments only.
        if len(piece.split()) <= 2 and piece.lower() not in {"app", "project", "it"}:
            continue
        items.append(piece)
        if len(items) >= 4:
            break
    return items


def _assignee_for_item(item: str, *, default: str = "builder") -> str:
    lower = item.lower()
    for token, assignee in ROLE_HINTS.items():
        if token in lower:
            return assignee
    return default


def _task(title: str, description: str, assigned_to: str, priority: int) -> dict:
    return {
        "title": title.strip(),
        "description": description.strip(),
        "assigned_to": assigned_to.strip() or "builder",
        "priority": max(1, min(3, int(priority or 2))),
        "status": "backlog",
        "subtasks": [],
        "linked_files": [],
        "depends_on": [],
        "created_by": "system",
    }


def _dedupe_tasks(tasks: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for task in tasks:
        key = _normalize_space(task.get("title", "")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(task)
    return deduped


async def decompose_request(user_message: str, channel: str, project_name: str) -> list[dict]:
    """Return 3-8 actionable tasks for build-intent prompts; otherwise an empty list."""
    _ = (channel, project_name)  # reserved for future policy/context tuning
    if not _looks_action_request(user_message):
        return []

    cleaned = _normalize_space(user_message)
    focus_items = _extract_focus_items(cleaned)
    lead_goal = focus_items[0] if focus_items else cleaned
    goal_excerpt = lead_goal[:90] + ("..." if len(lead_goal) > 90 else "")

    tasks: list[dict] = [
        _task(
            f"Define build plan for: {goal_excerpt}",
            "Outline architecture, file structure, and milestones before implementation.",
            "architect",
            3,
        ),
        _task(
            f"Scaffold implementation baseline for: {goal_excerpt}",
            "Create initial project structure and core runtime entrypoints.",
            "builder",
            3,
        ),
    ]

    for idx, item in enumerate(focus_items[:3], start=1):
        assignee = _assignee_for_item(item, default="builder" if idx == 1 else "codex")
        tasks.append(
            _task(
                f"Implement feature: {item[:96]}",
                f"Deliver working code for: {item}",
                assignee,
                3 if idx == 1 else 2,
            )
        )

    tasks.extend(
        [
            _task(
                "Add verification coverage for critical paths",
                "Add and run tests for primary user flows and regressions.",
                "qa",
                2,
            ),
            _task(
                "Run build/test verification and capture failures",
                "Execute configured build/test commands and report actionable failures.",
                "builder",
                2,
            ),
            _task(
                "Review implementation risks and release readiness",
                "Perform quality/security review and flag blockers before handoff.",
                "reviewer",
                1,
            ),
        ]
    )

    deduped = _dedupe_tasks(tasks)
    if len(deduped) < 3:
        return []
    return deduped[:8]

