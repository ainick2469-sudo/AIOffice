import asyncio

from server import agent_engine
from server import database as db
from server import openai_adapter


def test_agent_engine_passes_openai_credential_overrides(monkeypatch):
    asyncio.run(db.set_channel_active_project("main", "ai-office"))
    asyncio.run(
        db.upsert_agent_credential(
            agent_id="codex",
            backend="openai",
            api_key="sk-test-override-9999",
            base_url="https://example.com/v1",
        )
    )

    agent = asyncio.run(db.get_agent("codex"))
    assert agent
    agent["backend"] = "openai"

    captured = {}

    async def fake_generate(*, api_key=None, base_url=None, **_kwargs):
        captured["api_key"] = api_key
        captured["base_url"] = base_url
        return "Okay"

    monkeypatch.setattr(openai_adapter, "generate", fake_generate)

    out = asyncio.run(agent_engine._generate(agent, "main", is_followup=False))
    assert out == "Okay"
    assert captured["api_key"] == "sk-test-override-9999"
    assert captured["base_url"] == "https://example.com/v1"
