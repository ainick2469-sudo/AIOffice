"""AI Office — App Builder orchestration for end-to-end app delivery."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime

from .agent_engine import process_message
from .database import get_db, insert_message, set_spec_state
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
        "APP BUILDER MODE (SPEC-FIRST): Build a full app (complete, runnable application) from this prompt.\n\n"
        f"App name: {app_name}\n"
        f"Goal: {goal}\n"
        f"Target directory: {target_dir}\n"
        f"Stack profile: {stack}\n"
        f"Stack guidance: {stack_hint}\n\n"
        "HARD RULE: Do NOT emit mutating tool calls (`write`, `run`, `start_process`, etc.) until the user approves the spec.\n"
        "You may still create/maintain tasks with [TOOL:task] during the spec phase.\n\n"
        "Spec phase requirements (before approval):\n"
        "1) Produce a concrete Build Spec: UI/UX plan, architecture, data model, APIs, and milestones.\n"
        "2) Identify verification commands (build/test/lint) and a definition of done.\n"
        "3) Highlight risks and dependencies.\n\n"
        "After the user approves the spec:\n"
        "4) Implement real files with [TOOL:write].\n"
        "5) Run real commands with [TOOL:run] and verify output.\n"
        "6) Ensure Builder + Codex lead implementation, with Architect on structure.\n"
        f"7) {test_rule}\n"
        "8) Final response must include:\n"
        "   - exact run/build/test commands\n"
        "   - what was implemented\n"
        "   - known limitations and next steps\n\n"
        "For commands in subdirectories, use syntax like:\n"
        "[TOOL:run] @client npm run build\n"
    )


async def _seed_app_tasks(app_name: str, target_dir: str, include_tests: bool, *, channel: str, project_name: str, branch: str) -> list[int]:
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
                "SELECT id FROM tasks WHERE title = ? AND channel = ? AND project_name = ? AND status != 'done' ORDER BY id DESC LIMIT 1",
                (full_title, channel, project_name),
            )
            row = await existing.fetchone()
            if row:
                continue

            cursor = await conn.execute(
                "INSERT INTO tasks (title, description, status, assigned_to, created_by, priority, channel, project_name, branch) "
                "VALUES (?, ?, 'backlog', ?, 'system', ?, ?, ?, ?)",
                (
                    full_title,
                    f"App Builder kickoff task for {app_name}",
                    assigned_to,
                    priority,
                    channel,
                    project_name,
                    branch,
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

    from . import project_manager as pm
    from . import spec_bank

    active = await pm.get_active_project(channel)
    project_name = (active.get("project") or "ai-office").strip() or "ai-office"
    branch = (active.get("branch") or "main").strip() or "main"

    # Seed an initial spec skeleton and mark the spec state as draft so mutating tool calls are gated.
    skeleton = (
        f"# Build Spec: {app_name_clean}\n\n"
        f"## Goal\n{goal_clean}\n\n"
        f"## Stack\n{stack}\n\n"
        f"## Target Directory\n`{safe_target_dir}`\n\n"
        "## UI/UX\n- \n\n"
        "## Architecture\n- \n\n"
        "## Data Model\n- \n\n"
        "## API Endpoints\n- \n\n"
        "## Milestones\n1. \n\n"
        "## Verification / Definition of Done\n- Build passes\n- Tests (if required) pass\n- Happy-path demo works\n"
    )
    ideas = f"# Idea Bank: {app_name_clean}\n\n- \n"
    spec_result = spec_bank.save_current(project_name, spec_md=skeleton, idea_bank_md=ideas)
    await set_spec_state(channel, project_name, status="draft", spec_version=spec_result.get("version"))

    created_task_ids = await _seed_app_tasks(
        app_name_clean,
        safe_target_dir,
        include_tests,
        channel=channel,
        project_name=project_name,
        branch=branch,
    )

    system_note = (
        f"App Builder started for **{app_name_clean}** at {datetime.utcnow().isoformat()}Z. "
        f"Target: `{safe_target_dir}`. Spec is now DRAFT (tools gated until approved)."
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
