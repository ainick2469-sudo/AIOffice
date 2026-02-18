import asyncio

from server import database as db


def test_codex_default_migration_runs_on_init_db():
    asyncio.run(db.update_agent("codex", {"backend": "ollama", "model": "qwen2.5:14b"}))

    asyncio.run(db.init_db())

    codex = asyncio.run(db.get_agent("codex"))
    assert codex is not None
    assert codex["backend"] == "openai"
    assert codex["model"] == "gpt-4o-mini"
    assert codex.get("provider_key_ref") == "openai_default"
