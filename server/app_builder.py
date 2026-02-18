"""AI Office — App Builder orchestration for end-to-end app delivery."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime

from .agent_engine import process_message
from .database import get_db, insert_message
from .websocket import manager


STACK_HINTS = {
    "react-fastapi": (
        "Frontend: React + Vite. Backend: FastAPI. "
        "Keep interfaces typed/validated, and wire API + UI end-to-end."
    ),
    "react-node": (
        "Frontend: React + Vite. Backend: Node/Express. "
        "Use clear API contracts and reproducible npm scripts."
    ),
    "nextjs": (
        "Use Next.js app router patterns with server/client boundaries clearly separated."
    ),
    "python-desktop": (
        "Desktop-first Python app with standalone launcher behavior and no browser dependency."
    ),
    "custom": (
        "Use the user's requested stack exactly and document assumptions before implementation."
    ),
}


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "generated-app"


def _sanitize_target_dir(path: str | None, app_name: str) -> str:
    candidate = (path or "").strip().replace("\\", "/")
    if candidate.startswith("@"):
        candidate = candidate[1:]
    if candidate.startswith("./"):
        candidate = candidate[2:]
    if not candidate:
        candidate = f"apps/{_slugify(app_name)}"
    candidate = candidate.strip("/")
    if candidate.startswith(".") or ".." in candidate.split("/"):
        raise ValueError("target_dir must be a safe relative path inside the project.")
    return candidate


def _build_kickoff_message(
    *,
    app_name: str,
    goal: str,
    stack: str,
    target_dir: str,
    include_tests: bool,
) -> str:
    stack_hint = STACK_HINTS.get(stack, STACK_HINTS["custom"])
    test_rule = (
        "Tests are REQUIRED. Implement and run meaningful tests."
        if include_tests
        else "Tests are optional for this run, but basic smoke checks are still required."
    )

    return (
        "APP BUILDER MODE: Build a full app (complete, runnable application) from this prompt.\n\n"
        f"App name: {app_name}\n"
        f"Goal: {goal}\n"
        f"Target directory: {target_dir}\n"
        f"Stack profile: {stack}\n"
        f"Stack guidance: {stack_hint}\n\n"
        "Execution requirements:\n"
        "1) Produce a concrete build plan with milestones.\n"
        "2) Create/maintain task board entries with [TOOL:task].\n"
        "3) Implement real files with [TOOL:write].\n"
        "4) Run real commands with [TOOL:run] and verify output.\n"
        "5) Ensure Builder + Codex lead implementation, with Architect on structure.\n"
        "6) Use dissent roles (Rex/Sage/Codex) to challenge weak decisions.\n"
        "7) Keep scope focused on shipping a usable MVP in this repo.\n"
        f"8) {test_rule}\n"
        "9) Final response must include:\n"
        "   - exact run/build/test commands\n"
        "   - what was implemented\n"
        "   - known limitations and next steps\n\n"
        "For commands in subdirectories, use syntax like:\n"
        "[TOOL:run] @client npm run build\n"
    )


async def _seed_app_tasks(app_name: str, target_dir: str, include_tests: bool) -> list[int]:
    title_prefix = f"[APP:{app_name}]"
    task_templates = [
        ("Architecture + delivery plan", "architect", 2),
        (f"Implement app scaffold in {target_dir}", "builder", 2),
        ("Implementation oversight + integration checks", "codex", 2),
        ("Deployment/reliability checklist", "ops", 1),
        ("Docs and onboarding draft", "scribe", 1),
        ("Adversarial decision review", "critic", 1),
        ("Security and quality review", "reviewer", 1),
        ("UX flow sanity check", "uiux", 1),
    ]
    if include_tests:
        task_templates.append(("Create and run test coverage", "qa", 2))
    task_templates.append(("Release readiness summary", "producer", 1))

    created_ids: list[int] = []
    conn = await get_db()
    try:
        for short_title, assigned_to, priority in task_templates:
            full_title = f"{title_prefix} {short_title}"

            existing = await conn.execute(
                "SELECT id FROM tasks WHERE title = ? AND status != 'done' ORDER BY id DESC LIMIT 1",
                (full_title,),
            )
            row = await existing.fetchone()
            if row:
                continue

            cursor = await conn.execute(
                "INSERT INTO tasks (title, description, status, assigned_to, created_by, priority) "
                "VALUES (?, ?, 'backlog', ?, 'system', ?)",
                (
                    full_title,
                    f"App Builder kickoff task for {app_name}",
                    assigned_to,
                    priority,
                ),
            )
            created_ids.append(cursor.lastrowid)
        await conn.commit()
    finally:
        await conn.close()

    return created_ids


async def start_app_builder(
    *,
    channel: str,
    app_name: str,
    goal: str,
    stack: str,
    target_dir: str | None,
    include_tests: bool,
) -> dict:
    app_name_clean = app_name.strip() or "Generated App"
    goal_clean = goal.strip()
    if not goal_clean:
        raise ValueError("goal cannot be empty")

    safe_target_dir = _sanitize_target_dir(target_dir, app_name_clean)
    kickoff = _build_kickoff_message(
        app_name=app_name_clean,
        goal=goal_clean,
        stack=stack,
        target_dir=safe_target_dir,
        include_tests=include_tests,
    )

    created_task_ids = await _seed_app_tasks(app_name_clean, safe_target_dir, include_tests)

    system_note = (
        f"App Builder started for **{app_name_clean}** at {datetime.utcnow().isoformat()}Z. "
        f"Target: `{safe_target_dir}`."
    )
    sys_msg = await insert_message(channel, "system", system_note, msg_type="system")
    await manager.broadcast(channel, {"type": "chat", "message": sys_msg})

    user_msg = await insert_message(channel, "user", kickoff, msg_type="message")
    await manager.broadcast(channel, {"type": "chat", "message": user_msg})

    asyncio.create_task(process_message(channel, kickoff))

    return {
        "status": "started",
        "channel": channel,
        "app_name": app_name_clean,
        "stack": stack,
        "target_dir": safe_target_dir,
        "tasks_created": len(created_task_ids),
        "task_ids": created_task_ids,
    }
