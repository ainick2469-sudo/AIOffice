"""Background autonomous task worker."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from . import database as db
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


async def _worker_loop(channel: str):
    status = _work_status.setdefault(channel, {})
    status.update({
        "channel": channel,
        "running": True,
        "processed": 0,
        "errors": 0,
        "started_at": int(time.time()),
        "last_task_at": None,
    })
    await _broadcast_status(channel)

    from .agent_engine import process_message

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

            await _set_task_status(task["id"], "in_progress")
            status["processed"] += 1
            status["last_task_at"] = int(time.time())
            await _broadcast_status(channel)

            prompt = (
                f"Autonomous work cycle: execute task #{task['id']}.\n"
                f"Title: {task.get('title', '')}\n"
                f"Description: {task.get('description', '') or '(none)'}\n"
                "Provide concrete progress and update status tags when done/blocked."
            )
            await process_message(channel, prompt)
            await asyncio.sleep(WORK_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            status["running"] = False
            status["reason"] = "cancelled"
            break
        except Exception as exc:
            status["errors"] += 1
            logger.error("Autonomous worker error in channel %s: %s", channel, exc)
            await asyncio.sleep(10)

    status["running"] = False
    status["stopped_at"] = int(time.time())
    await _broadcast_status(channel)


def start_work(channel: str) -> dict:
    existing = _worker_tasks.get(channel)
    if existing and not existing.done():
        return get_work_status(channel)

    _work_status[channel] = {
        "channel": channel,
        "running": True,
        "processed": 0,
        "errors": 0,
        "started_at": int(time.time()),
        "last_task_at": None,
    }
    task = asyncio.create_task(_worker_loop(channel))
    _worker_tasks[channel] = task
    return get_work_status(channel)


def stop_work(channel: str) -> dict:
    status = _work_status.setdefault(channel, {"channel": channel})
    status["running"] = False
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
            "processed": 0,
            "errors": 0,
            "started_at": None,
            "last_task_at": None,
        }
    return dict(status)
