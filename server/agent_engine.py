"""AI Office — Agent Engine v2. Living conversation ecosystem.

Agents respond to the user AND to each other. Conversations flow naturally.
User can jump in anytime. Cap at 1000 messages.
"""

import asyncio
import logging
import os
import random
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
from . import ollama_client
from .router_agent import route
from .database import (
    get_agent,
    get_agents,
    get_messages,
    get_db,
    insert_message,
    get_channel_name,
    set_channel_name,
    get_tasks_for_agent,
    record_decision,
    log_build_result,
    get_api_usage_summary,
    get_setting,
    create_task_record,
    list_tasks,
)
from .websocket import manager
from .memory import get_known_context
from .distiller import maybe_distill
from .tool_executor import parse_tool_calls, execute_tool_calls, validate_tool_call_format
from . import claude_adapter
from . import openai_adapter
from . import build_runner
from . import project_manager
from . import git_tools
from . import autonomous_worker
from . import verification_loop
from .observability import emit_console_event

logger = logging.getLogger("ai-office.engine")

CONTEXT_WINDOW = 20
MAX_MESSAGES = 8  # Max agent messages per user message (prevents 17-agent snowball)
MAX_FOLLOWUP_ROUNDS = 2  # Max continuation rounds after initial responses
PAUSE_BETWEEN_AGENTS = 1.5  # seconds — feels natural
PAUSE_BETWEEN_ROUNDS = 3.0  # seconds — breathing room

# Active conversation tracking
_active: dict[str, bool] = {}
_msg_count: dict[str, int] = {}
_user_interrupt: dict[str, str] = {}
_collab_mode: dict[str, dict] = {}
_agent_failures: dict[str, dict[str, int]] = {}
_channel_turn_policy: dict[str, dict] = {}
_review_mode: dict[str, bool] = {}
_review_last_run: dict[str, float] = {}
_sprint_tasks: dict[str, asyncio.Task] = {}

BUILD_FIX_MAX_ATTEMPTS = 3
FAILURE_ESCALATION_THRESHOLD = 3
AUTO_REVIEW_RATE_LIMIT_SECONDS = 30
SPRINT_PROGRESS_INTERVAL_SECONDS = 300
SPRINT_MIN_SECONDS = 60

AUTO_REVIEW_CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".go", ".cpp", ".c", ".java"}

ALL_AGENT_IDS = [
    "spark", "architect", "builder", "reviewer", "qa", "uiux", "art",
    "producer", "lore", "director", "researcher", "sage", "codex",
    "ops", "scribe", "critic",
]
AGENT_NAMES = {
    "spark": "Spark", "architect": "Ada", "builder": "Max",
    "reviewer": "Rex", "qa": "Quinn", "uiux": "Uma",
    "art": "Iris", "producer": "Pam", "lore": "Leo",
    "director": "Nova", "researcher": "Scout", "sage": "Sage",
    "codex": "Codex", "ops": "Ops", "scribe": "Mira", "critic": "Vera",
}
WAR_ROOM_AGENT_ORDER = ["builder", "reviewer", "qa", "director"]
WAR_ROOM_AGENT_SET = set(WAR_ROOM_AGENT_ORDER)

RISKY_SHORTCUT_TRIGGERS = (
    "skip test", "skip tests", "no tests", "without tests",
    "just ship", "ship now", "quick hack", "quick and dirty", "yolo",
    "hardcode", "hard-coded", "ignore security", "disable auth", "bypass auth",
    "push straight to prod", "temporary prod",
)

GENERIC_AGENT_REPLY_MARKERS = (
    "how can i help",
    "what can i help",
    "what can i assist",
    "happy to help",
    "there was confusion",
    "bit mixed up",
    "looks like there might",
    "let me know how",
)

TECHNICAL_COMPLEXITY_KEYWORDS = (
    "build", "code", "design", "architecture", "implement", "fix", "test",
    "api", "database", "schema", "frontend", "backend", "deploy", "debug",
)


def _looks_risky(text: str) -> bool:
    lower = text.lower()
    return any(trigger in lower for trigger in RISKY_SHORTCUT_TRIGGERS)


def _single_line_excerpt(text: str, max_chars: int = 220) -> str:
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 3].rstrip() + "..."


def _is_generic_agent_message(text: str) -> bool:
    lower = (text or "").strip().lower()
    if not lower:
        return True
    if any(marker in lower for marker in GENERIC_AGENT_REPLY_MARKERS):
        return True
    tokens = re.findall(r"[a-z0-9]+", lower)
    if len(tokens) <= 12 and any(greet in lower for greet in ("hey", "hello", "hi ", "how are")):
        return True
    return False


def _message_complexity(text: str) -> str:
    lower = (text or "").lower()
    words = len(re.findall(r"\b\w+\b", lower))
    has_question = "?" in lower
    has_technical = any(word in lower for word in TECHNICAL_COMPLEXITY_KEYWORDS)
    has_structure = "\n" in text or lower.count(",") >= 3

    if words < 10 and not has_technical and not has_structure:
        return "simple"
    if words < 40 or (has_question and not has_technical):
        return "medium"
    return "complex"


def _turn_policy_for_message(text: str) -> dict:
    complexity = _message_complexity(text)
    if complexity == "simple":
        return {"complexity": "simple", "max_initial_agents": 2, "max_followup_rounds": 0}
    if complexity == "medium":
        return {"complexity": "medium", "max_initial_agents": 3, "max_followup_rounds": 1}
    return {"complexity": "complex", "max_initial_agents": 4, "max_followup_rounds": 2}


def _get_turn_policy(channel: str) -> dict:
    return _channel_turn_policy.get(
        channel,
        {"complexity": "medium", "max_initial_agents": 3, "max_followup_rounds": 1},
    )


# Cache project tree per root (refreshed every 60s)
_project_tree_cache: dict[str, dict] = {}

def _get_project_tree(root: Path) -> str:
    """Get real project file tree for grounding agents."""
    now = time.time()
    cache_key = str(root.resolve())
    cached = _project_tree_cache.get(cache_key)
    if cached and now - cached.get("time", 0) < 60:
        return cached.get("tree", "")
    sandbox = root
    skip = {"node_modules", ".git", "__pycache__", "client-dist", ".venv", "data"}
    lines = []
    for root_dir, dirs, files in os.walk(sandbox):
        dirs[:] = [d for d in dirs if d not in skip]
        depth = str(Path(root_dir)).replace(str(sandbox), "").count(os.sep)
        if depth > 3:
            continue
        rel = Path(root_dir).relative_to(sandbox)
        indent = "  " * depth
        if rel != Path("."):
            lines.append(f"{indent}{rel.name}/")
        for f in sorted(files)[:15]:
            lines.append(f"{indent}  {f}")
    tree = "\n".join(lines[:80])
    _project_tree_cache[cache_key] = {"tree": tree, "time": now}
    return tree


def get_collab_mode_status(channel: str) -> dict:
    mode = _collab_mode.get(channel)
    if not mode:
        return {"channel": channel, "active": False, "mode": "chat"}
    return {"channel": channel, **mode}


def _channel_failure_map(channel: str) -> dict[str, int]:
    return _agent_failures.setdefault(channel, {})


def _record_agent_failure(channel: str, agent_id: str) -> int:
    failures = _channel_failure_map(channel)
    failures[agent_id] = failures.get(agent_id, 0) + 1
    return failures[agent_id]


def _reset_agent_failure(channel: str, agent_id: str):
    failures = _channel_failure_map(channel)
    failures[agent_id] = 0


async def _send_system_message(channel: str, content: str, msg_type: str = "system"):
    saved = await insert_message(channel=channel, sender="system", content=content, msg_type=msg_type)
    await manager.broadcast(channel, {"type": "chat", "message": saved})
    return saved


def _war_room_mode(channel: str) -> Optional[dict]:
    mode = _collab_mode.get(channel)
    if mode and mode.get("active") and mode.get("mode") == "warroom":
        return mode
    return None


def _is_war_room_suppressed(channel: str, agent_id: str) -> bool:
    return _war_room_mode(channel) is not None and agent_id not in WAR_ROOM_AGENT_SET


def _format_elapsed(seconds: int) -> str:
    secs = max(0, int(seconds or 0))
    mins, rem = divmod(secs, 60)
    return f"{mins}m {rem:02d}s"


def _review_enabled(channel: str) -> bool:
    return _review_mode.get(channel, True)


def _is_reviewable_code_path(path: str) -> bool:
    normalized = (path or "").strip().replace("\\", "/").lower().lstrip("/")
    if not normalized:
        return False
    ext = Path(normalized).suffix.lower()
    if ext not in AUTO_REVIEW_CODE_EXTENSIONS:
        return False

    wrapped = f"/{normalized}/"
    filename = Path(normalized).name
    if "/docs/" in wrapped or normalized.startswith("docs/"):
        return False
    if "/tests/" in wrapped or normalized.startswith("tests/"):
        return False
    if filename.startswith("test_") or filename.endswith("_test.py") or ".test." in filename or ".spec." in filename:
        return False
    return True


def _extract_reviewable_write_paths(results: list[dict]) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for item in results:
        if item.get("type") != "write":
            continue
        result = item.get("result") or {}
        is_success = bool(result.get("ok")) or result.get("action") == "written"
        path = (item.get("path") or "").strip()
        if not is_success or not path:
            continue
        if not _is_reviewable_code_path(path):
            continue
        normalized = path.replace("\\", "/")
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        paths.append(normalized)
    return paths


async def _read_project_file_excerpt(channel: str, rel_path: str, max_lines: int = 220) -> str:
    active = await project_manager.get_active_project(channel)
    root = Path(active["path"]).resolve()
    candidate = (root / rel_path.replace("\\", "/")).resolve()
    if not str(candidate).startswith(str(root)):
        return ""
    if not candidate.exists() or not candidate.is_file():
        return ""
    try:
        text = candidate.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""

    lines = text.splitlines()
    clipped = "\n".join(lines[:max_lines])
    if len(lines) > max_lines:
        clipped += f"\n... [truncated: showing {max_lines} of {len(lines)} lines]"
    return clipped


async def _generate_auto_review(
    reviewer: dict,
    channel: str,
    file_path: str,
    author_agent: dict,
    excerpt: str,
) -> Optional[str]:
    active_project = await project_manager.get_active_project(channel)
    backend = reviewer.get("backend", "ollama")

    system = (
        (reviewer.get("system_prompt") or "You are a strict code reviewer.")
        + "\n\nAUTO CODE REVIEW MODE:\n"
        + "Review only the provided file content.\n"
        + "Focus on bugs, security, error handling, and edge cases.\n"
        + "Respond in 2-6 short bullets.\n"
        + "First line MUST be exactly: Severity: critical|warning|ok\n"
    )
    prompt = (
        f"Author: {author_agent.get('display_name', author_agent.get('id', 'agent'))} ({author_agent.get('id', '')})\n"
        f"File: {file_path}\n\n"
        "Review this code that was just written.\n"
        "If there are no major issues, use `Severity: ok`.\n"
        "If there is a blocking or high-risk issue, use `Severity: critical`.\n\n"
        f"```text\n{excerpt or '[file unreadable for review]'}\n```"
    )

    try:
        if backend in {"claude", "openai"}:
            budget_state = await _api_budget_state(channel, active_project["project"])
            budget = budget_state["budget_usd"]
            used = budget_state["used_usd"]
            if budget > 0 and used >= budget:
                return (
                    "Severity: warning\n"
                    "- API budget reached, auto-review skipped for this write."
                )
        if backend == "claude":
            return await claude_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.2,
                max_tokens=450,
                model=reviewer.get("model", "claude-sonnet-4-20250514"),
                channel=channel,
                project_name=active_project["project"],
            )
        if backend == "openai":
            return await openai_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.2,
                max_tokens=450,
                model=reviewer.get("model", "gpt-4o-mini"),
                channel=channel,
                project_name=active_project["project"],
            )
        return await ollama_client.generate(
            model=reviewer.get("model", "qwen2.5:14b"),
            prompt=prompt,
            system=system,
            temperature=0.2,
            max_tokens=380,
        )
    except Exception as exc:
        logger.error(f"Auto code review failed: {exc}")
        return None


