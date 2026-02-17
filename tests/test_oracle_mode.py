import asyncio
import time
from pathlib import Path

from server import agent_engine as engine
from server.database import get_messages, init_db
from server.runtime_config import APP_ROOT


def test_oracle_file_selection_prefers_routes_for_endpoint_questions():
    root = Path(APP_ROOT)
    selected = engine._oracle_select_files(root, "how many API endpoints do we have?")
    assert selected, "Oracle should select at least one file"
    assert any("routes_api.py" in path.as_posix().lower() for path in selected)


def test_oracle_command_posts_system_and_agent_answer(monkeypatch):
    async def fake_oracle_answer(agent, channel, question, file_context, file_tree):
        assert "endpoint" in question.lower()
        assert len(file_context) > 0
        return "Oracle answer: endpoint definitions are in server/routes_api.py."

    monkeypatch.setattr(engine, "_generate_oracle_answer", fake_oracle_answer)

    channel = f"test-oracle-{int(time.time())}"

    async def scenario():
        await init_db()
        await engine.process_message(channel, "/oracle how many API endpoints do we have?")
        await asyncio.sleep(0.05)
        messages = await get_messages(channel, limit=30)
        assert any(
            "Oracle mode — reading project files" in (m.get("content") or "")
            for m in messages
            if m.get("sender") == "system"
        )
        assert any(
            "Oracle answer:" in (m.get("content") or "")
            for m in messages
            if m.get("sender") in {"researcher", "director"}
        )

    asyncio.run(scenario())
