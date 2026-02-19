import asyncio

from server import database as db


def test_codex_default_migration_runs_on_init_db():
    async def _prepare_legacy_codex():
        conn = await db.get_db()
        try:
            await conn.execute(
                "UPDATE agents SET backend = ?, model = ?, user_overrides = ? WHERE id = ?",
                ("ollama", "qwen2.5:14b", "{}", "codex"),
            )
            await conn.commit()
        finally:
            await conn.close()

    asyncio.run(_prepare_legacy_codex())

    asyncio.run(db.init_db())

    codex = asyncio.run(db.get_agent("codex"))
    assert codex is not None
    assert codex["backend"] == "openai"
    assert codex["model"] == "gpt-5.2-codex"
    assert codex.get("provider_key_ref") == "openai_default"