def _review_has_critical_issues(review_text: str) -> bool:
    lower = (review_text or "").lower()
    if "severity: critical" in lower:
        return True
    if "no critical issue" in lower or "severity: ok" in lower:
        return False
    critical_tokens = (
        "blocker",
        "high severity",
        "security vulnerability",
        "remote code execution",
        "data loss",
        "auth bypass",
    )
    return any(token in lower for token in critical_tokens)


def _extract_review_issue_summary(review_text: str) -> str:
    lines = [line.strip(" -*\t") for line in (review_text or "").splitlines()]
    for line in lines:
        if not line:
            continue
        lower = line.lower()
        if lower.startswith("severity:"):
            continue
        return line[:90]
    return "critical review finding"


async def _maybe_run_auto_code_review(channel: str, author_agent: dict, write_paths: list[str]):
    if not write_paths or not _review_enabled(channel):
        return

    now = time.time()
    last = _review_last_run.get(channel, 0.0)
    if now - last < AUTO_REVIEW_RATE_LIMIT_SECONDS:
        return

    reviewer = await get_agent("reviewer")
    if not reviewer or not reviewer.get("active"):
        return

    target_path = write_paths[0]
    excerpt = await _read_project_file_excerpt(channel, target_path)
    review = await _generate_auto_review(reviewer, channel, target_path, author_agent, excerpt)
    if not review:
        return

    review = re.sub(r"<think>.*?</think>", "", review, flags=re.DOTALL).strip()
    if not review:
        return

    _review_last_run[channel] = now
    msg = f"📋 Code Review — `{target_path}`\n{review}"
    saved = await insert_message(channel=channel, sender=reviewer["id"], content=msg, msg_type="review")
    await manager.broadcast(channel, {"type": "chat", "message": saved})

    if not _review_has_critical_issues(review):
        return

    issue = _extract_review_issue_summary(review)
    task_title = f"Fix: {issue} in {target_path}"
    if len(task_title) > 160:
        task_title = task_title[:157] + "..."
    active_project = await project_manager.get_active_project(channel)
    task = await create_task_record(
        {
            "title": task_title,
            "description": f"Auto-created from critical code review.\n\n{review}",
            "assigned_to": author_agent["id"],
            "created_by": reviewer["id"],
            "priority": 3,
            "subtasks": [],
            "linked_files": [target_path],
            "depends_on": [],
            "status": "backlog",
            "branch": active_project.get("branch", "main"),
        },
        channel=channel,
        project_name=active_project.get("project"),
    )
    await manager.broadcast(channel, {"type": "task_created", "task": task})
    await _send_system_message(
        channel,
        f"Critical review issue detected. Created task #{task.get('id')} for `{author_agent.get('display_name', author_agent['id'])}`.",
    )


def _sprint_mode(channel: str) -> Optional[dict]:
    mode = _collab_mode.get(channel)
    if mode and mode.get("active") and mode.get("mode") == "sprint":
        return mode
    return None


def _parse_sprint_duration(raw: str) -> int:
    token = (raw or "").strip().lower()
    match = re.fullmatch(r"(\d+)([mh])", token)
    if not match:
        raise ValueError("Duration must be like `30m` or `2h`.")
    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        raise ValueError("Duration must be > 0.")
    seconds = amount * (60 if unit == "m" else 3600)
    return max(SPRINT_MIN_SECONDS, seconds)


def _sprint_scope_tasks(mode: dict, tasks: list[dict]) -> list[dict]:
    baseline = {int(i) for i in mode.get("baseline_task_ids", [])}
    scoped = []
    for task in tasks:
        try:
            task_id = int(task.get("id"))
        except Exception:
            continue
        if task_id in baseline:
            continue
        scoped.append(task)
    return scoped


def _sprint_progress_line(scoped_tasks: list[dict]) -> str:
    total = len(scoped_tasks)
    done = sum(1 for t in scoped_tasks if t.get("status") == "done")
    in_progress = sum(1 for t in scoped_tasks if t.get("status") == "in_progress")
    blocked = sum(1 for t in scoped_tasks if t.get("status") == "blocked")
    remaining = max(0, total - done - in_progress - blocked)
    return (
        f"✅ {done}/{max(total, 1)} tasks done, "
        f"🔨 {in_progress} in progress, "
        f"⛔ {blocked} blocked, "
        f"⬜ {remaining} remaining"
    )


def _parse_git_file_counts(status_stdout: str) -> tuple[int, int]:
    created = 0
    modified = 0
    for raw in (status_stdout or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("??") or line.startswith("A") or line[1:2] == "A":
            created += 1
            continue
        if line.startswith("M") or line[1:2] == "M":
            modified += 1
    return created, modified


def _agent_write_counts(messages: list[dict], after_id: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    for msg in messages:
        if int(msg.get("id", 0) or 0) <= after_id:
            continue
        sender = msg.get("sender")
        if not sender or sender in {"user", "system"}:
            continue
        tool_calls = parse_tool_calls(msg.get("content", ""))
        write_count = sum(1 for call in tool_calls if call.get("type") == "write")
        if write_count:
            counts[sender] = counts.get(sender, 0) + write_count
    return counts


async def _generate_sprint_task_plan(director: dict, channel: str, goal: str) -> Optional[str]:
    active_project = await project_manager.get_active_project(channel)
    backend = director.get("backend", "ollama")
    system = (
        (director.get("system_prompt") or "You are a project director.")
        + "\n\nSPRINT PLANNING MODE:\n"
        + "Decompose the goal into 3-6 dependency-ordered implementation tasks.\n"
        + "Use one `[TOOL:task]` line per task in format: title | assigned_to | priority.\n"
        + "Choose valid assignees from this set: builder, reviewer, qa, architect, codex, ops, uiux, producer.\n"
        + "Priority must be 1-3.\n"
        + "Keep output short and action-focused."
    )
    prompt = (
        f"Sprint goal: {goal}\n\n"
        "Output 3-6 tasks using `[TOOL:task]` lines only, then one short kickoff sentence."
    )

    try:
        if backend in {"claude", "openai"}:
            budget_state = await _api_budget_state(channel, active_project["project"])
            budget = budget_state["budget_usd"]
            used = budget_state["used_usd"]
            if budget > 0 and used >= budget:
                return "API budget reached. Sprint planner cannot call remote model right now."
        if backend == "claude":
            return await claude_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.35,
                max_tokens=500,
                model=director.get("model", "claude-sonnet-4-20250514"),
                channel=channel,
                project_name=active_project["project"],
            )
        if backend == "openai":
            return await openai_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.35,
                max_tokens=500,
                model=director.get("model", "gpt-4o-mini"),
                channel=channel,
                project_name=active_project["project"],
            )
        return await ollama_client.generate(
            model=director.get("model", "qwen2.5:14b"),
            prompt=prompt,
            system=system,
            temperature=0.4,
            max_tokens=420,
        )
    except Exception as exc:
        logger.error(f"Sprint decomposition failed: {exc}")
        return None


def _cancel_sprint_watcher(channel: str):
    task = _sprint_tasks.get(channel)
    current = asyncio.current_task()
    if task and task is not current and not task.done():
        task.cancel()
    if task and (task.done() or task is not current):
        _sprint_tasks.pop(channel, None)


async def _build_sprint_report(channel: str, mode: dict, reason: str) -> tuple[str, Path]:
    started_at = int(mode.get("started_at") or time.time())
    duration_seconds = int(mode.get("duration_seconds") or 0)
    now = int(time.time())
    elapsed = max(0, now - started_at)

    all_tasks = await list_tasks()
    scoped = _sprint_scope_tasks(mode, all_tasks)
    total_tasks = len(scoped)
    done_tasks = sum(1 for t in scoped if t.get("status") == "done")
    blocked_tasks = [t for t in scoped if t.get("status") == "blocked"]
    remaining_tasks = [t for t in scoped if t.get("status") != "done"]

    active_project = await project_manager.get_active_project(channel)
    project_name = active_project["project"]
    root = Path(active_project["path"])

    build_status = "Not configured"
    test_status = "Not configured"
    cfg = build_runner.get_build_config(project_name)
    if (cfg.get("build_cmd") or "").strip():
        build_result = build_runner.run_build(project_name)
        build_status = "✅ Passing" if build_result.get("ok") else f"❌ Failing ({build_result.get('exit_code')})"
    if (cfg.get("test_cmd") or "").strip():
        test_result = build_runner.run_test(project_name)
        test_status = "✅ Passing" if test_result.get("ok") else f"❌ Failing ({test_result.get('exit_code')})"

    git_status = git_tools.status(project_name)
    created_files = 0
    modified_files = 0
    if git_status.get("ok"):
        created_files, modified_files = _parse_git_file_counts(git_status.get("stdout", ""))

    messages = await get_messages(channel, limit=2000)
    start_message_id = int(mode.get("start_message_id") or 0)
    writer_counts = _agent_write_counts(messages, start_message_id)
    involved = []
    for agent_id, count in sorted(writer_counts.items(), key=lambda item: (-item[1], item[0])):
        involved.append(f"{AGENT_NAMES.get(agent_id, agent_id)} ({count} writes)")
    involved_text = ", ".join(involved) if involved else "No write activity detected"

    blocked_summary = "none"
    if blocked_tasks:
        blocked_summary = "; ".join(f"#{t.get('id')}: {t.get('title')}" for t in blocked_tasks[:4])
    remaining_summary = "none"
    if remaining_tasks:
        remaining_summary = "; ".join(f"#{t.get('id')}: {t.get('title')}" for t in remaining_tasks[:4])

    goal = mode.get("goal") or mode.get("topic") or "unspecified goal"
    report = (
        "📊 SPRINT REPORT\n"
        f"Goal: {goal}\n"
        f"Duration: {_format_elapsed(duration_seconds)} planned ({_format_elapsed(elapsed)} actual)\n"
        f"Tasks completed: {done_tasks}/{max(total_tasks, 1)}\n"
        f"Tasks remaining: {max(total_tasks - done_tasks, 0)} (blocked: {blocked_summary})\n"
        f"Remaining detail: {remaining_summary}\n"
        f"Files created: {created_files}\n"
        f"Files modified: {modified_files}\n"
        f"Build status: {build_status}\n"
        f"Test status: {test_status}\n"
        f"Agents involved: {involved_text}\n"
        f"Finish reason: {reason}"
    )

    reports_dir = root / "docs" / "sprint-reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    report_path = reports_dir / f"{channel}-{stamp}.md"
    report_path.write_text(report + "\n", encoding="utf-8")
    return report, report_path


async def _stop_sprint(channel: str, reason: str, cancel_watcher: bool = True) -> bool:
    mode = _sprint_mode(channel)
    if not mode:
        return False

    mode["active"] = False
    mode["updated_at"] = int(time.time())
    _collab_mode[channel] = mode

    if cancel_watcher:
        _cancel_sprint_watcher(channel)

    status = autonomous_worker.stop_work(channel)
    await manager.broadcast(channel, {"type": "work_status", "status": status})

    report, path = await _build_sprint_report(channel, mode, reason)
    _collab_mode.pop(channel, None)

    await _send_system_message(
        channel,
        f"{report}\n\nReport saved to `{path}`",
        msg_type="decision",
    )
    return True


async def _sprint_watcher_loop(channel: str):
    try:
        while True:
            mode = _sprint_mode(channel)
            if not mode:
                break

            now = int(time.time())
            ends_at = int(mode.get("ends_at") or now)
            if now >= ends_at:
                await _stop_sprint(channel, reason="time_elapsed", cancel_watcher=False)
                break

            scoped = _sprint_scope_tasks(mode, await list_tasks())
            if scoped and all(task.get("status") == "done" for task in scoped):
                await _stop_sprint(channel, reason="all_tasks_done", cancel_watcher=False)
                break

            last_progress = int(mode.get("last_progress_at") or 0)
            if now - last_progress >= SPRINT_PROGRESS_INTERVAL_SECONDS:
                await _send_system_message(channel, _sprint_progress_line(scoped))
                mode["last_progress_at"] = now
                mode["updated_at"] = now
                _collab_mode[channel] = mode

            await asyncio.sleep(5)
    except asyncio.CancelledError:
        return
    finally:
        current = asyncio.current_task()
        if _sprint_tasks.get(channel) is current:
            _sprint_tasks.pop(channel, None)


