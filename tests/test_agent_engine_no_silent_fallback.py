import asyncio

from server import agent_engine
from server import database as db


def _prepare_agent():
    agent = asyncio.run(db.get_agent("codex"))
    assert agent is not None
    agent["backend"] = "openai"
    agent["model"] = "gpt-5.2-codex"
    return agent


def test_openai_failure_does_not_silently_fallback(monkeypatch):
    asyncio.run(db.set_channel_active_project("main", "ai-office"))
    asyncio.run(db.set_setting("providers.fallback_to_ollama", "false"))
    agent = _prepare_agent()

    called = {"ollama": False}

    async def _fake_credentials(**kwargs):  # noqa: ARG001
        return "sk-provider-123", None, None, "provider_default"

    async def _fake_openai_generate(**kwargs):  # noqa: ARG001
        return None

    async def _fake_ollama_generate(**kwargs):  # noqa: ARG001
        called["ollama"] = True
        return "should-not-run"

    monkeypatch.setattr(agent_engine, "_resolve_remote_credentials", _fake_credentials)
    monkeypatch.setattr("server.openai_adapter.generate", _fake_openai_generate)
    monkeypatch.setattr("server.openai_adapter.get_last_error", lambda: "OpenAI key missing/invalid.")
    monkeypatch.setattr("server.ollama_client.generate", _fake_ollama_generate)

    out = asyncio.run(agent_engine._generate(agent, "main", is_followup=False))
    assert isinstance(out, str)
    assert "OpenAI backend error" in out
    assert called["ollama"] is False


def test_openai_failure_uses_explicit_fallback_when_enabled(monkeypatch):
    asyncio.run(db.set_channel_active_project("main", "ai-office"))
    asyncio.run(db.set_setting("providers.fallback_to_ollama", "true"))
    agent = _prepare_agent()

    async def _fake_credentials(**kwargs):  # noqa: ARG001
        return "sk-provider-123", None, None, "provider_default"

    async def _fake_openai_generate(**kwargs):  # noqa: ARG001
        return None

    async def _fake_ollama_available():
        return True

    async def _fake_ollama_generate(**kwargs):  # noqa: ARG001
        return "fallback response"

    monkeypatch.setattr(agent_engine, "_resolve_remote_credentials", _fake_credentials)
    monkeypatch.setattr("server.openai_adapter.generate", _fake_openai_generate)
    monkeypatch.setattr("server.openai_adapter.get_last_error", lambda: "OpenAI timeout.")
    monkeypatch.setattr("server.ollama_client.is_available", _fake_ollama_available)
    monkeypatch.setattr("server.ollama_client.generate", _fake_ollama_generate)

    out = asyncio.run(agent_engine._generate(agent, "main", is_followup=False))
    assert isinstance(out, str)
    assert out.startswith("(FALLBACK: OLLAMA)")
