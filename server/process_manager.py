"""Channel-scoped process manager with kill switch support."""

from __future__ import annotations

import asyncio
import atexit
import os
import re
import socket
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

from . import database as db
from .policy import evaluate_tool_policy
from .project_manager import get_active_project
from .runtime_config import build_runtime_env
from .websocket import manager

MAX_LOG_LINES = 400

_processes: dict[str, dict[str, dict[str, Any]]] = {}
_PORT_PATTERNS = (
    re.compile(r"(?:^|\s)--port(?:=|\s+)(\d{2,5})(?:\s|$)", re.IGNORECASE),
    re.compile(r"(?:^|\s)-p\s+(\d{2,5})(?:\s|$)", re.IGNORECASE),
    re.compile(r"(?:^|\s)python -m http\.server\s+(\d{2,5})(?:\s|$)", re.IGNORECASE),
)


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
        data={
            "process_id": process_id,
            "exit_code": exit_code,
            "port": proc_entry.get("port"),
        },
    )


def _extract_port(command: str) -> int | None:
    cmd = (command or "").strip()
    if not cmd:
        return None
    for pattern in _PORT_PATTERNS:
        match = pattern.search(cmd)
        if not match:
            continue
        try:
            port = int(match.group(1))
        except (TypeError, ValueError):
            continue
        if 1 <= port <= 65535:
            return port
    return None


def _find_managed_port_conflict(port: int) -> dict[str, Any] | None:
    for ch, process_map in _processes.items():
        for process_id, entry in process_map.items():
            proc = entry.get("process")
            if not proc or proc.returncode is not None:
                continue
            status = (entry.get("status") or "").strip().lower()
            if status not in {"running"}:
                continue
            entry_port = entry.get("port")
            if entry_port is None:
                entry_port = _extract_port(str(entry.get("command") or ""))
                entry["port"] = entry_port
            if entry_port == port:
                return {
                    "channel": ch,
                    "process_id": process_id,
                    "name": entry.get("name", process_id),
                    "project": entry.get("project"),
                    "command": entry.get("command"),
                }
    return None


def _is_port_in_use(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", int(port)))
        return False
    except OSError:
        return True
    finally:
        try:
            sock.close()
        except Exception:
            pass


def _terminate_all_sync() -> None:
    for process_map in _processes.values():
        for entry in process_map.values():
            proc = entry.get("process")
            if not proc:
                continue
            try:
                if proc.returncode is None:
                    proc.terminate()
            except Exception:
                pass
            try:
                if proc.returncode is None:
                    proc.kill()
            except Exception:
                pass
            if entry.get("status") == "running":
                entry["status"] = "terminated"
                entry["ended_at"] = int(time.time())
                entry["exit_code"] = proc.returncode


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
        "port": entry.get("port"),
        "policy_mode": entry.get("policy_mode"),
        "permission_mode": entry.get("permission_mode"),
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
    agent_id: str = "user",
    approved: bool = False,
    task_id: str | None = None,
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

    cmd = (command or "").strip()
    policy = await evaluate_tool_policy(
        channel=channel,
        tool_type="run",
        agent_id=(agent_id or "user").strip() or "user",
        command=cmd,
        target_path=str(cwd),
        approved=approved,
    )
    if not policy.get("allowed"):
        reason = policy.get("reason", "Policy denied process start.")
        if policy.get("requires_approval"):
            reason = f"{reason} Approve the action first or use a trusted session."
        await db.log_console_event(
            channel=channel,
            event_type="policy_block",
            source="process_manager",
            message=reason[:900],
            project_name=project_name,
            data={
                "command": cmd,
                "policy_mode": policy.get("mode"),
                "permission_mode": policy.get("permission_mode"),
                "branch": policy.get("branch", "main"),
                "agent_id": agent_id,
            },
            severity="warning",
        )
        raise ValueError(reason)

    requested_port = _extract_port(cmd)
    if requested_port:
        managed_conflict = _find_managed_port_conflict(requested_port)
        if managed_conflict:
            raise ValueError(
                "Port "
                f"{requested_port} is already in use by managed process "
                f"{managed_conflict['name']} ({managed_conflict['process_id']}) "
                f"in channel {managed_conflict['channel']}."
            )
        if _is_port_in_use(requested_port):
            raise ValueError(
                f"Port {requested_port} is already in use by another process. "
                "Stop that process or choose another port."
            )

    proc_id = uuid.uuid4().hex[:12]
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
        "port": requested_port,
        "policy_mode": policy.get("mode"),
        "permission_mode": policy.get("permission_mode"),
        "task_id": task_id,
        "agent_id": agent_id,
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
        data={
            "process_id": proc_id,
            "pid": proc.pid,
            "cwd": str(cwd),
            "port": requested_port,
            "policy_mode": policy.get("mode"),
            "permission_mode": policy.get("permission_mode"),
            "branch": policy.get("branch", "main"),
            "agent_id": agent_id,
            "task_id": task_id,
        },
    )
    return payload


async def stop_process(channel: str, process_id: str) -> dict[str, Any]:
    entry = _channel_map(channel).get(process_id)
    if not entry:
        raise ValueError("Process not found.")

    proc = entry["process"]
    was_running = bool(entry.get("status") == "running" and proc.returncode is None)
    if entry.get("status") == "running" and proc.returncode is None:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=6)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    if was_running:
        entry["status"] = "stopped"
    elif entry.get("status") not in {"exited", "terminated"}:
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
        data={
            "process_id": process_id,
            "exit_code": proc.returncode,
            "port": entry.get("port"),
        },
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
    permission = await db.set_permission_policy(channel, mode="ask")
    await db.log_console_event(
        channel=channel,
        event_type="kill_switch",
        source="process_manager",
        message="Kill switch triggered. All processes stopped, autonomy mode reset to SAFE, and channel approvals reset to ASK.",
        project_name=project_name,
        data={
            "stopped_count": len(stopped),
            "permission_mode": permission.get("mode", "ask"),
        },
        severity="warning",
    )
    await _broadcast_event(channel, {
        "type": "kill_switch",
        "project": project_name,
        "autonomy_mode": "SAFE",
        "permission_mode": permission.get("mode", "ask"),
        "stopped_count": len(stopped),
    })
    return {
        "ok": True,
        "channel": channel,
        "project": project_name,
        "autonomy_mode": "SAFE",
        "permission_mode": permission.get("mode", "ask"),
        "stopped": [item["id"] for item in stopped],
        "stopped_count": len(stopped),
    }


async def shutdown_all_processes() -> dict[str, int]:
    stopped_count = 0
    channels = list(_processes.keys())
    for channel in channels:
        process_ids = list(_channel_map(channel).keys())
        for process_id in process_ids:
            try:
                await stop_process(channel, process_id)
                stopped_count += 1
            except Exception:
                continue
    return {"stopped_count": stopped_count}


atexit.register(_terminate_all_sync)
