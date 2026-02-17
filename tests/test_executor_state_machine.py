import asyncio
import time

from server import agent_engine as engine
from server import autonomous_worker as worker
from server import database as db


def _run(coro):
    return asyncio.run(coro)


async def _wait_until(predicate, timeout: float = 8.0, interval: float = 0.05) -> bool:
    started = time.time()
    while time.time() - started <= timeout:
        if predicate():
            return True
        await asyncio.sleep(interval)
    return False


def test_executor_state_machine_gate_then_complete(monkeypatch):
    channel = f"test-executor-gate-{int(time.time())}"
    prompts: list[str] = []

    async def fake_process_message(target_channel: str, content: str):
        if target_channel == channel:
            prompts.append(content)

    async def fake_verify(_channel: str):
        return True, "verification ok"

    monkeypatch.setattr(engine, "process_message", fake_process_message)
    monkeypatch.setattr(worker, "_verify_active_project", fake_verify)
    monkeypatch.setattr(worker, "WORK_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(worker, "GATE_POLL_SECONDS", 0.05)
    monkeypatch.setattr(worker, "MAX_TASKS_PER_SESSION", 5)
    monkeypatch.setattr(worker, "MAX_TASK_RETRIES", 2)

    async def scenario():
        await db.init_db()
        await db.set_channel_active_project(channel, "ai-office")
        await db.set_permission_policy(
            channel,
            mode="ask",
            scopes=["read", "search", "run", "write", "task", "pip", "git"],
            command_allowlist_profile="safe",
        )
        task = await db.create_task_record(
            {
                "title": "state machine gate flow",
                "description": "ensure gate waits and then proceeds",
                "assigned_to": "builder",
                "created_by": "test",
            },
            channel=channel,
            project_name="ai-office",
        )

        started = worker.start_work(channel, approved=True)
        assert started["running"] is True

        gate_reached = await _wait_until(
            lambda: (
                (status := worker.get_work_status(channel))["phase"] == "gate"
                and bool(status["awaiting_approval"])
                and int(status.get("current_task_id") or 0) == int(task["id"])
            )
        )
        assert gate_reached, f"Worker did not reach gate phase: {worker.get_work_status(channel)}"

        approved = worker.approve_current_gate(channel)
        assert approved["awaiting_approval"] is False

        completed = await _wait_until(lambda: not worker.get_work_status(channel)["running"])
        assert completed, f"Worker did not stop: {worker.get_work_status(channel)}"

        latest = await db.get_task(task["id"])
        assert latest is not None
        assert latest["status"] == "done"

        events = await db.get_console_events(channel=channel, limit=300, event_type="work_phase")
        phases = [str(item.get("data", {}).get("phase")) for item in events]
        for phase in ("plan", "gate", "execute", "verify", "deliver"):
            assert phase in phases

        assert any("[AUTONOMOUS PLAN]" in entry for entry in prompts)
        assert any("[AUTONOMOUS EXECUTE]" in entry for entry in prompts)
        assert any("[AUTONOMOUS DELIVER]" in entry for entry in prompts)

        worker.stop_work(channel)

    _run(scenario())


def test_executor_state_machine_verify_retry_then_block(monkeypatch):
    channel = f"test-executor-retry-{int(time.time())}"
    prompts: list[str] = []

    async def fake_process_message(target_channel: str, content: str):
        if target_channel == channel:
            prompts.append(content)

    async def failing_verify(_channel: str):
        return False, "synthetic verify failure"

    monkeypatch.setattr(engine, "process_message", fake_process_message)
    monkeypatch.setattr(worker, "_verify_active_project", failing_verify)
    monkeypatch.setattr(worker, "WORK_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(worker, "GATE_POLL_SECONDS", 0.05)
    monkeypatch.setattr(worker, "MAX_TASKS_PER_SESSION", 5)
    monkeypatch.setattr(worker, "MAX_TASK_RETRIES", 2)

    async def scenario():
        await db.init_db()
        await db.set_channel_active_project(channel, "ai-office")
        await db.issue_trusted_session(channel, minutes=30)
        task = await db.create_task_record(
            {
                "title": "state machine verify retries",
                "description": "verify should fail and block task",
                "assigned_to": "builder",
                "created_by": "test",
            },
            channel=channel,
            project_name="ai-office",
        )

        started = worker.start_work(channel, approved=True)
        assert started["running"] is True

        completed = await _wait_until(lambda: not worker.get_work_status(channel)["running"], timeout=10)
        assert completed, f"Worker did not stop: {worker.get_work_status(channel)}"

        latest = await db.get_task(task["id"])
        assert latest is not None
        assert latest["status"] == "blocked"

        status = worker.get_work_status(channel)
        assert int(status.get("processed") or 0) >= 1
        assert int(status.get("errors") or 0) >= 1

        assert any("[AUTONOMOUS VERIFY FAILED]" in entry for entry in prompts)

        worker.stop_work(channel)

    _run(scenario())
