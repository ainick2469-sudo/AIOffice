"""Background autonomous task executor with plan/execute/verify/deliver phases."""

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
MAX_TASKS_PER_SESSION = 20
MAX_ERRORS_PER_SESSION = 3

_worker_tasks: dict[str, asyncio.Task] = {}
_work_status: dict[str, dict] = {}


async def _next_task() -> Optional[dict]:
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            """SELECT * FROM tasks
               WHERE status NOT IN ('done', 'blocked')
               ORDER BY priority DESC, updated_at ASC
               LIMIT 1"""
        )
        row = await rows.fetchone()
        return dict(row) if row else None
    finally:
        await conn.close()


async def _set_task_status(task_id: int, status: str):
    conn = await db.get_db()
    try:
        await conn.execute(
            "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, task_id),
        )
        await conn.commit()
    finally:
        await conn.close()


async def _broadcast_status(channel: str):
    payload = get_work_status(channel)
    await manager.broadcast(channel, {"type": "work_status", "status": payload})


async def _emit_phase(channel: str, phase: str, message: str):
    await db.log_console_event(
        channel=channel,
        event_type="work_phase",
        source="autonomous_worker",
        message=f"{phase}: {message}"[:1000],
        data={"phase": phase},
    )
    await manager.broadcast(channel, {"type": "work_phase", "phase": phase, "message": message})


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


async def _work_cycle(channel: str, task: dict):
    from .agent_engine import process_message

    task_id = task["id"]
    title = task.get("title", "")
    description = task.get("description") or "(none)"

    await _set_task_status(task_id, "in_progress")
    await _emit_phase(channel, "plan", f"Task #{task_id}: {title}")
    await process_message(
        channel,
        (
            f"[AUTONOMOUS PLAN]\nTask #{task_id}: {title}\nDescription: {description}\n"
            "Produce a short execution plan with expected outputs and verification commands."
        ),
    )

    await _emit_phase(channel, "execute", f"Executing task #{task_id}")
    await process_message(
        channel,
        (
            f"[AUTONOMOUS EXECUTE]\nTask #{task_id}: {title}\n"
            "Execute now. Use tools directly. Keep updates concise."
        ),
    )

    await _emit_phase(channel, "verify", f"Verifying task #{task_id}")
    verified, summary = await _verify_active_project(channel)
    if not verified:
        await _set_task_status(task_id, "blocked")
        await _emit_phase(channel, "verify", f"Task #{task_id} blocked: {summary}")
        await process_message(
            channel,
            (
                f"[AUTONOMOUS VERIFY FAILED]\nTask #{task_id}: {title}\n"
                f"{summary}\nMark blockers and propose smallest safe fix."
            ),
        )
        return False

    await _set_task_status(task_id, "done")
    await _emit_phase(channel, "deliver", f"Task #{task_id} completed")
    await process_message(
        channel,
        (
            f"[AUTONOMOUS DELIVER]\nTask #{task_id}: {title}\n"
            f"Verification: {summary}\n"
            "Summarize artifacts produced and recommended next step."
        ),
    )
    return True


async def _worker_loop(channel: str):
    status = _work_status.setdefault(channel, {})
    status.update(
        {
            "channel": channel,
            "running": True,
            "processed": 0,
            "errors": 0,
            "phase": "idle",
            "awaiting_approval": False,
            "started_at": int(time.time()),
            "last_task_at": None,
        }
    )
    await _broadcast_status(channel)

    while status["running"]:
        try:
            if status["processed"] >= MAX_TASKS_PER_SESSION:
                status["running"] = False
                status["reason"] = "max_tasks_reached"
                break
            if status["errors"] >= MAX_ERRORS_PER_SESSION:
                status["running"] = False
                status["reason"] = "error_threshold"
                break

            task = await _next_task()
            if not task:
                status["running"] = False
                status["reason"] = "no_pending_tasks"
                break

            status["last_task_at"] = int(time.time())
            status["phase"] = "plan"
            await _broadcast_status(channel)
            ok = await _work_cycle(channel, task)
            status["processed"] += 1
            if not ok:
                status["errors"] += 1
            status["phase"] = "idle"
            await _broadcast_status(channel)
            await asyncio.sleep(WORK_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            status["running"] = False
            status["reason"] = "cancelled"
            break
        except Exception as exc:
            status["errors"] += 1
            logger.error("Autonomous worker error in channel %s: %s", channel, exc)
            status["phase"] = "error"
            await _broadcast_status(channel)
            await asyncio.sleep(10)

    status["running"] = False
    status["phase"] = "stopped"
    status["stopped_at"] = int(time.time())
    await _broadcast_status(channel)


def start_work(channel: str, approved: bool = False) -> dict:
    status = _work_status.setdefault(channel, {"channel": channel})
    if not approved:
        status.update(
            {
                "running": False,
                "awaiting_approval": True,
                "phase": "approval",
                "reason": "approval_required",
                "processed": status.get("processed", 0),
                "errors": status.get("errors", 0),
            }
        )
        return get_work_status(channel)

    existing = _worker_tasks.get(channel)
    if existing and not existing.done():
        return get_work_status(channel)

    status.update(
        {
            "channel": channel,
            "running": True,
            "awaiting_approval": False,
            "phase": "starting",
            "processed": 0,
            "errors": 0,
            "started_at": int(time.time()),
            "last_task_at": None,
        }
    )
    task = asyncio.create_task(_worker_loop(channel))
    _worker_tasks[channel] = task
    return get_work_status(channel)


def stop_work(channel: str) -> dict:
    status = _work_status.setdefault(channel, {"channel": channel})
    status["running"] = False
    status["awaiting_approval"] = False
    status["phase"] = "stopped"
    status["reason"] = "stopped_by_user"

    task = _worker_tasks.get(channel)
    if task and not task.done():
        task.cancel()
    return get_work_status(channel)


def get_work_status(channel: str) -> dict:
    status = _work_status.get(channel)
    if not status:
        return {
            "channel": channel,
            "running": False,
            "awaiting_approval": False,
            "phase": "idle",
            "processed": 0,
            "errors": 0,
            "started_at": None,
            "last_task_at": None,
        }
    return dict(status)