async def _start_sprint(channel: str, duration_raw: str, goal: str):
    if _sprint_mode(channel):
        await _send_system_message(channel, "Sprint mode is already active. Use `/sprint stop` first.")
        return

    duration_seconds = _parse_sprint_duration(duration_raw)
    goal_text = (goal or "").strip()
    if not goal_text:
        raise ValueError("Sprint goal is required.")

    now = int(time.time())
    existing_tasks = await list_tasks()
    messages = await get_messages(channel, limit=1)
    start_message_id = int(messages[-1]["id"]) if messages else 0

    _collab_mode[channel] = {
        "active": True,
        "mode": "sprint",
        "topic": goal_text,
        "goal": goal_text,
        "duration_seconds": duration_seconds,
        "started_at": now,
        "ends_at": now + duration_seconds,
        "last_progress_at": now,
        "baseline_task_ids": [int(t.get("id")) for t in existing_tasks if t.get("id") is not None],
        "start_message_id": start_message_id,
        "updated_at": now,
    }

    work_status = autonomous_worker.start_work(channel)
    await manager.broadcast(channel, {"type": "work_status", "status": work_status})
    await _send_system_message(
        channel,
        f"🏃 SPRINT STARTED — Goal: {goal_text} — Time: {_format_elapsed(duration_seconds)}",
        msg_type="system",
    )

    director = await get_agent("director")
    if director and director.get("active"):
        plan = await _generate_sprint_task_plan(director, channel, goal_text)
        if plan:
            await _send(director, channel, plan, run_post_checks=False)

    _cancel_sprint_watcher(channel)
    _sprint_tasks[channel] = asyncio.create_task(_sprint_watcher_loop(channel))


async def _handle_sprint_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/sprint"):
        return False

    arg = raw[len("/sprint"):].strip()
    if not arg or arg.lower() == "status":
        mode = _sprint_mode(channel)
        if not mode:
            await _send_system_message(channel, "Sprint mode is not active.")
            return True
        remaining = max(0, int(mode.get("ends_at", 0)) - int(time.time()))
        scoped = _sprint_scope_tasks(mode, await list_tasks())
        await _send_system_message(
            channel,
            f"Sprint status — Goal: {mode.get('goal')}\n"
            f"Remaining: {_format_elapsed(remaining)}\n"
            f"{_sprint_progress_line(scoped)}",
        )
        return True

    lowered = arg.lower()
    if lowered in {"stop", "end", "off"}:
        stopped = await _stop_sprint(channel, reason="stopped_by_user")
        if not stopped:
            await _send_system_message(channel, "Sprint mode is not active.")
        return True

    if lowered.startswith("start "):
        parts = arg.split(maxsplit=2)
        if len(parts) < 3:
            await _send_system_message(channel, "Usage: `/sprint start <duration> <goal>` (example: `/sprint start 30m finish login system`)")
            return True
        duration_raw = parts[1]
        goal = parts[2]
        try:
            await _start_sprint(channel, duration_raw, goal)
        except ValueError as exc:
            await _send_system_message(channel, str(exc))
        return True

    await _send_system_message(channel, "Usage: `/sprint start <duration> <goal>`, `/sprint status`, `/sprint stop`")
    return True


async def _enter_war_room(channel: str, issue: str, trigger: str = "manual"):
    existing = _war_room_mode(channel)
    if existing:
        return

    if channel in _active and _active[channel]:
        _active[channel] = False

    now = int(time.time())
    _collab_mode[channel] = {
        "active": True,
        "mode": "warroom",
        "topic": issue,
        "issue": issue,
        "trigger": trigger,
        "started_at": now,
        "updated_at": now,
        "allowed_agents": WAR_ROOM_AGENT_ORDER[:],
    }

    await _send_system_message(
        channel,
        f"🚨 WAR ROOM — {issue}\n"
        "Only Max (builder), Rex (reviewer), Quinn (qa), and Nova (director) are active.\n"
        "Focus ONLY on fixing this issue: reproduce -> diagnose -> fix -> verify.",
        msg_type="system",
    )


async def _exit_war_room(channel: str, reason: str, resolved_by: str = "system"):
    mode = _war_room_mode(channel)
    if not mode:
        return

    started_at = int(mode.get("started_at") or time.time())
    elapsed = int(time.time()) - started_at
    issue = mode.get("issue") or mode.get("topic") or "incident"
    _collab_mode.pop(channel, None)

    await _send_system_message(
        channel,
        "🚨 War Room closed.\n"
        f"Issue: {issue}\n"
        f"Duration: {_format_elapsed(elapsed)}\n"
        f"Resolved by: {resolved_by}\n"
        f"Reason: {reason}",
        msg_type="decision",
    )

async def _maybe_escalate_to_nova(channel: str, agent_id: str, reason: str, context: str = "") -> bool:
    count = _record_agent_failure(channel, agent_id)
    if count < FAILURE_ESCALATION_THRESHOLD:
        return False

    _reset_agent_failure(channel, agent_id)
    notice = (
        f"Escalation triggered for `{agent_id}` after repeated failures.\n"
        f"Reason: {reason}\n"
        "Routing this to Nova with full failure context."
    )
    await _send_system_message(channel, notice, msg_type="system")

    nova = await get_agent("director")
    if not nova or not nova.get("active"):
        return True

    if context.strip():
        await _send_system_message(channel, f"Failure context:\n\n{context[:4000]}", msg_type="tool_result")
    response = await _generate(nova, channel, is_followup=True)
    if response:
        await _send(nova, channel, response)
    return True


def _text_tokens_for_files(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}", text or "")


TEXT_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".toml",
    ".yaml", ".yml", ".css", ".html", ".sql", ".ini", ".cfg", ".go", ".rs",
}
ORACLE_SCAN_EXTENSIONS = TEXT_EXTENSIONS | {".java", ".c", ".cpp", ".h"}
ORACLE_SKIP_DIRS = {"node_modules", ".git", "__pycache__", "client-dist", ".venv", "venv", "dist", "build"}
ORACLE_STOP_WORDS = {
    "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "is", "it",
    "what", "how", "do", "does", "we", "our", "have", "with", "about", "codebase",
}


async def _build_file_context(channel: str, user_message: str, agent: dict) -> str:
    """Gather relevant project files and inject truncated snippets."""
    sandbox = await project_manager.get_sandbox_root(channel)
    if not sandbox.exists():
        return ""

    manifests = [
        "README.md",
        "package.json",
        "pyproject.toml",
        "requirements.txt",
        "Cargo.toml",
        "go.mod",
        "CMakeLists.txt",
        ".ai-office/config.json",
    ]
    candidate_paths: list[Path] = []
    seen = set()

    def add_if_valid(path: Path):
        try:
            resolved = path.resolve()
            if not str(resolved).startswith(str(sandbox.resolve())):
                return
            if not resolved.exists() or not resolved.is_file():
                return
            if resolved.suffix.lower() not in TEXT_EXTENSIONS and resolved.name not in manifests:
                return
            key = str(resolved)
            if key in seen:
                return
            seen.add(key)
            candidate_paths.append(resolved)
        except Exception:
            return

    for rel in manifests:
        add_if_valid((sandbox / rel))

    for token in _text_tokens_for_files(user_message):
        add_if_valid((sandbox / token.replace("\\", "/")))

    recent = await get_messages(channel, limit=5)
    for msg in recent:
        for token in _text_tokens_for_files(msg.get("content", "")):
            add_if_valid((sandbox / token.replace("\\", "/")))

    tasks = await get_tasks_for_agent(agent["id"], channel=channel)
    for task in tasks[:8]:
        blob = " ".join(
            str(task.get(k, "")) for k in ("title", "description")
        )
        for token in _text_tokens_for_files(blob):
            add_if_valid((sandbox / token.replace("\\", "/")))

    if not candidate_paths:
        return ""

    blocks = []
    budget = 16000
    max_files = 500
    scanned = 0
    for path in candidate_paths:
        if scanned >= max_files or budget <= 0:
            break
        scanned += 1
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        lines = raw.splitlines()
        limited = lines[:200]
        body = "\n".join(limited)
        if len(lines) > 200:
            body += f"\n... [truncated: showing 200 of {len(lines)} lines]"
        rel = path.relative_to(sandbox).as_posix()
        block = f"[FILE] {rel}\n{body}\n"
        if len(block) > budget:
            block = block[:max(0, budget - 64)] + "\n... [context budget reached]\n"
            blocks.append(block)
            budget = 0
            break
        blocks.append(block)
        budget -= len(block)
    return "\n".join(blocks)


def _oracle_extract_keywords(question: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9_]+", (question or "").lower())
    return [t for t in tokens if len(t) > 2 and t not in ORACLE_STOP_WORDS][:20]


def _oracle_select_files(project_root: Path, question: str) -> list[Path]:
    keywords = _oracle_extract_keywords(question)
    hints = []
    lower_q = (question or "").lower()
    if "endpoint" in lower_q or "api" in lower_q or "route" in lower_q:
        hints.extend(["routes", "api", "router"])
    if "auth" in lower_q or "login" in lower_q or "permission" in lower_q:
        hints.extend(["auth", "permission", "login", "token"])
    if "test" in lower_q:
        hints.extend(["test", "pytest", "spec"])
    keywords = list(dict.fromkeys(keywords + hints))

    scored: list[tuple[int, Path]] = []
    scanned = 0
    for root_dir, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in ORACLE_SKIP_DIRS]
        for filename in files:
            scanned += 1
            if scanned > 2000:
                break
            path = Path(root_dir) / filename
            if path.suffix.lower() not in ORACLE_SCAN_EXTENSIONS and filename not in {
                "README.md",
                "pyproject.toml",
                "package.json",
                "requirements.txt",
            }:
                continue
            rel = path.relative_to(project_root).as_posix().lower()
            score = 0
            for key in keywords:
                if key in rel:
                    score += 3
                if rel.endswith(f"/{key}.py") or rel.endswith(f"/{key}.js"):
                    score += 2
            if "routes_api.py" in rel and ("endpoint" in lower_q or "api" in lower_q):
                score += 8
            if "/tests/" in f"/{rel}/" and "test" in lower_q:
                score += 4
            if score > 0:
                scored.append((score, path))
        if scanned > 2000:
            break

    scored.sort(key=lambda item: (-item[0], item[1].as_posix()))
    selected = [item[1] for item in scored[:5]]

    if not selected:
        readme = project_root / "README.md"
        if readme.exists():
            selected.append(readme)

    return selected[:5]


def _oracle_test_gap_hint(project_root: Path) -> str:
    source_candidates: list[str] = []
    test_candidates: set[str] = set()

    for root_dir, dirs, files in os.walk(project_root):
        dirs[:] = [d for d in dirs if d not in ORACLE_SKIP_DIRS]
        rel_root = Path(root_dir).relative_to(project_root).as_posix().lower()
        for filename in files:
            if filename.startswith("."):
                continue
            path = Path(root_dir) / filename
            rel = path.relative_to(project_root).as_posix()
            base = Path(filename).stem.lower()
            if "/tests/" in f"/{rel_root}/" or filename.startswith("test_") or ".test." in filename:
                test_candidates.add(base.replace("test_", ""))
                continue
            if path.suffix.lower() in {".py", ".js", ".jsx", ".ts", ".tsx"} and "/tests/" not in f"/{rel_root}/":
                source_candidates.append(rel)

    uncovered = []
    for rel in source_candidates:
        stem = Path(rel).stem.lower()
        if stem not in test_candidates:
            uncovered.append(rel)
    if not uncovered:
        return "All detected source files appear to have a similarly named test file."
    top = uncovered[:15]
    return "Potential files lacking direct test-name matches:\n" + "\n".join(f"- {item}" for item in top)


def _oracle_build_context(project_root: Path, question: str, selected_files: list[Path]) -> str:
    chunks = []
    for path in selected_files[:5]:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        lines = text.splitlines()
        clipped = "\n".join(lines[:200])
        if len(lines) > 200:
            clipped += f"\n... [truncated: showing 200 of {len(lines)} lines]"
        rel = path.relative_to(project_root).as_posix()
        chunks.append(f"[FILE] {rel}\n{clipped}")

    lower_q = (question or "").lower()
    if "no tests" in lower_q or "without tests" in lower_q:
        chunks.append("[TEST_GAP_HINT]\n" + _oracle_test_gap_hint(project_root))

    return "\n\n".join(chunks)


