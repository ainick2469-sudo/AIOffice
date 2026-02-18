import asyncio

from server import agent_engine
from server import database as db


def test_backend_unavailable_returns_helpful_message(monkeypatch):
    # Ensure tests don't pick up developer keys via env.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    asyncio.run(db.set_channel_active_project("main", "ai-office"))
    try:
        asyncio.run(db.clear_agent_credential("codex", "openai"))
    except Exception:
        pass
    try:
        asyncio.run(db.clear_provider_secret("openai_default"))
    except Exception:
        pass

    agent = asyncio.run(db.get_agent("codex"))
    assert agent
    agent["backend"] = "openai"

    out = asyncio.run(agent_engine._generate(agent, "main", is_followup=False))
    assert isinstance(out, str)
    assert "OPENAI_API_KEY" in out or "Agents tab" in out
