import asyncio

from server import agent_engine
from server import database as db
from server import openai_adapter


def test_agent_engine_uses_provider_key_ref_when_agent_credential_missing(monkeypatch):
    asyncio.run(db.set_channel_active_project("main", "ai-office"))
    asyncio.run(db.clear_agent_credential("codex", "openai"))
    asyncio.run(
        db.upsert_provider_config(
            "openai",
            key_ref="openai_default",
            base_url="https://provider.example/v1",
            default_model="gpt-4o-mini",
        )
    )
    asyncio.run(db.upsert_provider_secret("openai_default", "sk-provider-fallback-4242"))

    agent = asyncio.run(db.get_agent("codex"))
    assert agent
    agent["backend"] = "openai"
    agent["provider_key_ref"] = "openai_default"
    agent["base_url"] = None

    captured = {}

    async def fake_generate(*, api_key=None, base_url=None, **_kwargs):
        captured["api_key"] = api_key
        captured["base_url"] = base_url
        return "provider path ok"

    monkeypatch.setattr(openai_adapter, "generate", fake_generate)

    out = asyncio.run(agent_engine._generate(agent, "main", is_followup=False))
    assert out == "provider path ok"
    assert captured["api_key"] == "sk-provider-fallback-4242"
    assert captured["base_url"] == "https://provider.example/v1"
