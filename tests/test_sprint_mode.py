import asyncio
import re
import time
from pathlib import Path

from server import agent_engine as engine
from server.database import get_messages, init_db, list_tasks


def test_sprint_start_status_stop_generates_report(monkeypatch):
    marker = f"sprint-marker-{int(time.time())}"

    async def fake_plan(director, channel, goal):
        return (
            f"[TOOL:task] {marker} implement API | builder | 3\n"
            f"[TOOL:task] {marker} write tests | qa | 2\n"
            "Sprint kickoff queued."
        )

    def fake_start_work(channel):
        return {
            "channel": channel,
            "running": True,
            "processed": 0,
            "errors": 0,
            "started_at": int(time.time()),
            "last_task_at": None,
        }

    def fake_stop_work(channel):
        return {
            "channel": channel,
            "running": False,
            "processed": 0,
            "errors": 0,
            "started_at": int(time.time()),
            "last_task_at": None,
        }

    monkeypatch.setattr(engine, "_generate_sprint_task_plan", fake_plan)
    monkeypatch.setattr(engine.autonomous_worker, "start_work", fake_start_work)
    monkeypatch.setattr(engine.autonomous_worker, "stop_work", fake_stop_work)
    monkeypatch.setattr(
        engine.build_runner,
        "get_build_config",
        lambda _project: {"build_cmd": "", "test_cmd": "", "run_cmd": ""},
    )
    monkeypatch.setattr(
        engine.git_tools,
        "status",
        lambda _project: {"ok": True, "stdout": "A  src/new.py\nM  README.md\n"},
    )

    channel = f"test-sprint-{int(time.time())}"

    async def scenario():
        await init_db()

        await engine.process_message(channel, "/sprint start 30m finish login system")
        await asyncio.sleep(0.2)

        status = engine.get_collab_mode_status(channel)
        assert status.get("active") is True
        assert status.get("mode") == "sprint"
        assert "finish login system" in (status.get("goal") or "")

        tasks = await list_tasks()
        assert any(marker in str(task.get("title", "")) for task in tasks)

        await engine.process_message(channel, "/sprint status")
        await engine.process_message(channel, "/sprint stop")
        await asyncio.sleep(0.2)

        stopped = engine.get_collab_mode_status(channel)
        assert stopped.get("active") is False

        messages = await get_messages(channel, limit=120)
        assert any(
            "SPRINT STARTED" in (msg.get("content") or "")
            for msg in messages
            if msg.get("sender") == "system"
        )

        reports = [
            msg.get("content", "")
            for msg in messages
            if msg.get("sender") == "system" and "SPRINT REPORT" in (msg.get("content") or "")
        ]
        assert reports, "Expected sprint report system message"

        report_text = reports[-1]
        match = re.search(r"Report saved to `([^`]+)`", report_text)
        assert match, "Expected saved report path in sprint report message"
        assert Path(match.group(1)).exists()

    asyncio.run(scenario())
