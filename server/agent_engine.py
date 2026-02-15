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
from pathlib import Path
from typing import Optional
from . import ollama_client
from .router_agent import route
from .database import (
    get_agent,
    get_agents,
    get_messages,
    insert_message,
    get_channel_name,
    set_channel_name,
    get_tasks_for_agent,
    record_decision,
    log_build_result,
    get_api_usage_summary,
    get_setting,
)
from .websocket import manager
from .memory import read_all_memory_for_agent
from .distiller import maybe_distill
from .tool_executor import parse_tool_calls, execute_tool_calls
from . import claude_adapter
from . import openai_adapter
from . import build_runner
from . import project_manager
from . import git_tools

logger = logging.getLogger("ai-office.engine")

CONTEXT_WINDOW = 20
MAX_MESSAGES = 1000
PAUSE_BETWEEN_AGENTS = 1.5  # seconds — feels natural
PAUSE_BETWEEN_ROUNDS = 3.0  # seconds — breathing room

# Active conversation tracking
_active: dict[str, bool] = {}
_msg_count: dict[str, int] = {}
_user_interrupt: dict[str, str] = {}
_collab_mode: dict[str, dict] = {}
_agent_failures: dict[str, dict[str, int]] = {}

BUILD_FIX_MAX_ATTEMPTS = 3
FAILURE_ESCALATION_THRESHOLD = 3

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

RISKY_SHORTCUT_TRIGGERS = (
    "skip test", "skip tests", "no tests", "without tests",
    "just ship", "ship now", "quick hack", "quick and dirty", "yolo",
    "hardcode", "hard-coded", "ignore security", "disable auth", "bypass auth",
    "push straight to prod", "temporary prod",
)


def _looks_risky(text: str) -> bool:
    lower = text.lower()
    return any(trigger in lower for trigger in RISKY_SHORTCUT_TRIGGERS)


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

    tasks = await get_tasks_for_agent(agent["id"])
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
            msg = f"Active project for `{channel}` is now `{active['project']}`."
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
                f"Active project: `{active['project']}` at `{active['path']}`\n"
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

    from .autonomous_worker import get_work_status, start_work, stop_work

    action = raw.split(maxsplit=1)[1].strip().lower() if len(raw.split()) > 1 else "status"
    if action == "start":
        status = start_work(channel)
        await _send_system_message(channel, f"Autonomous work started for `{channel}`.")
        await manager.broadcast(channel, {"type": "work_status", "status": status})
        return True
    if action == "stop":
        status = stop_work(channel)
        await _send_system_message(channel, f"Autonomous work stopped for `{channel}`.")
        await manager.broadcast(channel, {"type": "work_status", "status": status})
        return True

    status = get_work_status(channel)
    await _send_system_message(
        channel,
        f"Work status: running={status.get('running')} processed={status.get('processed')} errors={status.get('errors')}",
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

    if raw.startswith("/branch "):
        name = raw[len("/branch "):].strip()
        result = git_tools.branch(project_name, name)
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
    branch_name: str,
    file_context: str,
    assigned_tasks: list[dict],
) -> str:
    """Build system prompt. Tells agent to be themselves, not a bot."""
    s = agent.get("system_prompt", "You are a helpful team member.")

    # CRITICAL: Read user messages
    s += "\n\n=== CRITICAL RULES ==="
    s += "\n1. READ THE USER'S MESSAGES CAREFULLY. The user is your boss. If they give direction, FOLLOW IT."
    s += "\n2. If the user corrects you or the team, ACKNOWLEDGE IT and CHANGE COURSE immediately."
    s += "\n3. Do NOT repeat ideas the user has already rejected."
    s += "\n4. Keep responses SHORT: 2-4 sentences. No essays."
    s += "\n5. Write naturally — no name prefix, no brackets at the start."
    s += "\n6. Refer to teammates by name when relevant."
    s += "\n7. Codex is an additional technical teammate and can be asked for implementation help."
    s += "\n8. If anyone proposes a risky shortcut (skip tests, ignore security, hardcode secrets, bypass requirements), challenge it and propose a safer path."
    s += "\n9. Respectful disagreement is required when logic is weak. Do not rubber-stamp bad ideas."

    if agent.get("id") in {"reviewer", "sage", "codex", "critic"}:
        s += "\n\n=== CRITICAL VOICE MODE ==="
        s += "\nYou are expected to push back on weak, unsafe, or low-evidence decisions."
        s += "\nBe specific about failure mode, then offer the smallest safe alternative."
        s += "\nIf others are agreeing too quickly, you MUST introduce a concrete risk check."

    if agent.get("id") == "director":
        s += "\n\n=== LEADERSHIP CHECK ==="
        s += "\nBefore finalizing high-impact decisions, request at least one risk review from Rex, Sage, Codex, or Vera."
        s += "\nDo not force consensus without a trade-off summary."

    if is_followup:
        s += "\n\n=== FOLLOWUP RULES ==="
        s += "\nOnly speak if you have something NEW to add. A different angle, question, or concern."
        s += "\nIf you have nothing new, respond with exactly: PASS"
        s += "\nDo NOT just agree or restate what others said. Do NOT be sycophantic."
        s += "\nIf the latest proposal sounds risky or sloppy, challenge it explicitly."

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

    # Memory
    memories = read_all_memory_for_agent(agent["id"], limit=12)
    if memories:
        mem_text = "\n".join(f"- {m.get('content', '')}" for m in memories[-8:])
        s += f"\n\nThings you remember:\n{mem_text}"

    return s