async def _generate_oracle_answer(agent: dict, channel: str, question: str, file_context: str, file_tree: str) -> Optional[str]:
    active_project = await project_manager.get_active_project(channel)
    backend = agent.get("backend", "ollama")

    system = (
        (agent.get("system_prompt") or "You are a researcher.")
        + "\n\nORACLE MODE RULES:\n"
        + "1. Answer ONLY from provided project files and tree.\n"
        + "2. If data is missing, say exactly what file is missing.\n"
        + "3. Be concrete: cite files and counts where possible.\n"
        + "4. Do not guess.\n"
    )
    prompt = (
        "Oracle mode question:\n"
        f"{question}\n\n"
        "Project file tree:\n"
        f"{file_tree}\n\n"
        "Relevant file excerpts:\n"
        f"{file_context}\n\n"
        "Provide a concise answer with file references."
    )

    try:
        if backend in {"claude", "openai"}:
            budget_state = await _api_budget_state(channel, active_project["project"])
            budget = budget_state["budget_usd"]
            used = budget_state["used_usd"]
            if budget > 0 and used >= budget:
                return (
                    f"API budget cap reached (${budget:.2f}). "
                    f"Current estimated usage is ${used:.2f}. "
                    "Please raise budget or switch this query to local models."
                )
        if backend == "claude":
            return await claude_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.2,
                max_tokens=700,
                model=agent.get("model", "claude-sonnet-4-20250514"),
                channel=channel,
                project_name=active_project["project"],
            )
        if backend == "openai":
            return await openai_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.2,
                max_tokens=700,
                model=agent.get("model", "gpt-4o-mini"),
                channel=channel,
                project_name=active_project["project"],
            )
        return await ollama_client.generate(
            model=agent.get("model", "qwen2.5:14b"),
            prompt=prompt,
            system=system,
            temperature=0.2,
            max_tokens=650,
        )
    except Exception as exc:
        logger.error(f"Oracle generation failed for {agent.get('id')}: {exc}")
        return None


async def _handle_oracle_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/oracle"):
        return False

    question = raw[len("/oracle"):].strip()
    if not question:
        await _send_system_message(channel, "Usage: /oracle <question about codebase>")
        return True

    await _send_system_message(channel, "🔮 Oracle mode — reading project files...")
    active = await project_manager.get_active_project(channel)
    project_root = Path(active["path"])
    if not project_root.exists():
        await _send_system_message(channel, f"Active project path is missing: `{project_root}`")
        return True

    selected = _oracle_select_files(project_root, question)
    if not selected:
        await _send_system_message(channel, "Oracle mode could not find relevant project files for this question.")
        return True

    file_context = _oracle_build_context(project_root, question, selected)
    file_tree = _get_project_tree(project_root)

    scout = await get_agent("researcher")
    if not scout or not scout.get("active"):
        scout = await get_agent("director")
    if not scout or not scout.get("active"):
        await _send_system_message(channel, "No Oracle-capable agent is active (Scout/Nova unavailable).")
        return True

    answer = await _generate_oracle_answer(scout, channel, question, file_context, file_tree)
    if not answer:
        await _send_system_message(channel, "Oracle mode could not generate an answer. Try narrowing the question.")
        return True

    await _send(scout, channel, answer, run_post_checks=False)
    return True


async def _handle_warroom_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/warroom"):
        return False

    arg = raw[len("/warroom"):].strip()
    if arg.lower() in {"stop", "off", "end"}:
        if not _war_room_mode(channel):
            await _send_system_message(channel, "War Room mode is not active.")
            return True
        await _exit_war_room(channel, reason="manual stop command", resolved_by="user")
        return True

    issue = arg or "critical incident"
    await _enter_war_room(channel, issue=issue, trigger="manual")
    return True


async def _handle_review_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/review"):
        return False

    arg = raw[len("/review"):].strip().lower()
    if arg in {"on", "enable"}:
        _review_mode[channel] = True
        await _send_system_message(channel, "Auto code review is ON for this channel.")
        return True
    if arg in {"off", "disable"}:
        _review_mode[channel] = False
        await _send_system_message(channel, "Auto code review is OFF for this channel.")
        return True
    if arg in {"", "status"}:
        state = "ON" if _review_enabled(channel) else "OFF"
        await _send_system_message(channel, f"Auto code review status: {state}.")
        return True

    await _send_system_message(channel, "Usage: `/review on`, `/review off`, `/review status`")
    return True


async def _handle_project_command(channel: str, user_message: str) -> bool:
    if not user_message.startswith("/project"):
        return False
    parts = user_message.strip().split()
    if len(parts) < 2:
        await _send_system_message(channel, "Usage: /project <create|list|switch|status|delete> ...")
        return True

    action = parts[1].lower()
    try:
        if action == "create":
            if len(parts) < 3:
                raise ValueError("Usage: /project create <name>")
            template = None
            if "--template" in parts:
                idx = parts.index("--template")
                if idx + 1 < len(parts):
                    template = parts[idx + 1]
            project = await project_manager.create_project(parts[2], template=template)
            try:
                await build_runner.detect_and_store_config(project["name"])
            except Exception:
                pass
            await _send_system_message(channel, f"Project created: `{project['name']}` at `{project['path']}`.")
            return True
        if action == "list":
            projects = await project_manager.list_projects()
            if not projects:
                await _send_system_message(channel, "No projects yet. Create one with `/project create <name>`.")
            else:
                lines = [f"- `{p['name']}` ({p['path']})" for p in projects]
                await _send_system_message(channel, "Projects:\n" + "\n".join(lines))
            return True
        if action == "switch":
            if len(parts) < 3:
                raise ValueError("Usage: /project switch <name>")
            active = await project_manager.switch_project(channel, parts[2])
            detected = await project_manager.maybe_detect_build_config(channel)
            msg = (
                f"Active project for `{channel}` is now "
                f"`{active['project']}` @ `{active.get('branch', 'main')}`."
            )
            if detected:
                msg += (
                    f"\nDetected commands: build=`{detected.get('build_cmd', '')}` "
                    f"test=`{detected.get('test_cmd', '')}` run=`{detected.get('run_cmd', '')}`"
                )
            await _send_system_message(channel, msg)
            await manager.broadcast(channel, {"type": "project_switched", "active": active})
            return True
        if action == "status":
            status = await project_manager.get_project_status(channel)
            active = status["active"]
            await _send_system_message(
                channel,
                f"Active project: `{active['project']}` @ `{active.get('branch', 'main')}` at `{active['path']}`\n"
                f"Known projects ({status['projects_count']}): {', '.join(status['known_projects']) or '(none)'}",
            )
            return True
        if action == "delete":
            if len(parts) < 3:
                raise ValueError("Usage: /project delete <name> [--confirm <token>]")
            name = parts[2]
            token = None
            if "--confirm" in parts:
                idx = parts.index("--confirm")
                if idx + 1 < len(parts):
                    token = parts[idx + 1]
            result = await project_manager.delete_project(name, confirm_token=token)
            if result.get("requires_confirmation"):
                await _send_system_message(
                    channel,
                    f"{result['warning']}\n"
                    f"Run: `/project delete {name} --confirm {result['confirm_token']}`",
                )
            else:
                await _send_system_message(channel, f"Deleted project `{name}`.")
            return True
    except ValueError as exc:
        await _send_system_message(channel, f"Project command error: {exc}")
        return True

    await _send_system_message(channel, f"Unknown project action: `{action}`.")
    return True


async def _handle_build_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not (raw.startswith("/build") or raw.startswith("/test") or raw.startswith("/run")):
        return False

    active = await project_manager.get_active_project(channel)
    project_name = active["project"]

    if raw.startswith("/build config"):
        cfg = build_runner.get_build_config(project_name)
        await _send_system_message(
            channel,
            f"Build config for `{project_name}`:\n"
            f"- build: `{cfg.get('build_cmd', '')}`\n"
            f"- test: `{cfg.get('test_cmd', '')}`\n"
            f"- run: `{cfg.get('run_cmd', '')}`",
        )
        return True

    prefix_map = {
        "/build set-build ": "build_cmd",
        "/build set-test ": "test_cmd",
        "/build set-run ": "run_cmd",
    }
    for prefix, key in prefix_map.items():
        if raw.startswith(prefix):
            cmd = raw[len(prefix):].strip()
            cfg = build_runner.set_build_config(project_name, {key: cmd})
            await _send_system_message(channel, f"Updated `{key}` for `{project_name}` to `{cfg.get(key, '')}`.")
            return True

    if raw == "/build run":
        result = build_runner.run_build(project_name)
        await _send_system_message(channel, _format_runner_result("build", result), msg_type="tool_result")
        await manager.broadcast(channel, {"type": "build_result", "stage": "build", "result": result})
        return True
    if raw == "/test run":
        result = build_runner.run_test(project_name)
        await _send_system_message(channel, _format_runner_result("test", result), msg_type="tool_result")
        await manager.broadcast(channel, {"type": "build_result", "stage": "test", "result": result})
        return True
    if raw == "/run start":
        result = build_runner.run_start(project_name)
        await _send_system_message(channel, _format_runner_result("run", result), msg_type="tool_result")
        await manager.broadcast(channel, {"type": "build_result", "stage": "run", "result": result})
        return True

    await _send_system_message(
        channel,
        "Build command usage:\n"
        "`/build config`, `/build set-build <cmd>`, `/build set-test <cmd>`, `/build set-run <cmd>`, "
        "`/build run`, `/test run`, `/run start`",
    )
    return True


async def _handle_work_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/work"):
        return False

    from .autonomous_worker import approve_current_gate, get_work_status, start_work, stop_work

    tokens = raw.split()
    action = tokens[1].strip().lower() if len(tokens) > 1 else "status"
    approved = any(token in {"--approve", "--go"} for token in tokens[2:])
    auto_proceed = any(token in {"--always", "--auto"} for token in tokens[2:])
    if action == "start":
        status = start_work(channel, approved=approved)
        if status.get("awaiting_approval"):
            await _send_system_message(
                channel,
                "Autonomous work requires explicit approval. Run `/work start --approve` to proceed.",
            )
        else:
            await _send_system_message(channel, f"Autonomous work started for `{channel}`.")
        await manager.broadcast(channel, {"type": "work_status", "status": status})
        return True
    if action == "stop":
        status = stop_work(channel)
        await _send_system_message(channel, f"Autonomous work stopped for `{channel}`.")
        await manager.broadcast(channel, {"type": "work_status", "status": status})
        return True
    if action == "approve":
        status = approve_current_gate(channel, auto_proceed=auto_proceed)
        if status.get("phase") == "approval" and status.get("running"):
            await _send_system_message(
                channel,
                "Autonomous worker approved and started.",
            )
        elif status.get("reason") == "no_gate_pending":
            await _send_system_message(
                channel,
                "No task gate is currently waiting for approval.",
            )
        else:
            suffix = " Auto-proceed enabled for this session." if auto_proceed else ""
            await _send_system_message(channel, f"Gate approved for current task.{suffix}")
        await manager.broadcast(channel, {"type": "work_status", "status": status})
        return True

    status = get_work_status(channel)
    await _send_system_message(
        channel,
        (
            f"Work status: running={status.get('running')} phase={status.get('phase')} "
            f"awaiting_approval={status.get('awaiting_approval')} "
            f"processed={status.get('processed')} errors={status.get('errors')}"
        ),
    )
    return True


async def _handle_git_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/git"):
        return False

    active = await project_manager.get_active_project(channel)
    project_name = active["project"]
    from . import git_tools

    if raw == "/git status":
        result = git_tools.status(project_name)
        await _send_system_message(channel, _format_runner_result("git status", result), msg_type="tool_result")
        return True
    if raw == "/git log":
        result = git_tools.log(project_name)
        await _send_system_message(channel, _format_runner_result("git log", result), msg_type="tool_result")
        return True
    if raw.startswith("/git commit "):
        message = raw[len("/git commit "):].strip()
        result = git_tools.commit(project_name, message)
        await _send_system_message(channel, _format_runner_result("git commit", result), msg_type="tool_result")
        return True
    if raw.startswith("/git branch "):
        name = raw[len("/git branch "):].strip()
        result = git_tools.branch(project_name, name)
        if result.get("ok"):
            current = result.get("current_branch") or git_tools.current_branch(project_name) or name
            await project_manager.set_active_branch(channel, project_name, current)
            await manager.broadcast(channel, {"type": "project_switched", "active": await project_manager.get_active_project(channel)})
        await _send_system_message(channel, _format_runner_result("git branch", result), msg_type="tool_result")
        return True

    await _send_system_message(channel, "Git command usage: `/git status`, `/git log`, `/git commit <msg>`, `/git branch <name>`")
    return True


