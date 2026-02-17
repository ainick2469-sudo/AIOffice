"""Background autonomous task executor with explicit PLAN->GATE->EXECUTE->VERIFY->DELIVER phases."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from . import build_runner
from . import database as db
from . import project_manager
from .websocket import manager

logger = logging.getLogger("ai-office.autonomous")

WORK_INTERVAL_SECONDS = 120
GATE_POLL_SECONDS = 2
MAX_TASKS_PER_SESSION = 20
MAX_ERRORS_PER_SESSION = 3
MAX_STEP_RETRIES = 2
MAX_TASK_RETRIES = 3
PHASES = ("idle", "approval", "plan", "gate", "execute", "verify", "deliver", "stopped", "error")

_worker_tasks: dict[str, asyncio.Task] = {}
_work_status: dict[str, dict] = {}


def _default_status(channel: str) -> dict:
    return {
        "channel": channel,
        "running": False,
        "awaiting_approval": False,
        "phase": "idle",
        "processed": 0,
        "errors": 0,
        "started_at": None,
        "stopped_at": None,
        "last_task_at": None,
        "reason": "",
        "auto_proceed": False,
        "current_task_id": None,
        "current_task_title": "",
        "current_task_attempt": 0,
        "verify_summary": "",
        "gate_approval_task_id": None,
        "gate_prompted_for_task": None,
    }


def _status(channel: str) -> dict:
    state = _work_status.get(channel)
    if not state:
        state = _default_status(channel)
        _work_status[channel] = state
    return state


def _reset_task_context(state: dict) -> None:
    state["current_task_id"] = None
    state["current_task_title"] = ""
    state["current_task_attempt"] = 0
    state["verify_summary"] = ""
    state["gate_approval_task_id"] = None
    state["gate_prompted_for_task"] = None
    state["awaiting_approval"] = False


def _sync_status_view(state: dict) -> dict:
    return {
        "channel": state.get("channel", "main"),
        "running": bool(state.get("running", False)),
        "awaiting_approval": bool(state.get("awaiting_approval", False)),
        "phase": state.get("phase", "idle"),
        "processed": int(state.get("processed", 0) or 0),
        "errors": int(state.get("errors", 0) or 0),
        "started_at": state.get("started_at"),
        "stopped_at": state.get("stopped_at"),
        "last_task_at": state.get("last_task_at"),
        "reason": state.get("reason", ""),
        "auto_proceed": bool(state.get("auto_proceed", False)),
        "current_task_id": state.get("current_task_id"),
        "current_task_title": state.get("current_task_title", ""),
        "current_task_attempt": int(state.get("current_task_attempt", 0) or 0),
        "verify_summary": state.get("verify_summary", ""),
    }


async def _broadcast_status(channel: str):
    payload = get_work_status(channel)
    await manager.broadcast(channel, {"type": "work_status", "status": payload})


async def _emit_phase(
    channel: str,
    *,
    phase: str,
    message: str,
    state: Optional[dict] = None,
    task: Optional[dict] = None,
    severity: str = "info",
    extra: Optional[dict] = None,
):
    if phase not in PHASES:
        phase = "error"
    status = state or _status(channel)
    status["phase"] = phase
    if task:
        status["current_task_id"] = task.get("id")
        status["current_task_title"] = task.get("title", "")
    payload = {
        "phase": phase,
        "task_id": status.get("current_task_id"),
        "task_title": status.get("current_task_title"),
        "task_attempt": status.get("current_task_attempt", 0),
        "processed": status.get("processed", 0),
        "errors": status.get("errors", 0),
    }
    if extra:
        payload.update(extra)
    await db.log_console_event(
        channel=channel,
        event_type="work_phase",
        source="autonomous_worker",
        message=f"{phase}: {message}"[:1000],
        severity=severity,
        data=payload,
    )
    await manager.broadcast(
        channel,
        {
            "type": "work_phase",
            "phase": phase,
            "message": message,
            "task_id": payload["task_id"],
            "task_attempt": payload["task_attempt"],
            "data": payload,
        },
    )
    await _broadcast_status(channel)


async def _next_task(channel: str, project_name: str) -> Optional[dict]:
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            """SELECT * FROM tasks
               WHERE status NOT IN ('done', 'blocked')
                 AND COALESCE(NULLIF(channel, ''), 'main') = ?
                 AND COALESCE(NULLIF(project_name, ''), 'ai-office') = ?
               ORDER BY
                 CASE status
                   WHEN 'in_progress' THEN 0
                   WHEN 'review' THEN 1
                   ELSE 2
                 END,
                 priority DESC,
                 updated_at ASC
               LIMIT 1""",
            (channel, project_name),
        )
        row = await rows.fetchone()
        return dict(row) if row else None
    finally:
        await conn.close()


async def _set_task_status(task_id: int, status: str):
    await db.update_task(task_id, {"status": status})


async def _verify_active_project(channel: str) -> tuple[bool, str]:
    active = await project_manager.get_active_project(channel)
    project_name = active["project"]
    cfg = build_runner.get_build_config(project_name)
    build_cmd = (cfg.get("build_cmd") or "").strip()
    test_cmd = (cfg.get("test_cmd") or "").strip()
    if not build_cmd and not test_cmd:
        return True, "No build/test config set; verification skipped."

    if build_cmd:
        build_result = build_runner.run_build(project_name)
        await manager.broadcast(channel, {"type": "build_result", "stage": "build", "result": build_result})
        if not build_result.get("ok"):
            return False, f"Build failed: {(build_result.get('stderr') or build_result.get('error') or '')[:500]}"
    if test_cmd:
        test_result = build_runner.run_test(project_name)
        await manager.broadcast(channel, {"type": "build_result", "stage": "test", "result": test_result})
        if not test_result.get("ok"):
            return False, f"Tests failed: {(test_result.get('stderr') or test_result.get('error') or '')[:500]}"
    return True, "Build/test checks passed."


async def _run_prompt_with_retries(
    channel: str,
    prompt: str,
    *,
    phase: str,
    state: dict,
    task: dict,
) -> bool:
    from .agent_engine import process_message

    last_error = ""
    for attempt in range(1, MAX_STEP_RETRIES + 1):
        try:
            await process_message(channel, prompt)
            return True
        except Exception as exc:  # pragma: no cover - defensive
            last_error = str(exc)
            await _emit_phase(
                channel,
                phase=phase,
                message=f"Step attempt {attempt}/{MAX_STEP_RETRIES} failed: {last_error}",
                state=state,
                task=task,
                severity="warning",
                extra={"step_attempt": attempt},
            )
            await asyncio.sleep(1)
    await _emit_phase(
        channel,
        phase=phase,
        message=f"Step failed after {MAX_STEP_RETRIES} attempts: {last_error or 'unknown error'}",
        state=state,
        task=task,
        severity="error",
    )
    return False


async def _permission_mode(channel: str) -> str:
    policy = await db.get_permission_policy(channel)
    return str(policy.get("mode") or "ask").strip().lower()


async def _gate_ready(channel: str, state: dict, task: dict) -> bool:
    task_id = int(task.get("id") or 0)
    permission_mode = await _permission_mode(channel)
    trusted_auto = permission_mode == "trusted" and bool(state.get("auto_proceed"))
    if trusted_auto:
        state["awaiting_approval"] = False
        state["gate_approval_task_id"] = task_id
        await _emit_phase(
            channel,
            phase="gate",
            message=f"Auto-approved in trusted mode for task #{task_id}.",
            state=state,
            task=task,
            extra={"permission_mode": permission_mode, "auto_proceed": True},
        )
        return True

    if state.get("gate_approval_task_id") == task_id:
        state["awaiting_approval"] = False
        return True

    state["awaiting_approval"] = True
    state["reason"] = "waiting_for_task_approval"
    if state.get("gate_prompted_for_task") != task_id:
        state["gate_prompted_for_task"] = task_id
        await _emit_phase(
            channel,
            phase="gate",
            message=(
                f"Task #{task_id} is ready to execute. "
                "Run `/work approve` to continue this task."
            ),
            state=state,
            task=task,
            severity="warning",
            extra={"permission_mode": permission_mode, "auto_proceed": bool(state.get("auto_proceed"))},
        )
    await _broadcast_status(channel)
    return False


async def _handle_task(channel: str, state: dict, task: dict) -> bool:
    task_id = int(task.get("id") or 0)
    title = str(task.get("title") or "")
    description = str(task.get("description") or "(none)")

    await _set_task_status(task_id, "in_progress")
    state["current_task_attempt"] = 1
    await _emit_phase(channel, phase="plan", message=f"Planning task #{task_id}: {title}", state=state, task=task)
    planned = await _run_prompt_with_retries(
        channel,
        (
            f"[AUTONOMOUS PLAN]\nTask #{task_id}: {title}\nDescription: {description}\n"
            "Produce a short execution plan with expected outputs and verification commands."
        ),
        phase="plan",
        state=state,
        task=task,
    )
    if not planned:
        await _set_task_status(task_id, "blocked")
        await _emit_phase(
            channel,
            phase="deliver",
            message=f"Task #{task_id} blocked because planning failed.",
            state=state,
            task=task,
            severity="error",
        )
        return False

    while state["running"]:
        if not await _gate_ready(channel, state, task):
            await asyncio.sleep(GATE_POLL_SECONDS)
            continue

        state["awaiting_approval"] = False
        await _emit_phase(
            channel,
            phase="execute",
            message=f"Executing task #{task_id} (attempt {state['current_task_attempt']}/{MAX_TASK_RETRIES}).",
            state=state,
            task=task,
            extra={"task_attempt": state["current_task_attempt"]},
        )
        executed = await _run_prompt_with_retries(
            channel,
            (
                f"[AUTONOMOUS EXECUTE]\nTask #{task_id}: {title}\n"
                "Execute now. Use tools directly. Keep updates concise."
            ),
            phase="execute",
            state=state,
            task=task,
        )
        if not executed:
            await _set_task_status(task_id, "blocked")
            await _emit_phase(
                channel,
                phase="deliver",
                message=f"Task #{task_id} blocked because execution failed.",
                state=state,
                task=task,
                severity="error",
            )
            return False

        await _emit_phase(channel, phase="verify", message=f"Verifying task #{task_id}.", state=state, task=task)
        verified, summary = await _verify_active_project(channel)
        state["verify_summary"] = summary
        if verified:
            break

        if state["current_task_attempt"] < MAX_TASK_RETRIES:
            await _emit_phase(
                channel,
                phase="verify",
                message=f"Verification failed for task #{task_id}: {summary}",
                state=state,
                task=task,
                severity="warning",
                extra={"retrying": True},
            )
            repaired = await _run_prompt_with_retries(
                channel,
                (
                    f"[AUTONOMOUS VERIFY FAILED]\nTask #{task_id}: {title}\n"
                    f"{summary}\nApply the smallest safe fix, then continue."
                ),
                phase="execute",
                state=state,
                task=task,
            )
            if not repaired:
                await _set_task_status(task_id, "blocked")
                await _emit_phase(
                    channel,
                    phase="deliver",
                    message=f"Task #{task_id} blocked because repair failed after verify failure.",
                    state=state,
                    task=task,
                    severity="error",
                )
                return False

            state["current_task_attempt"] += 1
            continue

        await _set_task_status(task_id, "blocked")
        await _emit_phase(
            channel,
            phase="deliver",
            message=f"Task #{task_id} blocked after {MAX_TASK_RETRIES} verify attempts: {summary}",
            state=state,
            task=task,
            severity="error",
        )
        return False

    await _set_task_status(task_id, "done")
    await _emit_phase(channel, phase="deliver", message=f"Delivering task #{task_id}.", state=state, task=task)
    delivered = await _run_prompt_with_retries(
        channel,
        (
            f"[AUTONOMOUS DELIVER]\nTask #{task_id}: {title}\n"
            f"Verification: {state.get('verify_summary') or 'n/a'}\n"
            "Summarize artifacts produced and recommended next step."
        ),
        phase="deliver",
        state=state,
        task=task,
    )
    if not delivered:
        # Keep task marked done because execution + verification passed.
        await _emit_phase(
            channel,
            phase="deliver",
            message=f"Task #{task_id} completed but delivery summary failed.",
            state=state,
            task=task,
            severity="warning",
        )
    return True


async def _worker_loop(channel: str):
    state = _status(channel)
    state.update(
        {
            "channel": channel,
            "running": True,
            "awaiting_approval": False,
            "phase": "idle",
            "processed": 0,
            "errors": 0,
            "reason": "",
            "started_at": int(time.time()),
            "stopped_at": None,
            "last_task_at": None,
        }
    )
    _reset_task_context(state)
    await _emit_phase(channel, phase="idle", message="Autonomous worker started.", state=state)

    while state["running"]:
        try:
            if state["processed"] >= MAX_TASKS_PER_SESSION:
                state["running"] = False
                state["reason"] = "max_tasks_reached"
                break
            if state["errors"] >= MAX_ERRORS_PER_SESSION:
                state["running"] = False
                state["reason"] = "error_threshold"
                break

            active = await project_manager.get_active_project(channel)
            project_name = active["project"]
            task = await _next_task(channel, project_name)
            if not task:
                state["running"] = False
                state["reason"] = "no_pending_tasks"
                break

            state["last_task_at"] = int(time.time())
            ok = await _handle_task(channel, state, task)
            state["processed"] += 1
            if not ok:
                state["errors"] += 1
            _reset_task_context(state)
            state["phase"] = "idle"
            await _broadcast_status(channel)
            await asyncio.sleep(WORK_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            state["running"] = False
            state["reason"] = "cancelled"
            break
        except Exception as exc:  # pragma: no cover - defensive
            state["errors"] += 1
            state["phase"] = "error"
            state["reason"] = "worker_exception"
            logger.error("Autonomous worker error in channel %s: %s", channel, exc)
            await _emit_phase(
                channel,
                phase="error",
                message=f"Worker exception: {exc}",
                state=state,
                severity="error",
            )
            await asyncio.sleep(5)

    state["running"] = False
    state["phase"] = "stopped"
    state["stopped_at"] = int(time.time())
    await _emit_phase(channel, phase="stopped", message="Autonomous worker stopped.", state=state)


def start_work(channel: str, approved: bool = False) -> dict:
    state = _status(channel)
    if not approved:
        state.update(
            {
                "running": False,
                "awaiting_approval": True,
                "phase": "approval",
                "reason": "approval_required",
                "auto_proceed": False,
            }
        )
        _reset_task_context(state)
        return get_work_status(channel)

    existing = _worker_tasks.get(channel)
    if existing and not existing.done():
        return get_work_status(channel)

    state.update(
        {
            "channel": channel,
            "running": True,
            "awaiting_approval": False,
            "phase": "starting",
            "processed": 0,
            "errors": 0,
            "reason": "",
            "started_at": int(time.time()),
            "stopped_at": None,
            "last_task_at": None,
            "auto_proceed": bool(approved),
        }
    )
    _reset_task_context(state)
    task = asyncio.create_task(_worker_loop(channel))
    _worker_tasks[channel] = task
    return get_work_status(channel)


def approve_current_gate(channel: str, auto_proceed: bool = False) -> dict:
    state = _status(channel)
    if not state.get("running") and state.get("phase") == "approval":
        return start_work(channel, approved=True)

    task_id = state.get("current_task_id")
    if not task_id:
        state["reason"] = "no_gate_pending"
        return get_work_status(channel)

    state["gate_approval_task_id"] = int(task_id)
    state["awaiting_approval"] = False
    state["reason"] = "approved"
    if auto_proceed:
        state["auto_proceed"] = True
    return get_work_status(channel)


def stop_work(channel: str) -> dict:
    state = _status(channel)
    state["running"] = False
    state["awaiting_approval"] = False
    state["phase"] = "stopped"
    state["reason"] = "stopped_by_user"
    state["stopped_at"] = int(time.time())
    _reset_task_context(state)

    task = _worker_tasks.get(channel)
    if task and not task.done():
        task.cancel()
    return get_work_status(channel)


def get_work_status(channel: str) -> dict:
    return _sync_status_view(_status(channel))