async def _generate(agent: dict, channel: str, is_followup: bool = False) -> Optional[str]:
    """Generate one agent's response. Routes to Ollama or Claude based on backend."""
    context = await _build_context(channel)
    active_project = await project_manager.get_active_project(channel)
    project_root = Path(active_project["path"])
    branch_name = git_tools.current_branch(active_project["project"])
    file_context = await _build_file_context(channel, context[-1200:], agent)
    assigned_tasks = await get_tasks_for_agent(agent["id"])
    system = _build_system(
        agent,
        channel,
        is_followup,
        project_root=project_root,
        branch_name=branch_name,
        file_context=file_context,
        assigned_tasks=assigned_tasks,
    )

    # Find latest user message to highlight
    messages = await get_messages(channel, limit=CONTEXT_WINDOW)
    latest_user_msg = None
    for msg in reversed(messages):
        if msg["sender"] == "user":
            latest_user_msg = msg["content"]
            break

    prompt = f"Here's the conversation so far:\n\n{context}\n\n"
    if latest_user_msg:
        prompt += f">>> THE USER'S LATEST MESSAGE (this is what you should respond to): \"{latest_user_msg}\"\n\n"
    prompt += (
        f"Now respond as {agent['display_name']}. Remember: respond to what the USER said, "
        "not just what other agents said."
    )

    backend = agent.get("backend", "ollama")

    try:
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

        return response.strip()
    except Exception as e:
        logger.error(f"Agent {agent['id']} failed: {e}")
        return None


async def _run_build_test_loop(agent: dict, channel: str) -> None:
    active = await project_manager.get_active_project(channel)
    project_name = active["project"]
    config = build_runner.get_build_config(project_name)
    build_cmd = (config.get("build_cmd") or "").strip()
    test_cmd = (config.get("test_cmd") or "").strip()
    if not build_cmd:
        return

    failure_context = ""
    for attempt in range(1, BUILD_FIX_MAX_ATTEMPTS + 1):
        build_result = build_runner.run_build(project_name)
        await log_build_result(
            agent_id=agent["id"],
            channel=channel,
            project_name=project_name,
            stage="build",
            success=bool(build_result.get("ok")),
            exit_code=build_result.get("exit_code"),
            summary=(build_result.get("stderr") or build_result.get("error") or build_result.get("stdout") or "")[:500],
        )
        await manager.broadcast(channel, {"type": "build_result", "stage": "build", "result": build_result})
        await _send_system_message(channel, _format_runner_result("build", build_result), msg_type="tool_result")
        if build_result.get("ok"):
            _reset_agent_failure(channel, agent["id"])
            break

        failure_context = (
            f"Build attempt {attempt} failed.\n"
            f"Command: {build_result.get('command', build_cmd)}\n"
            f"Error:\n{(build_result.get('stderr') or build_result.get('error') or '')[:3000]}"
        )
        if attempt >= BUILD_FIX_MAX_ATTEMPTS:
            await _maybe_escalate_to_nova(channel, agent["id"], "repeated build failure", failure_context)
            return

        await _send_system_message(
            channel,
            f"Build failed (attempt {attempt}/{BUILD_FIX_MAX_ATTEMPTS}). Asking {agent['display_name']} to fix.",
            msg_type="system",
        )
        fix_response = await _generate(agent, channel, is_followup=True)
        if not fix_response:
            await _maybe_escalate_to_nova(channel, agent["id"], "empty response during build-fix loop", failure_context)
            return
        await _send(agent, channel, fix_response, run_post_checks=False)

    if not test_cmd:
        return

    for attempt in range(1, BUILD_FIX_MAX_ATTEMPTS + 1):
        test_result = build_runner.run_test(project_name)
        await log_build_result(
            agent_id=agent["id"],
            channel=channel,
            project_name=project_name,
            stage="test",
            success=bool(test_result.get("ok")),
            exit_code=test_result.get("exit_code"),
            summary=(test_result.get("stderr") or test_result.get("error") or test_result.get("stdout") or "")[:500],
        )
        await manager.broadcast(channel, {"type": "build_result", "stage": "test", "result": test_result})
        await _send_system_message(channel, _format_runner_result("test", test_result), msg_type="tool_result")
        if test_result.get("ok"):
            _reset_agent_failure(channel, agent["id"])
            return

        failure_context = (
            f"Test attempt {attempt} failed.\n"
            f"Command: {test_result.get('command', test_cmd)}\n"
            f"Error:\n{(test_result.get('stderr') or test_result.get('error') or '')[:3000]}"
        )
        if attempt >= BUILD_FIX_MAX_ATTEMPTS:
            await _maybe_escalate_to_nova(channel, agent["id"], "repeated test failure", failure_context)
            return

        await _send_system_message(
            channel,
            f"Tests failed (attempt {attempt}/{BUILD_FIX_MAX_ATTEMPTS}). Asking {agent['display_name']} to fix.",
            msg_type="system",
        )
        fix_response = await _generate(agent, channel, is_followup=True)
        if not fix_response:
            await _maybe_escalate_to_nova(channel, agent["id"], "empty response during test-fix loop", failure_context)
            return
        await _send(agent, channel, fix_response, run_post_checks=False)