async def _handle_export_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if raw != "/export":
        return False

    active = await project_manager.get_active_project(channel)
    root = Path(active["path"])
    exports = root / "docs" / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = exports / f"{channel}-{stamp}.md"

    messages = await get_messages(channel, limit=1000)
    lines = [f"# Conversation Export: {channel}", ""]
    for msg in messages:
        lines.append(f"- [{msg.get('created_at', '')}] **{msg.get('sender', '')}**")
        lines.append("")
        lines.append(msg.get("content", ""))
        lines.append("")
    target.write_text("\n".join(lines), encoding="utf-8")
    await _send_system_message(channel, f"Conversation exported to `{target}`.")
    return True


async def _handle_branch_merge_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    active = await project_manager.get_active_project(channel)
    project_name = active["project"]
    from . import git_tools

    if raw == "/branch":
        result = git_tools.list_branches(project_name)
        if result.get("ok"):
            active_branch = await project_manager.get_active_branch(channel, project_name)
            branches = ", ".join(result.get("branches", [])) or "(none)"
            await _send_system_message(
                channel,
                f"Project `{project_name}` branches: {branches}\n"
                f"Active channel branch: `{active_branch}`",
                msg_type="tool_result",
            )
        else:
            await _send_system_message(channel, _format_runner_result("branch list", result), msg_type="tool_result")
        return True

    if raw.startswith("/branch "):
        name = raw[len("/branch "):].strip()
        result = git_tools.branch(project_name, name)
        if result.get("ok"):
            current = result.get("current_branch") or git_tools.current_branch(project_name) or name
            await project_manager.set_active_branch(channel, project_name, current)
            await manager.broadcast(channel, {"type": "project_switched", "active": await project_manager.get_active_project(channel)})
        await _send_system_message(channel, _format_runner_result("branch", result), msg_type="tool_result")
        return True

    if raw.startswith("/merge "):
        branch_name = raw[len("/merge "):].strip()
        result = git_tools.merge(project_name, branch_name)
        await _send_system_message(channel, _format_runner_result("merge", result), msg_type="tool_result")
        return True

    return False


def _format_runner_result(stage: str, result: dict) -> str:
    if result.get("ok"):
        out = (result.get("stdout") or "").strip()
        if len(out) > 1200:
            out = out[:1200] + "\n... (truncated)"
        return (
            f"✅ `{stage}` passed for `{result.get('project', '')}` "
            f"(exit {result.get('exit_code')}, {result.get('duration_ms')} ms)\n"
            f"```text\n{out}\n```"
        )
    err = result.get("error") or result.get("stderr") or "Unknown error"
    if len(err) > 1200:
        err = err[:1200] + "\n... (truncated)"
    return (
        f"❌ `{stage}` failed for `{result.get('project', '')}` "
        f"(exit {result.get('exit_code')})\n"
        f"```text\n{err}\n```"
    )


async def _api_budget_state(channel: str, project_name: str) -> dict:
    raw = await get_setting("api_budget_usd")
    if raw is None:
        raw = os.environ.get("API_USAGE_BUDGET_USD", "").strip()
    try:
        budget = float(raw) if raw else 0.0
    except Exception:
        budget = 0.0
    usage = await get_api_usage_summary(channel=channel, project_name=project_name)
    total = float(usage.get("total_estimated_cost", 0.0) or 0.0)
    return {"budget_usd": budget, "used_usd": total, "remaining_usd": max(0.0, budget - total)}


def _deterministic_vote(title: str, options: list[str], voters: list[str]) -> dict:
    tally = {opt: 0 for opt in options}
    ballots = {}
    for voter in voters:
        seed = sum(ord(ch) for ch in f"{title}|{voter}") + len(options) * 17
        idx = seed % len(options)
        choice = options[idx]
        tally[choice] += 1
        ballots[voter] = choice
    winner = sorted(options, key=lambda opt: (-tally[opt], options.index(opt)))[0]
    return {"tally": tally, "ballots": ballots, "winner": winner}


def _pick_brainstorm_agents(active_ids: list[str]) -> list[str]:
    if not active_ids:
        return []

    preferred = ["spark", "architect", "uiux", "lore", "sage"]
    chosen: list[str] = []
    for agent_id in preferred:
        if agent_id in active_ids and agent_id not in chosen:
            chosen.append(agent_id)

    wildcards = [aid for aid in active_ids if aid not in chosen and aid != "router"]
    random.shuffle(wildcards)
    target = min(6, max(5, len(chosen)))
    target = min(target, len(active_ids))
    while len(chosen) < target and wildcards:
        chosen.append(wildcards.pop(0))

    if "spark" in active_ids and "spark" not in chosen:
        chosen.insert(0, "spark")

    return chosen[:6]


async def _fetch_brainstorm_votes(channel: str, idea_ids: list[int]) -> list[dict]:
    if not idea_ids:
        return []
    placeholders = ",".join("?" for _ in idea_ids)
    params = [channel, *idea_ids]
    db = await get_db()
    try:
        rows = await db.execute(
            f"""
            SELECT
              m.id,
              m.sender,
              m.content,
              SUM(CASE WHEN r.emoji IN ('👍', ':+1:') THEN 1 ELSE 0 END) AS upvotes
            FROM messages m
            LEFT JOIN message_reactions r ON r.message_id = m.id
            WHERE m.channel = ? AND m.id IN ({placeholders})
            GROUP BY m.id, m.sender, m.content
            ORDER BY upvotes DESC, m.id ASC
            """
            ,
            tuple(params),
        )
        items = [dict(r) for r in await rows.fetchall()]
        for item in items:
            item["upvotes"] = int(item.get("upvotes") or 0)
        return items
    finally:
        await db.close()


async def _summarize_brainstorm(channel: str, mode: dict) -> str:
    idea_ids = mode.get("idea_message_ids", []) or []
    ideas = await _fetch_brainstorm_votes(channel, idea_ids)
    if not ideas:
        return (
            "Brainstorm mode ended.\n"
            "No idea messages were recorded for vote summary this round."
        )

    lines = ["💡 Brainstorm stopped. Top-voted ideas:"]
    for idx, item in enumerate(ideas[:5], start=1):
        sender_name = AGENT_NAMES.get(item.get("sender", ""), item.get("sender", "agent"))
        snippet = (item.get("content", "") or "").replace("\n", " ").strip()
        if len(snippet) > 170:
            snippet = snippet[:167] + "..."
        lines.append(f"{idx}. {sender_name} ({item['upvotes']} 👍) - {snippet}")

    winner = ideas[0]
    winner_name = AGENT_NAMES.get(winner.get("sender", ""), winner.get("sender", "agent"))
    lines.append("")
    lines.append(
        f"Winner: {winner_name} with {winner['upvotes']} 👍. "
        "Say `create task from brainstorm winner` and I will convert it into a project task."
    )
    return "\n".join(lines)


async def _run_brainstorm_round(channel: str, agent_ids: list[str]):
    if channel in _active and _active[channel]:
        _active[channel] = False
        await asyncio.sleep(0.1)

    _active[channel] = True
    _msg_count[channel] = 0
    idea_ids: list[int] = []
    message_count = 0

    try:
        for agent_id in agent_ids:
            mode = _collab_mode.get(channel) or {}
            if not mode.get("active") or mode.get("mode") != "brainstorm":
                break

            agent = await get_agent(agent_id)
            if not agent or not agent.get("active"):
                continue

            await _typing(agent, channel)
            response = await _generate(agent, channel, is_followup=False)
            if not response or response.strip().upper() == "PASS":
                continue

            saved = await _send(agent, channel, response, run_post_checks=False)
            idea_ids.append(saved["id"])
            message_count += 1
            _msg_count[channel] = message_count
            await asyncio.sleep(PAUSE_BETWEEN_AGENTS)
    finally:
        _active.pop(channel, None)
        _msg_count.pop(channel, None)

    mode = _collab_mode.get(channel)
    if mode and mode.get("active") and mode.get("mode") == "brainstorm":
        existing = mode.get("idea_message_ids", []) or []
        mode["idea_message_ids"] = existing + idea_ids
        mode["last_round_ids"] = idea_ids
        mode["updated_at"] = int(time.time())
        _collab_mode[channel] = mode

    await _send_system_message(
        channel,
        "💡 Round complete! React with 👍 to your favorites. "
        "Say `/brainstorm` for another round, or `/brainstorm stop` to end.",
    )


