import asyncio
import socket
import pytest

from server import database as db
from server import process_manager
from server import project_manager as pm


def _run(coro):
    return asyncio.run(coro)


def _ensure_project(name: str):
    try:
        _run(pm.create_project(name))
    except ValueError:
        pass
    _run(pm.switch_project("main", name))


def _free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
    finally:
        sock.close()


async def _allow_run_scope():
    await db.set_permission_policy(
        "main",
        mode="ask",
        scopes=["read", "search", "run", "write", "task", "pip", "git"],
        command_allowlist_profile="safe",
    )


def _cleanup_processes():
    try:
        _run(process_manager.kill_switch("main"))
    except Exception:
        pass


def test_process_lifecycle_and_kill_switch_resets_mode():
    project_name = "proc-sandbox"
    _cleanup_processes()
    _ensure_project(project_name)

    async def scenario():
        await _allow_run_scope()
        await db.set_project_autonomy_mode(project_name, "TRUSTED")

        port_one = _free_port()
        command = f"python -m http.server {port_one}"
        started = await process_manager.start_process(
            channel="main",
            command=command,
            name="sleepy",
        )
        assert started["status"] == "running"
        assert started["project"] == project_name
        assert started["port"] == port_one

        listed = await process_manager.list_processes("main")
        assert any(item["id"] == started["id"] for item in listed)

        stopped = await process_manager.stop_process("main", started["id"])
        assert stopped["status"] in {"stopped", "exited"}

        port_two = _free_port()
        command2 = f"python -m http.server {port_two}"
        started2 = await process_manager.start_process(
            channel="main",
            command=command2,
            name="sleepy-2",
        )
        assert started2["status"] == "running"

        killed = await process_manager.kill_switch("main")
        assert killed["ok"] is True
        assert killed["autonomy_mode"] == "SAFE"
        assert killed["permission_mode"] == "ask"
        assert killed["stopped_count"] >= 1

        mode = await db.get_project_autonomy_mode(project_name)
        assert mode == "SAFE"
        policy = await db.get_permission_policy("main")
        assert policy["mode"] == "ask"

    _run(scenario())


def test_process_manager_rejects_port_collision():
    project_name = "proc-port-conflict"
    _cleanup_processes()
    _ensure_project(project_name)

    async def scenario():
        await _allow_run_scope()
        await db.set_project_autonomy_mode(project_name, "TRUSTED")

        port = _free_port()
        first = await process_manager.start_process(
            channel="main",
            command=f"python -m http.server {port}",
            name="first",
        )
        assert first["status"] == "running"

        with pytest.raises(ValueError, match="Port .* already in use"):
            await process_manager.start_process(
                channel="main",
                command=f"python -m http.server {port}",
                name="second",
            )

        await process_manager.stop_process("main", first["id"])

    _run(scenario())


def test_process_manager_blocks_locked_permission_mode():
    project_name = "proc-policy-locked"
    _cleanup_processes()
    _ensure_project(project_name)

    async def scenario():
        await db.set_project_autonomy_mode(project_name, "TRUSTED")
        await db.set_permission_policy(
            "main",
            mode="locked",
            scopes=["run"],
            command_allowlist_profile="safe",
        )

        with pytest.raises(ValueError, match="locked"):
            await process_manager.start_process(
                channel="main",
                command=f"python -m http.server {_free_port()}",
                name="blocked",
            )

        await _allow_run_scope()

    _run(scenario())
