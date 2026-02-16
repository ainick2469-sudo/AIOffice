import asyncio
import time

from server import agent_engine as engine
from server.database import get_agent, get_messages, init_db


def test_manual_warroom_start_stop():
    channel = f"test-warroom-{int(time.time())}"

    async def scenario():
        await init_db()
        await engine.process_message(channel, "/warroom build failures in checkout flow")
        status = engine.get_collab_mode_status(channel)
        assert status.get("active") is True
        assert status.get("mode") == "warroom"
        assert status.get("issue")

        await engine.process_message(channel, "/warroom stop")
        stopped = engine.get_collab_mode_status(channel)
        assert stopped.get("active") is False

        messages = await get_messages(channel, limit=30)
        assert any(
            "WAR ROOM" in (m.get("content") or "")
            for m in messages
            if m.get("sender") == "system"
        )
        assert any(
            "War Room closed" in (m.get("content") or "")
            for m in messages
            if m.get("sender") == "system"
        )

    asyncio.run(scenario())


def test_auto_warroom_on_repeated_build_failures(monkeypatch):
    channel = f"test-warroom-auto-{int(time.time())}"

    def fake_build_config(_project):
        return {"build_cmd": "python -m py_compile main.py", "test_cmd": ""}

    def fake_run_build(project_name):
        return {
            "ok": False,
            "project": project_name,
            "command": "python -m py_compile main.py",
            "exit_code": 1,
            "stderr": "simulated build failure",
        }

    async def fake_generate(*args, **kwargs):
        return "Applying another fix attempt."

    monkeypatch.setattr(engine.build_runner, "get_build_config", fake_build_config)
    monkeypatch.setattr(engine.build_runner, "run_build", fake_run_build)
    monkeypatch.setattr(engine, "_generate", fake_generate)

    async def scenario():
        await init_db()
        agent = await get_agent("builder")
        assert agent is not None
        await engine._run_build_test_loop(agent, channel)
        status = engine.get_collab_mode_status(channel)
        assert status.get("active") is True
        assert status.get("mode") == "warroom"
        assert "failing repeatedly" in (status.get("issue") or "")

    asyncio.run(scenario())