async def _handle_brainstorm_command(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if not raw.startswith("/brainstorm"):
        return False

    arg = raw[len("/brainstorm"):].strip()
    if arg.lower() in {"stop", "off", "end"}:
        mode = _collab_mode.get(channel)
        if not mode or mode.get("mode") != "brainstorm" or not mode.get("active"):
            await _send_system_message(channel, "Brainstorm mode is not active.")
            return True

        summary = await _summarize_brainstorm(channel, mode)
        _collab_mode.pop(channel, None)
        await _send_system_message(channel, summary, msg_type="decision")
        return True

    topic = arg or "open-ended product ideas"
    active_agents = await get_agents(active_only=True)
    active_ids = [a["id"] for a in active_agents if a["id"] != "router"]
    chosen = _pick_brainstorm_agents(active_ids)
    if not chosen:
        await _send_system_message(channel, "No active agents available for brainstorm mode.")
        return True

    previous = _collab_mode.get(channel) or {}
    round_no = int(previous.get("round", 0) or 0) + 1
    _collab_mode[channel] = {
        "active": True,
        "mode": "brainstorm",
        "topic": topic,
        "round": round_no,
        "agent_ids": chosen,
        "idea_message_ids": previous.get("idea_message_ids", []) or [],
        "updated_at": int(time.time()),
    }

    selected_names = ", ".join(AGENT_NAMES.get(aid, aid) for aid in chosen)
    await _send_system_message(
        channel,
        f"💡 BRAINSTORM MODE — Topic: {topic}. Each agent will pitch ONE idea. "
        f"Upvote the best ones with 👍.\nRound {round_no} agents: {selected_names}",
    )
    asyncio.create_task(_run_brainstorm_round(channel, chosen))
    return True


async def _handle_meeting_or_vote(channel: str, user_message: str) -> bool:
    raw = user_message.strip()
    if raw.startswith("/meeting"):
        arg = raw[len("/meeting"):].strip()
        if arg.lower() in {"off", "stop", "end"}:
            _collab_mode.pop(channel, None)
            await _send_system_message(channel, "Meeting mode ended.")
            return True

        topic = arg or "Team sync"
        _collab_mode[channel] = {
            "active": True,
            "mode": "meeting",
            "topic": topic,
            "updated_at": int(time.time()),
        }
        agenda = (
            f"Meeting mode started for `{topic}`.\n"
            "Format:\n"
            "1. Goal\n"
            "2. Constraints\n"
            "3. Risks\n"
            "4. Decision proposal\n"
            "5. Action owners"
        )
        await _send_system_message(channel, agenda)
        return True

    if raw.startswith("/vote"):
        payload = raw[len("/vote"):].strip()
        if not payload:
            await _send_system_message(channel, "Usage: /vote <title> | <option A> | <option B> [| <option C> ...]")
            return True

        parts = [p.strip() for p in payload.split("|") if p.strip()]
        title = parts[0]
        options = parts[1:] if len(parts) > 1 else ["yes", "no"]
        if len(options) < 2:
            options = ["yes", "no"]

        candidate_voters = ["director", "architect", "reviewer", "sage", "codex", "producer"]
        active_agents = await get_agents(active_only=True)
        active_ids = {a["id"] for a in active_agents}
        voters = [v for v in candidate_voters if v in active_ids] or sorted(active_ids)[:4]

        outcome = _deterministic_vote(title, options, voters)
        rationale = " | ".join(f"{opt}: {count}" for opt, count in outcome["tally"].items())
        await record_decision(
            title=f"vote:{title}",
            description=f"Winner: {outcome['winner']}",
            decided_by="vote",
            rationale=rationale,
        )
        _collab_mode[channel] = {
            "active": True,
            "mode": "vote",
            "topic": title,
            "winner": outcome["winner"],
            "updated_at": int(time.time()),
        }
        lines = [
            f"Vote: `{title}`",
            f"Options: {', '.join(options)}",
            f"Voters: {', '.join(voters)}",
            f"Winner: **{outcome['winner']}**",
            "Tally:",
        ]
        for opt in options:
            lines.append(f"- {opt}: {outcome['tally'].get(opt, 0)}")
        await _send_system_message(channel, "\n".join(lines), msg_type="decision")
        return True

    return False


async def _build_context(channel: str) -> str:
    """Build conversation context as natural chat transcript."""
    messages = await get_messages(channel, limit=CONTEXT_WINDOW)
    lines = []
    for msg in messages:
        if msg["sender"] == "user":
            name = "User"
        elif msg["sender"] == "system":
            name = "System"
        else:
            name = AGENT_NAMES.get(msg["sender"], msg["sender"])
        lines.append(f"{name}: {msg['content']}")
    return "\n\n".join(lines)


def _build_system(
    agent: dict,
    channel: str,
    is_followup: bool,
    project_root: Path,
    project_name: str,
    branch_name: str,
    file_context: str,
    assigned_tasks: list[dict],
    memory_entries: list[dict],
) -> str:
    """Build system prompt. Tells agent to be themselves, not a bot."""
    s = agent.get("system_prompt", "You are a helpful team member.")

    # CRITICAL: Read user messages
    s += "\n\n=== CRITICAL RULES ==="
    s += "\n1. READ THE USER'S MESSAGES CAREFULLY. The user is your boss. If they give direction, FOLLOW IT."
    s += "\n2. If the user corrects you or the team, ACKNOWLEDGE IT and CHANGE COURSE immediately."
    s += "\n3. Do NOT repeat ideas the user has already rejected."
    s += "\n4. Keep responses SHORT: 2-4 sentences for discussion. When BUILDING, focus on code output."
    s += "\n5. Write naturally — no name prefix, no brackets at the start."
    s += "\n6. Refer to teammates by name when relevant."
    s += "\n7. Codex is an additional technical teammate and can be asked for implementation help."
    s += "\n8. If anyone proposes a risky shortcut (skip tests, ignore security, hardcode secrets, bypass requirements), challenge it and propose a safer path."
    s += "\n9. Respectful disagreement is required when logic is weak. Do not rubber-stamp bad ideas."
    s += "\n10. NEVER respond with generic greetings like 'How can I help?' or 'What can I assist you with?' — you are a team member, not a customer service bot."
    s += "\n11. If the user says hi or asks how you're doing, respond IN CHARACTER with what you're actually working on or thinking about. Be specific to YOUR role."
    s += "\n12. NEVER use the same phrasing as another team member. Read their messages above and say something DIFFERENT."
    s += "\n13. In group conversations, RESPOND TO what others said — agree, disagree, build on it. Don't just give your own unrelated take."
    s += "\n\n=== ACTION BIAS (MOST IMPORTANT) ==="
    s += "\nWhen the user says 'make it', 'build it', 'do it', 'create it', 'go', 'start', 'let's go', or any action command:"
    s += "\n- DO NOT just plan or discuss. Actually USE YOUR TOOLS to create files, write code, create tasks."
    s += "\n- If you are a builder/coder: USE [TOOL:write] to write actual code files. Not descriptions of code. ACTUAL CODE."
    s += "\n- If you are a designer: USE [TOOL:write] to create actual mockup files or component code."
    s += "\n- If you are a manager: USE [TOOL:task] to create actual tasks on the board."
    s += "\n- NEVER say 'let me schedule a call' or 'let's set up a meeting' — this is a chat app, not an office. Just DO THE WORK HERE."
    s += "\n- NEVER say 'I will do X' without actually doing X in the same message using tools."
    s += "\n- The user wants RESULTS, not plans. Plans are worthless without execution."

    if agent.get("id") in {"reviewer", "sage", "codex", "critic"}:
        s += "\n\n=== CRITICAL VOICE MODE ==="
        s += "\nYou are expected to push back on weak, unsafe, or low-evidence decisions."
        s += "\nBe specific about failure mode, then offer the smallest safe alternative."
        s += "\nIf others are agreeing too quickly, you MUST introduce a concrete risk check."

    if agent.get("id") == "director":
        s += "\n\n=== LEADERSHIP CHECK ==="
        s += "\nBefore finalizing high-impact decisions, request at least one risk review from Rex, Sage, Codex, or Vera."
        s += "\nDo not force consensus without a trade-off summary."

    if agent.get("id") in {"builder", "codex"}:
        s += "\n\n=== BUILDER MODE ==="
        s += "\nYou are a CODER. Your job is to WRITE CODE, not talk about code."
        s += "\nWhen the user or team decides to build something, you MUST immediately start writing files:"
        s += "\n  1. Create the project structure with [TOOL:write] for each file"
        s += "\n  2. Write REAL, WORKING code — not pseudocode or placeholders"
        s += "\n  3. After writing, use [TOOL:run] to verify it compiles/works"
        s += "\nIf someone says 'make it' or 'build it' or 'go' or 'start building', that means WRITE CODE NOW."
        s += "\nA response without [TOOL:write] or [TOOL:run] is a FAILURE when you're asked to build."

    if agent.get("id") == "architect":
        s += "\n\n=== ARCHITECT MODE ==="
        s += "\nWhen the team is building, sketch the file structure and key interfaces using [TOOL:write]."
        s += "\nCreate actual skeleton files, not just descriptions."

    if agent.get("id") == "producer":
        s += "\n\n=== PRODUCER MODE ==="
        s += "\nWhen the team decides to build, create actual [TOOL:task] entries to track work."
        s += "\nDo NOT suggest meetings or calls. This is async chat — coordinate HERE."
        s += "\nNEVER say 'let's schedule a call' or 'let's set up a meeting'."

    if is_followup:
        s += "\n\n=== FOLLOWUP RULES ==="
        s += "\nOnly speak if you have something NEW to add. A different angle, question, or concern."
        s += "\nIf you have nothing new, respond with exactly: PASS"
        s += "\nDo NOT just agree or restate what others said. Do NOT be sycophantic."
        s += "\nIf the latest proposal sounds risky or sloppy, challenge it explicitly."
        s += "\nRead all messages above. If someone already said X, do NOT repeat it. React to what THEY said."
        s += "\nYou MUST reference at least one teammate by name in every follow-up response."
        s += "\nIf all previous agents agreed, challenge at least one assumption."

    # Tool instructions
    perms = agent.get("permissions", "read")
    if perms in ("read", "run", "write"):
        s += "\n\n=== TOOLS ==="
        s += "\n  [TOOL:read] path/to/file — Read a file"
        s += "\n  [TOOL:search] *.py — Search for files"
        s += "\n  [TOOL:task] Task title | assigned_to — Create a task on the board"
        if perms in ("run", "write"):
            s += "\n  [TOOL:run] command — Run a command (pytest, git status, etc)"
            s += "\n  [TOOL:run] @client npm run build — Run in a subdirectory (prefix with @folder)"
        if perms == "write":
            s += "\n  [TOOL:write] path/to/file"
            s += "\n  ```"
            s += "\n  file content here"
            s += "\n  ```"
            s += "\n  IMPORTANT: You MUST include the ``` content block when writing files."
        s += "\nUse [TOOL:task] to create real tasks on the task board when work is planned."
        s += "\nDon't just say 'I'll create a task' — actually use [TOOL:task] to create it."
        s += "\nDon't just say 'I'll write the code' — actually use [TOOL:write] to write it NOW."
        s += "\nTALKING about work is NOT the same as DOING work. Use your tools."
        s += f"\nFile paths are relative to `{project_root}`."
        s += "\nReal project files:"
        s += f"\n```\n{_get_project_tree(project_root)}\n```"
        s += "\nOnly reference files that exist above, or create new ones with [TOOL:write]."
        if branch_name:
            s += f"\nCurrent git branch: `{branch_name}`."

    mode = _collab_mode.get(channel)
    if mode and mode.get("active"):
        s += "\n\n=== COLLAB MODE ==="
        s += f"\nMode: {mode.get('mode', 'chat')}"
        if mode.get("topic"):
            s += f"\nTopic: {mode['topic']}"
        if mode.get("mode") == "brainstorm":
            topic = mode.get("topic", "open-ended ideas")
            s += (
                "\nBRAINSTORM MODE: Pitch exactly ONE idea related to "
                f"{topic}. Be specific and creative. Think from YOUR role's perspective. "
                "Keep it to 2-3 sentences. Do NOT agree with others - pitch something DIFFERENT."
            )
        if mode.get("mode") == "warroom":
            issue = mode.get("issue") or mode.get("topic") or "critical issue"
            s += (
                "\nWAR ROOM MODE. Focus ONLY on fixing "
                f"{issue}. No brainstorming, no new features. "
                "Steps: reproduce -> diagnose -> fix -> verify."
            )
        if mode.get("mode") == "meeting":
            s += "\nUse structured bullets with Goal, Risks, and Action."
        if mode.get("mode") == "vote":
            s += "\nState one clear option recommendation and rationale."

    if assigned_tasks:
        s += "\n\n=== ASSIGNED TASKS (non-done) ==="
        for task in assigned_tasks[:8]:
            s += (
                f"\n- #{task.get('id')} [{task.get('status')}] "
                f"{task.get('title')} (priority {task.get('priority', 0)})"
            )
        s += "\nUse [TASK:start] / [TASK:done] / [TASK:blocked] tags when task status changes."

    if file_context:
        s += "\n\n=== FILE CONTEXT ==="
        s += "\nIntegrate with these existing files; do not hallucinate missing files."
        s += f"\n```text\n{file_context}\n```"

    if memory_entries:
        mem_text = "\n".join(f"- {m.get('content', '')}" for m in memory_entries[-10:])
        s += "\n\n=== KNOWN CONTEXT ==="
        s += f"\nProject: `{project_name}`"
        s += f"\n{mem_text}"

    return s


async def _generate(agent: dict, channel: str, is_followup: bool = False) -> Optional[str]:
    """Generate one agent's response. Routes to Ollama or Claude based on backend."""
    if _is_war_room_suppressed(channel, agent["id"]):
        return None

    context = await _build_context(channel)
    active_project = await project_manager.get_active_project(channel)
    project_name = active_project["project"]
    project_root = Path(active_project["path"])
    branch_name = (
        (active_project.get("branch") or "").strip()
        or git_tools.current_branch(project_name)
        or "main"
    )
    file_context = await _build_file_context(channel, context[-1200:], agent)
    assigned_tasks = await get_tasks_for_agent(
        agent["id"],
        branch=branch_name,
        channel=channel,
        project_name=project_name,
    )
    memory_entries = get_known_context(
        active_project["project"],
        agent["id"],
        query_hint=context[-400:],
        limit=12,
    )
    system = _build_system(
        agent,
        channel,
        is_followup,
        project_root=project_root,
        project_name=active_project["project"],
        branch_name=branch_name,
        file_context=file_context,
        assigned_tasks=assigned_tasks,
        memory_entries=memory_entries,
    )

    # Find latest user message to highlight
    messages = await get_messages(channel, limit=CONTEXT_WINDOW)
    latest_user_msg = None
    latest_user_index = -1
    for idx in range(len(messages) - 1, -1, -1):
        msg = messages[idx]
        if msg["sender"] == "user":
            latest_user_msg = msg["content"]
            latest_user_index = idx
            break

    teammate_messages = []
    if latest_user_index >= 0:
        for msg in messages[latest_user_index + 1:]:
            sender = msg.get("sender")
            if sender in {"user", "system", agent["id"]}:
                continue
            teammate_messages.append(msg)

    teammate_summary_lines = []
    for msg in teammate_messages[-5:]:
        sender_id = msg.get("sender", "")
        sender_name = AGENT_NAMES.get(sender_id, sender_id or "Teammate")
        teammate_summary_lines.append(f'{sender_name} said: "{_single_line_excerpt(msg.get("content", ""))}"')
    teammate_generic_count = sum(1 for msg in teammate_messages if _is_generic_agent_message(msg.get("content", "")))

    prompt = f"Here's the conversation so far:\n\n{context}\n\n"
    if latest_user_msg:
        prompt += f">>> THE USER'S LATEST MESSAGE (this is what you should respond to): \"{latest_user_msg}\"\n\n"
    if teammate_summary_lines:
        prompt += "=== WHAT YOUR TEAMMATES ALREADY SAID (DO NOT REPEAT) ===\n"
        prompt += "\n".join(teammate_summary_lines) + "\n"
        if teammate_generic_count >= 2:
            prompt += (
                "\nMultiple teammates already gave generic reactions. "
                "You MUST add a concrete role-specific detail, ask a concrete question, or respond with PASS.\n"
            )
        prompt += "If you have nothing meaningfully new to add, respond with: PASS\n===\n\n"
    prompt += (
        f"Now respond as {agent['display_name']}. Respond to the user and build on teammate context without repeating."
    )

    backend = agent.get("backend", "ollama")
    await emit_console_event(
        channel=channel,
        event_type="prompt",
        source="agent_engine",
        message=f"{agent['id']} generating via {backend}",
        project_name=active_project["project"],
        data={
            "agent_id": agent["id"],
            "backend": backend,
            "model": agent.get("model"),
            "followup": bool(is_followup),
            "branch": branch_name,
            "context_chars": len(context),
            "file_context_chars": len(file_context or ""),
            "task_count": len(assigned_tasks or []),
        },
    )

    try:
        started_at = time.time()
        if backend in {"claude", "openai"}:
            budget_state = await _api_budget_state(channel, active_project["project"])
            budget = budget_state["budget_usd"]
            used = budget_state["used_usd"]
            if budget > 0 and used >= budget:
                return (
                    f"API budget cap reached (${budget:.2f}). "
                    f"Current estimated usage is ${used:.2f}. "
                    "Please raise budget or switch this task to local models."
                )
        if backend == "claude":
            response = await claude_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.7,
                max_tokens=600,
                model=agent.get("model", "claude-sonnet-4-20250514"),
                channel=channel,
                project_name=active_project["project"],
            )
        elif backend == "openai":
            response = await openai_adapter.generate(
                prompt=prompt,
                system=system,
                temperature=0.7,
                max_tokens=600,
                model=agent.get("model", "gpt-4o-mini"),
                channel=channel,
                project_name=active_project["project"],
            )
        else:
            response = await ollama_client.generate(
                model=agent["model"],
                prompt=prompt,
                system=system,
                temperature=0.75,
                max_tokens=400,
            )
        elapsed_ms = int((time.time() - started_at) * 1000)
        await emit_console_event(
            channel=channel,
            event_type="model_response",
            source="agent_engine",
            message=f"{agent['id']} response received",
            project_name=active_project["project"],
            data={
                "agent_id": agent["id"],
                "backend": backend,
                "model": agent.get("model"),
                "latency_ms": elapsed_ms,
                "response_chars": len(response or ""),
            },
        )
        if not response:
            return None

        # Clean up
        response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()

        # Strip self-prefixing like "[producer]:" or "Pam:" or "**Pam**:"
        name = agent["display_name"]
        for prefix in [f"[{agent['id']}]: ", f"[{agent['id']}]:", f"{name}: ", f"{name}:", f"**{name}**: ", f"**{name}**:"]:
            if response.startswith(prefix):
                response = response[len(prefix):].strip()

        if response.upper().strip() in ("PASS", "[PASS]", "PASS."):
            return None
        # Strip leading PASS if followed by real content
        if response.upper().startswith("PASS"):
            response = re.sub(r'^PASS\.?\s*\n*', '', response, flags=re.IGNORECASE).strip()
            if not response or len(response) < 3:
                return None
        # Strip trailing PASS
        response = re.sub(r'\n\s*PASS\.?\s*$', '', response, flags=re.IGNORECASE).strip()
        if not response or len(response) < 3:
            return None

        if teammate_messages:
            teammate_texts = [m.get("content", "") for m in teammate_messages]
            if _too_similar_to_previous(response, teammate_texts):
                return None
            if teammate_generic_count >= 2 and _is_generic_agent_message(response):
                return None

        if is_followup:
            recent_agent_messages = [
                m for m in messages
                if m.get("sender") not in {"user", "system"} and m.get("sender") != agent["id"]
            ][-8:]
            response = _enforce_followup_constraints(agent["id"], response, recent_agent_messages).strip()
            if response.upper() == "PASS" or len(response) < 3:
                return None

        return response.strip()
    except Exception as e:
        logger.error(f"Agent {agent['id']} failed: {e}")
        await emit_console_event(
            channel=channel,
            event_type="model_error",
            source="agent_engine",
            message=str(e),
            project_name=active_project["project"],
            severity="error",
            data={"agent_id": agent["id"], "backend": backend},
        )
        return None