async def _send(agent: dict, channel: str, content: str, run_post_checks: bool = True):
    """Save + broadcast an agent message, then execute any tool calls."""
    saved = await insert_message(channel=channel, sender=agent["id"], content=content, msg_type="message")
    await manager.broadcast(channel, {"type": "chat", "message": saved})
    logger.info(f"  [{agent['display_name']}] {content[:80]}")

    # Check for tool calls in the message
    tool_calls = parse_tool_calls(content)
    if tool_calls:
        logger.info(f"  [{agent['display_name']}] executing {len(tool_calls)} tool call(s)")
        results = await execute_tool_calls(agent["id"], tool_calls, channel)
        if run_post_checks and any(r.get("type") == "write" for r in results):
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


def _pick_next(last_sender: str, last_text: str, already_spoke: set) -> list[str]:
    """Pick who talks next. Deterministic + some randomness."""
    candidates = []

    # Mentioned agents always get to talk
    for aid in _mentions(last_text):
        if aid != last_sender and aid not in already_spoke:
            candidates.append(aid)

    # If the message invites response, add more
    if _invites_response(last_text) or not candidates:
        pool = [a for a in ALL_AGENT_IDS if a != last_sender and a not in already_spoke and a != "router"]
        random.shuffle(pool)
        for a in pool[:2]:
            if a not in candidates:
                candidates.append(a)

    if _looks_risky(last_text):
        for counter_voice in ("reviewer", "sage", "codex", "critic", "ops"):
            if counter_voice != last_sender and counter_voice not in already_spoke and counter_voice not in candidates:
                candidates.insert(0, counter_voice)
                break

    return candidates[:3]


async def _check_interrupt(channel: str) -> bool:
    """Check if user interrupted. Returns True if interrupted."""
    return channel in _user_interrupt


async def _handle_interrupt(channel: str, spoke_set: set) -> int:
    """Handle user interrupt: re-route and respond to new message. Returns msg count."""
    new_msg = _user_interrupt.pop(channel)
    logger.info(f"⚡ User interrupt: {new_msg[:60]}")
    new_agents = await route(new_msg)
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

        while count < MAX_MESSAGES and _active.get(channel) and consecutive_silence < max_silence:
            await asyncio.sleep(PAUSE_BETWEEN_ROUNDS)

            # Check for user interrupt
            if await _check_interrupt(channel):
                added = await _handle_interrupt(channel, spoke_this_convo)
                count += added
                _msg_count[channel] = count
                consecutive_silence = 0
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
                    new_agents = await route(recent2[-1]["content"])
                    spoke_this_convo.clear()
                    added = await _respond_agents(channel, new_agents, spoke_this_convo, is_followup=False)
                    count += added
                    _msg_count[channel] = count
                    consecutive_silence = 0
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
    if await _handle_git_command(channel, user_message):
        return
    if await _handle_branch_merge_command(channel, user_message):
        return
    if await _handle_export_command(channel, user_message):
        return
    if await _handle_meeting_or_vote(channel, user_message):
        return

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
        return

    # Start new conversation
    logger.info(f"New conversation in #{channel}")
    initial_agents = await route(user_message)
    logger.info(f"Initial agents: {initial_agents}")
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
