import asyncio
import sys

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


def test_process_lifecycle_and_kill_switch_resets_mode():
    project_name = "proc-sandbox"
    _ensure_project(project_name)

    async def scenario():
        await db.set_project_autonomy_mode(project_name, "TRUSTED")

        command = f"\"{sys.executable}\" -c \"import time; print('started'); time.sleep(8)\""
        started = await process_manager.start_process(
            channel="main",
            command=command,
            name="sleepy",
        )
        assert started["status"] == "running"
        assert started["project"] == project_name

        listed = await process_manager.list_processes("main")
        assert any(item["id"] == started["id"] for item in listed)

        stopped = await process_manager.stop_process("main", started["id"])
        assert stopped["status"] in {"stopped", "exited"}

        command2 = f"\"{sys.executable}\" -c \"import time; time.sleep(12)\""
        started2 = await process_manager.start_process(
            channel="main",
            command=command2,
            name="sleepy-2",
        )
        assert started2["status"] == "running"

        killed = await process_manager.kill_switch("main")
        assert killed["ok"] is True
        assert killed["autonomy_mode"] == "SAFE"
        assert killed["stopped_count"] >= 1

        mode = await db.get_project_autonomy_mode(project_name)
        assert mode == "SAFE"

    _run(scenario())