async def _run_build_test_loop(agent: dict, channel: str) -> None:
    await verification_loop.run_post_write_verification(
        agent=agent,
        channel=channel,
        max_attempts=BUILD_FIX_MAX_ATTEMPTS,
        format_result=_format_runner_result,
        send_system_message=_send_system_message,
        generate_fix_response=lambda a, ch: _generate(a, ch, is_followup=True),
        send_agent_message=lambda a, ch, content: _send(a, ch, content, run_post_checks=False),
        reset_agent_failure=_reset_agent_failure,
        maybe_escalate_to_nova=_maybe_escalate_to_nova,
        enter_war_room=lambda ch, issue, trigger: _enter_war_room(ch, issue, trigger),
        exit_war_room=lambda ch, reason, resolved_by: _exit_war_room(ch, reason, resolved_by),
        war_room_active=lambda ch: _war_room_mode(ch) is not None,
    )


async def _send(
    agent: dict,
    channel: str,
    content: str,
    run_post_checks: bool = True,
    format_retry: bool = False,
):
    """Save + broadcast an agent message, then execute any tool calls."""
    saved = await insert_message(channel=channel, sender=agent["id"], content=content, msg_type="message")
    await manager.broadcast(channel, {"type": "chat", "message": saved})
    logger.info(f"  [{agent['display_name']}] {content[:80]}")
    if (
        _war_room_mode(channel)
        and agent["id"] == "director"
        and "resolved" in (content or "").lower()
    ):
        await _exit_war_room(channel, reason="Nova marked the issue resolved", resolved_by=agent["display_name"])

    # Check for tool calls in the message
    tool_calls = parse_tool_calls(content)
    if tool_calls:
        invalid = []
        for call in tool_calls:
            ok, reason = validate_tool_call_format(call)
            if not ok:
                invalid.append((call, reason))
        if invalid:
            await emit_console_event(
                channel=channel,
                event_type="tool_format_invalid",
                source="agent_engine",
                message=f"{agent['id']} emitted invalid tool format",
                severity="warning",
                data={"agent_id": agent["id"], "errors": [item[1] for item in invalid]},
            )
            await _send_system_message(
                channel,
                "Tool format invalid. Output tool calls in valid format only, with required args and fenced blocks.",
                msg_type="system",
            )
            if not format_retry:
                repair = await _generate(agent, channel, is_followup=True)
                if repair:
                    await _send(
                        agent,
                        channel,
                        repair,
                        run_post_checks=False,
                        format_retry=True,
                    )
            return saved

        logger.info(f"  [{agent['display_name']}] executing {len(tool_calls)} tool call(s)")
        results = await execute_tool_calls(agent["id"], tool_calls, channel)
        successful_writes = [
            r for r in results
            if r.get("type") == "write"
            and (
                bool((r.get("result") or {}).get("ok"))
                or (r.get("result") or {}).get("action") == "written"
            )
        ]
        reviewable_paths = _extract_reviewable_write_paths(successful_writes)
        if reviewable_paths:
            await _maybe_run_auto_code_review(channel, agent, reviewable_paths)
        if run_post_checks and successful_writes:
            await _run_build_test_loop(agent, channel)

    return saved


async def _typing(agent: dict, channel: str):
    """Show typing indicator."""
    await manager.broadcast(channel, {
        "type": "typing",
        "agent_id": agent["id"],
        "display_name": agent["display_name"],
    })


def _mentions(text: str) -> list[str]:
    """Find agent names mentioned in text."""
    found = []
    lower = text.lower()
    for aid, name in AGENT_NAMES.items():
        if name.lower() in lower:
            found.append(aid)
    return found


def _invites_response(text: str) -> bool:
    """Does this message invite others to respond?"""
    triggers = [
        "?", "thoughts", "think", "ideas", "what do you",
        "anyone", "team", "everyone", "how about", "what if",
        "could we", "should we", "let's", "suggest", "opinion",
        "agree", "disagree", "feedback", "input", "weigh in",
        "what about", "right?", "guys",
    ]
    lower = text.lower()
    return any(t in lower for t in triggers)


_SIMILARITY_STOP_WORDS = {
    "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "is", "it",
    "this", "that", "we", "should", "can", "be", "with", "about", "today",
}


def _token_signature(text: str) -> list[str]:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    tokens = [t for t in cleaned.split() if t and t not in _SIMILARITY_STOP_WORDS]
    return tokens[:60]


def _too_similar_to_previous(response: str, previous_texts: list[str]) -> bool:
    base_tokens = _token_signature(response)
    if not base_tokens:
        return False
    base_set = set(base_tokens)

    for prev in previous_texts:
        prev_tokens = _token_signature(prev)
        if not prev_tokens:
            continue
        prev_set = set(prev_tokens)
        overlap = len(base_set & prev_set) / max(1, len(base_set))
        if overlap >= 0.72:
            return True
        if " ".join(base_tokens[:20]) == " ".join(prev_tokens[:20]):
            return True
    return False


def _is_agreement_only(text: str) -> bool:
    lower = (text or "").lower()
    positive = ("agree", "sounds good", "great idea", "exactly", "yes", "aligned", "good plan")
    challenge = ("but", "however", "risk", "concern", "disagree", "challenge", "counter", "failure")
    has_positive = any(token in lower for token in positive)
    has_challenge = any(token in lower for token in challenge)
    return has_positive and not has_challenge


def _all_previous_agents_agreed(recent_agent_messages: list[dict]) -> bool:
    if len(recent_agent_messages) < 2:
        return False
    unique_senders = {m.get("sender") for m in recent_agent_messages if m.get("sender")}
    if len(unique_senders) < 2:
        return False
    return all(_is_agreement_only(m.get("content", "")) for m in recent_agent_messages)


def _has_challenge_signal(text: str) -> bool:
    lower = (text or "").lower()
    return any(
        token in lower
        for token in ("disagree", "challenge", "risk", "concern", "failure mode", "counter", "however", "but")
    )


def _enforce_followup_constraints(agent_id: str, response: str, recent_agent_messages: list[dict]) -> str:
    text = (response or "").strip()
    if not text:
        return text

    reference_name = "team"
    if recent_agent_messages:
        reference_sender = recent_agent_messages[-1].get("sender", "")
        reference_name = AGENT_NAMES.get(reference_sender, reference_name)

    if _too_similar_to_previous(text, [m.get("content", "") for m in recent_agent_messages]):
        text = (
            f"{reference_name}, I do not want to repeat what is already said. "
            "The missing piece is one concrete risk check and one fallback path before we commit."
        )

    if _all_previous_agents_agreed(recent_agent_messages) and not _has_challenge_signal(text):
        text = (
            f"{reference_name}, I challenge the current consensus: we still need to name one failure mode "
            "and a safer fallback before deciding."
        )

    if not _mentions(text):
        if text[0].isalpha():
            text = f"{reference_name}, {text[0].lower() + text[1:]}"
        else:
            text = f"{reference_name}, {text}"

    return text


def _pick_next(last_sender: str, last_text: str, already_spoke: set) -> list[str]:
    """Pick who talks next. Only agents who were mentioned or have a specific reason to respond."""
    candidates = []

    # Mentioned agents always get to talk
    for aid in _mentions(last_text):
        if aid != last_sender and aid not in already_spoke:
            candidates.append(aid)

    # If someone was directly asked a question, only they respond
    # Do NOT randomly pull from the full agent pool — that causes snowball
    if _looks_risky(last_text) and not candidates:
        for counter_voice in ("reviewer", "sage", "critic"):
            if counter_voice != last_sender and counter_voice not in already_spoke and counter_voice not in candidates:
                candidates.insert(0, counter_voice)
                break

    if not candidates and len(already_spoke) >= 2 and _is_agreement_only(last_text):
        for counter_voice in ("critic", "reviewer", "sage", "codex"):
            if counter_voice != last_sender and counter_voice not in already_spoke and counter_voice not in candidates:
                candidates.append(counter_voice)
                break

    # Only add 1 random follow-up if nobody was mentioned AND the message
    # contains a genuine question directed at the team (not just "how can I help?")
    if not candidates and _invites_response(last_text):
        # Only pick from agents with a DIFFERENT role type than who already spoke
        technical = {"builder", "reviewer", "qa", "architect", "codex", "ops"}
        creative = {"spark", "lore", "art", "uiux"}
        management = {"producer", "director", "sage", "scribe", "critic"}
        
        spoke_types = set()
        for s in already_spoke:
            if s in technical: spoke_types.add("technical")
            if s in creative: spoke_types.add("creative")
            if s in management: spoke_types.add("management")
        
        # Pick from underrepresented type
        pool = []
        if "technical" not in spoke_types:
            pool = [a for a in technical if a not in already_spoke and a != last_sender]
        elif "management" not in spoke_types:
            pool = [a for a in management if a not in already_spoke and a != last_sender]
        
        if pool:
            random.shuffle(pool)
            candidates.append(pool[0])

    return candidates[:2]  # Max 2 follow-up agents per round


