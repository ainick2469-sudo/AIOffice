"""Channel-scoped process manager with kill switch support."""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from . import database as db
from .project_manager import get_active_project
from .runtime_paths import build_runtime_env
from .websocket import manager

MAX_LOG_LINES = 400

_processes: dict[str, dict[str, dict[str, Any]]] = {}


def _channel_map(channel: str) -> dict[str, dict[str, Any]]:
    return _processes.setdefault(channel, {})


async def _broadcast_event(channel: str, payload: dict[str, Any]) -> None:
    await manager.broadcast(channel, payload)


async def _capture_logs(channel: str, process_id: str) -> None:
    proc_entry = _channel_map(channel).get(process_id)
    if not proc_entry:
        return
    proc = proc_entry["process"]
    if proc.stdout is None:
        return

    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace").rstrip()
        if not text:
            continue
        proc_entry["logs"].append(text)
        await _broadcast_event(channel, {
            "type": "process_log",
            "process_id": process_id,
            "line": text,
        })
        await db.log_console_event(
            channel=channel,
            event_type="process_log",
            source="process_manager",
            message=text[:600],
            project_name=proc_entry.get("project"),
            data={"process_id": process_id},
        )

    exit_code = await proc.wait()
    proc_entry["status"] = "exited"
    proc_entry["exit_code"] = exit_code
    proc_entry["ended_at"] = int(time.time())
    await _broadcast_event(channel, {
        "type": "process_exit",
        "process_id": process_id,
        "exit_code": exit_code,
    })
    await db.log_console_event(
        channel=channel,
        event_type="process_exit",
        source="process_manager",
        message=f"Process {process_id} exited with code {exit_code}",
        project_name=proc_entry.get("project"),
        data={"process_id": process_id, "exit_code": exit_code},
    )


def _serialize(process_id: str, entry: dict[str, Any], include_logs: bool = False) -> dict[str, Any]:
    payload = {
        "id": process_id,
        "name": entry.get("name", process_id),
        "channel": entry.get("channel"),
        "project": entry.get("project"),
        "cwd": entry.get("cwd"),
        "command": entry.get("command"),
        "pid": entry.get("pid"),
        "status": entry.get("status"),
        "started_at": entry.get("started_at"),
        "ended_at": entry.get("ended_at"),
        "exit_code": entry.get("exit_code"),
    }
    if include_logs:
        payload["logs"] = list(entry.get("logs", []))
    return payload


async def start_process(
    *,
    channel: str,
    command: str,
    name: str | None = None,
    project: str | None = None,
) -> dict[str, Any]:
    if not (command or "").strip():
        raise ValueError("Command is required.")

    active = await get_active_project(channel)
    project_name = project or active["project"]
    if project_name == active["project"]:
        cwd = Path(active["path"]).resolve()
    else:
        from .project_manager import get_project_root, APP_ROOT

        cwd = APP_ROOT if project_name == "ai-office" else get_project_root(project_name)
        cwd = cwd.resolve()

    proc_id = uuid.uuid4().hex[:12]
    cmd = (command or "").strip()
    env = build_runtime_env(os.environ.copy())

    proc = await asyncio.create_subprocess_shell(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    entry = {
        "id": proc_id,
        "name": (name or "process").strip() or "process",
        "channel": channel,
        "project": project_name,
        "cwd": str(cwd),
        "command": cmd,
        "pid": proc.pid,
        "status": "running",
        "started_at": int(time.time()),
        "ended_at": None,
        "exit_code": None,
        "logs": deque(maxlen=MAX_LOG_LINES),
        "process": proc,
        "capture_task": None,
    }
    _channel_map(channel)[proc_id] = entry
    entry["capture_task"] = asyncio.create_task(_capture_logs(channel, proc_id))

    payload = _serialize(proc_id, entry)
    await _broadcast_event(channel, {"type": "process_started", "process": payload})
    await db.log_console_event(
        channel=channel,
        event_type="process_start",
        source="process_manager",
        message=f"Started process `{cmd}`",
        project_name=project_name,
        data={"process_id": proc_id, "pid": proc.pid, "cwd": str(cwd)},
    )
    return payload


async def stop_process(channel: str, process_id: str) -> dict[str, Any]:
    entry = _channel_map(channel).get(process_id)
    if not entry:
        raise ValueError("Process not found.")

    proc = entry["process"]
    if entry.get("status") == "running" and proc.returncode is None:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=6)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    entry["status"] = "stopped"
    entry["exit_code"] = proc.returncode
    entry["ended_at"] = int(time.time())

    payload = _serialize(process_id, entry)
    await _broadcast_event(channel, {"type": "process_stopped", "process": payload})
    await db.log_console_event(
        channel=channel,
        event_type="process_stop",
        source="process_manager",
        message=f"Stopped process {process_id}",
        project_name=entry.get("project"),
        data={"process_id": process_id, "exit_code": proc.returncode},
    )
    return payload


async def list_processes(channel: str, include_logs: bool = False) -> list[dict[str, Any]]:
    items = []
    for process_id, entry in _channel_map(channel).items():
        items.append(_serialize(process_id, entry, include_logs=include_logs))
    items.sort(key=lambda item: item.get("started_at") or 0, reverse=True)
    return items


async def kill_switch(channel: str) -> dict[str, Any]:
    channel_processes = list(_channel_map(channel).keys())
    stopped = []
    for process_id in channel_processes:
        try:
            stopped.append(await stop_process(channel, process_id))
        except Exception:
            continue

    active = await get_active_project(channel)
    project_name = active["project"]
    await db.set_project_autonomy_mode(project_name, "SAFE")
    await db.log_console_event(
        channel=channel,
        event_type="kill_switch",
        source="process_manager",
        message="Kill switch triggered. All processes stopped and autonomy mode reset to SAFE.",
        project_name=project_name,
        data={"stopped_count": len(stopped)},
        severity="warning",
    )
    await _broadcast_event(channel, {
        "type": "kill_switch",
        "project": project_name,
        "autonomy_mode": "SAFE",
        "stopped_count": len(stopped),
    })
    return {
        "ok": True,
        "channel": channel,
        "project": project_name,
        "autonomy_mode": "SAFE",
        "stopped": [item["id"] for item in stopped],
        "stopped_count": len(stopped),
    }
