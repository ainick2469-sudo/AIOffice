import asyncio
import sys
import time

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


async def _allow_run_scope():
    await db.set_permission_policy(
        "main",
        mode="ask",
        scopes=["read", "search", "run", "write", "task", "pip", "git"],
        command_allowlist_profile="safe",
    )


def test_process_records_persist_and_close_cleanly():
    project_name = "proc-registry"
    _ensure_project(project_name)

    async def scenario():
        await _allow_run_scope()
        await db.set_project_autonomy_mode(project_name, "TRUSTED")

        started = await process_manager.start_process(
            channel="main",
            command="python -m http.server 0",
            name="registry",
        )
        pid = started.get("pid")
        assert started["status"] == "running"
        assert pid

        running = await db.list_managed_processes(channel="main", project_name=project_name, status="running")
        assert any(item.get("process_id") == started["id"] for item in running)

        await process_manager.stop_process("main", started["id"])
        running_after = await db.list_managed_processes(channel="main", project_name=project_name, status="running")
        assert not any(item.get("process_id") == started["id"] for item in running_after)

    _run(scenario())


def test_orphan_detection_and_cleanup():
    project_name = "proc-orphans"
    _ensure_project(project_name)

    async def scenario():
        # Spawn a process outside the in-memory registry, then persist it as a "running" managed process.
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            "import time; time.sleep(60)",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        process_id = "orphan-test-" + str(int(time.time()))
        try:
            await db.upsert_managed_process(
                process_id=process_id,
                session_id="old-session",
                channel="main",
                project_name=project_name,
                pid=proc.pid,
                command="python -c sleep",
                cwd=".",
                status="running",
                started_at=int(time.time()),
                metadata={"name": "orphan-test"},
            )

            orphans = await process_manager.list_orphan_processes(channel="main", project_name=project_name)
            assert any(item.get("process_id") == process_id for item in orphans)

            cleanup = await process_manager.cleanup_orphan_processes(
                channel="main",
                project_name=project_name,
                process_ids=[process_id],
            )
            assert cleanup["killed_count"] == 1

            await asyncio.wait_for(proc.wait(), timeout=10)
            orphans_after = await process_manager.list_orphan_processes(channel="main", project_name=project_name)
            assert not any(item.get("process_id") == process_id for item in orphans_after)
        finally:
            try:
                proc.kill()
            except Exception:
                pass
            try:
                await proc.wait()
            except Exception:
                pass

    _run(scenario())

