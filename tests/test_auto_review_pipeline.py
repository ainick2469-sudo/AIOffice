import asyncio
import time

from server import agent_engine as engine
from server.database import get_agent, get_messages, init_db, list_tasks


def test_auto_review_creates_review_message_and_task(monkeypatch):
    async def fake_execute_tool_calls(agent_id, calls, channel):
        return [
            {
                "type": "write",
                "path": "src/new_feature.py",
                "result": {"ok": True, "action": "written"},
                "msg": "ok",
            }
        ]

    async def fake_generate_auto_review(reviewer, channel, file_path, author_agent, excerpt):
        return (
            "Severity: critical\n"
            "- Missing input validation can crash on empty payloads.\n"
            "- Add guard clauses and explicit error handling."
        )

    async def fake_build_loop(agent, channel):
        return None

    monkeypatch.setattr(engine, "execute_tool_calls", fake_execute_tool_calls)
    monkeypatch.setattr(engine, "_generate_auto_review", fake_generate_auto_review)
    monkeypatch.setattr(engine, "_run_build_test_loop", fake_build_loop)

    channel = f"test-auto-review-{int(time.time())}"

    async def scenario():
        await init_db()
        builder = await get_agent("builder")
        assert builder is not None

        await engine._send(
            builder,
            channel,
            "[TOOL:write] src/new_feature.py\n```python\nprint('ok')\n```",
        )

        messages = await get_messages(channel, limit=40)
        assert any(
            msg.get("sender") == "reviewer" and "Code Review" in (msg.get("content") or "")
            for msg in messages
        )

        tasks = await list_tasks()
        assert any(
            task.get("assigned_to") == "builder"
            and str(task.get("title", "")).startswith("Fix:")
            and "src/new_feature.py" in [str(item) for item in task.get("linked_files", [])]
            for task in tasks
        )

    asyncio.run(scenario())


def test_review_off_disables_auto_review(monkeypatch):
    async def fake_execute_tool_calls(agent_id, calls, channel):
        return [
            {
                "type": "write",
                "path": "src/no_review.py",
                "result": {"ok": True, "action": "written"},
                "msg": "ok",
            }
        ]

    async def fake_build_loop(agent, channel):
        return None

    calls = {"count": 0}

    async def fake_generate_auto_review(*args, **kwargs):
        calls["count"] += 1
        return "Severity: ok\n- Looks good."

    monkeypatch.setattr(engine, "execute_tool_calls", fake_execute_tool_calls)
    monkeypatch.setattr(engine, "_run_build_test_loop", fake_build_loop)
    monkeypatch.setattr(engine, "_generate_auto_review", fake_generate_auto_review)

    channel = f"test-auto-review-off-{int(time.time())}"

    async def scenario():
        await init_db()
        await engine.process_message(channel, "/review off")

        builder = await get_agent("builder")
        assert builder is not None
        await engine._send(
            builder,
            channel,
            "[TOOL:write] src/no_review.py\n```python\nprint('skip')\n```",
        )

        assert calls["count"] == 0

    asyncio.run(scenario())