async def _check_interrupt(channel: str) -> bool:
    """Check if user interrupted. Returns True if interrupted."""
    return channel in _user_interrupt


async def _handle_interrupt(channel: str, spoke_set: set) -> int:
    """Handle user interrupt: re-route and respond to new message. Returns msg count."""
    new_msg = _user_interrupt.pop(channel)
    logger.info(f"⚡ User interrupt: {new_msg[:60]}")
    turn_policy = _turn_policy_for_message(new_msg)
    _channel_turn_policy[channel] = turn_policy
    if _war_room_mode(channel):
        active_agents = await get_agents(active_only=True)
        active_ids = {a["id"] for a in active_agents}
        new_agents = [aid for aid in WAR_ROOM_AGENT_ORDER if aid in active_ids]
    else:
        new_agents = await route(new_msg)
        new_agents = new_agents[: int(turn_policy.get("max_initial_agents", 3))]
    active_project = await project_manager.get_active_project(channel)
    await emit_console_event(
        channel=channel,
        event_type="router_decision",
        source="agent_engine",
        message="Router selected agents after user interrupt.",
        project_name=active_project["project"],
        data={"interrupt": True, "message": new_msg[:220], "agents": new_agents, "turn_policy": turn_policy},
    )
    spoke_set.clear()
    count = 0
    for aid in new_agents:
        if not _active.get(channel) or await _check_interrupt(channel):
            break
        agent = await get_agent(aid)
        if not agent or not agent.get("active"):
            continue
        await _typing(agent, channel)
        response = await _generate(agent, channel, is_followup=False)
        if response:
            await _send(agent, channel, response)
            _reset_agent_failure(channel, aid)
            spoke_set.add(aid)
            count += 1
            await asyncio.sleep(PAUSE_BETWEEN_AGENTS)
        else:
            if _is_war_room_suppressed(channel, aid):
                continue
            await _maybe_escalate_to_nova(
                channel,
                aid,
                "empty response after user interrupt",
                context=f"Interrupt message: {new_msg[:500]}",
            )
    return count


async def _respond_agents(channel: str, agent_ids: list[str], spoke_set: set, is_followup: bool = False) -> int:
    """Have a list of agents respond, checking for interrupts between each. Returns msg count."""
    count = 0
    for aid in agent_ids:
        if not _active.get(channel):
            return count
        # Check for interrupt BEFORE each agent responds
        if await _check_interrupt(channel):
            count += await _handle_interrupt(channel, spoke_set)
            return count

        agent = await get_agent(aid)
        if not agent or not agent.get("active"):
            continue
        await _typing(agent, channel)
        response = await _generate(agent, channel, is_followup=is_followup)
        if response:
            await _send(agent, channel, response)
            _reset_agent_failure(channel, aid)
            spoke_set.add(aid)
            count += 1
            await asyncio.sleep(PAUSE_BETWEEN_AGENTS)
        else:
            if _is_war_room_suppressed(channel, aid):
                continue
            escalated = await _maybe_escalate_to_nova(
                channel,
                aid,
                "empty or invalid response",
                context=f"Agent `{aid}` produced no response during {'follow-up' if is_followup else 'initial'} round.",
            )
            if escalated:
                break
    return count


async def _conversation_loop(channel: str, initial_agents: list[str]):
    """The living conversation. Agents respond, then react to each other."""
    count = 0
    _active[channel] = True
    _msg_count[channel] = 0

    try:
        spoke_this_convo = set()

        # ROUND 1: Initial responders (with interrupt checking between each)
        added = await _respond_agents(channel, initial_agents, spoke_this_convo, is_followup=False)
        count += added
        _msg_count[channel] = count

        # CONTINUATION ROUNDS
        consecutive_silence = 0
        max_silence = 2
        followup_rounds = 0

        while count < MAX_MESSAGES and _active.get(channel) and consecutive_silence < max_silence:
            turn_policy = _get_turn_policy(channel)
            max_followup_rounds = int(turn_policy.get("max_followup_rounds", MAX_FOLLOWUP_ROUNDS))
            max_followup_rounds = max(0, min(MAX_FOLLOWUP_ROUNDS, max_followup_rounds))
            if followup_rounds >= max_followup_rounds:
                break
            await asyncio.sleep(PAUSE_BETWEEN_ROUNDS)

            # Check for user interrupt
            if await _check_interrupt(channel):
                added = await _handle_interrupt(channel, spoke_this_convo)
                count += added
                _msg_count[channel] = count
                consecutive_silence = 0
                followup_rounds = 0  # Reset for new user message
                continue

            recent = await get_messages(channel, limit=3)
            if not recent:
                break

            last = recent[-1]

            # If user was last speaker, wait then respond
            if last["sender"] == "user":
                await asyncio.sleep(2)
                recent2 = await get_messages(channel, limit=1)
                if recent2 and recent2[-1]["sender"] == "user":
                    next_user_message = recent2[-1]["content"]
                    turn_policy = _turn_policy_for_message(next_user_message)
                    _channel_turn_policy[channel] = turn_policy
                    new_agents = await route(next_user_message)
                    new_agents = new_agents[: int(turn_policy.get("max_initial_agents", 3))]
                    spoke_this_convo.clear()
                    added = await _respond_agents(channel, new_agents, spoke_this_convo, is_followup=False)
                    count += added
                    _msg_count[channel] = count
                    consecutive_silence = 0
                    followup_rounds = 0  # Reset for new user message
                    continue

            # Pick who responds next
            next_agents = _pick_next(last["sender"], last["content"], spoke_this_convo)
            added = await _respond_agents(channel, next_agents, spoke_this_convo, is_followup=True)
            count += added
            _msg_count[channel] = count

            if added == 0:
                consecutive_silence += 1
                logger.info(f"Round quiet ({consecutive_silence}/{max_silence})")
            else:
                consecutive_silence = 0
                followup_rounds += 1
                logger.info(f"Follow-up round {followup_rounds}/{MAX_FOLLOWUP_ROUNDS}")

            # Distill every 8 messages
            if count % 8 == 0 and count > 0:
                try:
                    await maybe_distill(channel)
                except Exception:
                    pass

    except Exception as e:
        logger.error(f"Conversation loop error: {e}")
    finally:
        logger.info(f"Conversation ended: {count} messages in #{channel}")
        try:
            await maybe_distill(channel)
        except Exception:
            pass
        _active.pop(channel, None)
        _msg_count.pop(channel, None)


_user_msg_count: dict[str, int] = {}  # track user messages per channel for auto-naming
_named_channels: set = set()  # channels that have been auto-named


async def _auto_name_channel(channel: str):
    """After 3 user messages, auto-generate a topic name for the channel."""
    if channel in _named_channels or channel.startswith("dm:"):
        return

    count = _user_msg_count.get(channel, 0)
    if count < 3:
        return

    # Check if already named in DB
    existing = await get_channel_name(channel)
    if existing:
        _named_channels.add(channel)
        return

    # Get recent messages to summarize
    messages = await get_messages(channel, limit=10)
    if not messages:
        return

    transcript = "\n".join(f"{m['sender']}: {m['content'][:100]}" for m in messages)

    try:
        name = await ollama_client.generate(
            model="qwen3:1.7b",
            prompt=f"Read this conversation and write a SHORT topic name (3-6 words max, no quotes, no punctuation). Examples: 'Game Audio Architecture', 'Login Page Redesign', 'API Rate Limiting Plan'.\n\n{transcript}\n\n/no_think\nTopic name:",
            system="You generate short topic names. Reply with ONLY the topic name, nothing else. No quotes. No explanation.",
            temperature=0.3,
            max_tokens=20,
        )
        if name:
            name = name.strip().strip('"').strip("'").strip()
            # Remove think tags if present
            name = re.sub(r'<think>.*?</think>', '', name, flags=re.DOTALL).strip()
            if 2 < len(name) < 60:
                await set_channel_name(channel, name)
                _named_channels.add(channel)
                # Broadcast rename to all clients
                await manager.broadcast(channel, {
                    "type": "channel_rename",
                    "channel": channel,
                    "name": name,
                })
                logger.info(f"Auto-named #{channel} -> '{name}'")
    except Exception as e:
        logger.error(f"Auto-name failed: {e}")


async def process_message(channel: str, user_message: str):
    """Main entry: start or interrupt a conversation."""
    logger.info(f"Processing: [{channel}] {user_message[:80]}")

    if await _handle_project_command(channel, user_message):
        return
    if await _handle_build_command(channel, user_message):
        return
    if await _handle_work_command(channel, user_message):
        return
    if await _handle_sprint_command(channel, user_message):
        return
    if await _handle_git_command(channel, user_message):
        return
    if await _handle_branch_merge_command(channel, user_message):
        return
    if await _handle_export_command(channel, user_message):
        return
    if await _handle_review_command(channel, user_message):
        return
    if await _handle_warroom_command(channel, user_message):
        return
    if await _handle_brainstorm_command(channel, user_message):
        return
    if await _handle_oracle_command(channel, user_message):
        return
    if await _handle_meeting_or_vote(channel, user_message):
        return

    turn_policy = _turn_policy_for_message(user_message)
    _channel_turn_policy[channel] = turn_policy

    # Track user messages for auto-naming
    _user_msg_count[channel] = _user_msg_count.get(channel, 0) + 1
    asyncio.create_task(_auto_name_channel(channel))

    # DM: simple 1-on-1
    if channel.startswith("dm:"):
        agent_id = channel.replace("dm:", "")
        agent = await get_agent(agent_id)
        if not agent:
            return
        await _typing(agent, channel)
        response = await _generate(agent, channel)
        if response:
            await _send(agent, channel, response)
        try:
            await maybe_distill(channel)
        except Exception:
            pass
        return

    # Main room
    if channel in _active and _active[channel]:
        # Conversation running — interrupt it
        logger.info(f"User interrupt in #{channel}")
        _user_interrupt[channel] = user_message
        active_project = await project_manager.get_active_project(channel)
        await emit_console_event(
            channel=channel,
            event_type="user_interrupt",
            source="agent_engine",
            message="User interrupted active conversation.",
            project_name=active_project["project"],
            data={"message": user_message[:220]},
        )
        return

    # Start new conversation
    logger.info(f"New conversation in #{channel} ({turn_policy['complexity']})")
    mode = _war_room_mode(channel)
    if mode:
        active_agents = await get_agents(active_only=True)
        active_ids = {a["id"] for a in active_agents}
        initial_agents = [aid for aid in WAR_ROOM_AGENT_ORDER if aid in active_ids]
    else:
        initial_agents = await route(user_message)
        initial_agents = initial_agents[: int(turn_policy.get("max_initial_agents", 3))]
    logger.info(f"Initial agents: {initial_agents}")
    active_project = await project_manager.get_active_project(channel)
    await emit_console_event(
        channel=channel,
        event_type="router_decision",
        source="agent_engine",
        message="Router selected initial agents.",
        project_name=active_project["project"],
        data={"message": user_message[:220], "agents": initial_agents, "turn_policy": turn_policy},
    )
    asyncio.create_task(_conversation_loop(channel, initial_agents))


async def stop_conversation(channel: str) -> bool:
    """Force stop."""
    if channel in _active:
        _active[channel] = False
        logger.info(f"Force stopped #{channel}")
        return True
    return False


def get_conversation_status(channel: str) -> dict:
    collab = get_collab_mode_status(channel)
    return {
        "active": _active.get(channel, False),
        "message_count": _msg_count.get(channel, 0),
        "max_messages": MAX_MESSAGES,
        "collab_mode": collab.get("mode", "chat"),
        "collab_active": bool(collab.get("active")),
    }
