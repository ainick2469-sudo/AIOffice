import asyncio
import time

from server import database as db
from server import agent_engine as engine
from server.database import get_messages, init_db


def test_brainstorm_mode_start_round_stop(monkeypatch):
    async def fake_generate(*args, **kwargs):
        system = str(kwargs.get("system", "") or "")
        prompt = str(kwargs.get("prompt", "") or "")
        if "Now respond as Spark" in prompt:
            return "What if we build a tiny product lab where users vote on weekly prototypes?"
        if "Now respond as Ada" in prompt:
            return "I propose a modular plugin architecture that can test one idea per sprint."
        if "Now respond as Uma" in prompt:
            return "Let's ship a guided UX checklist that highlights friction in live flows."
        if "Now respond as Leo" in prompt:
            return "We could frame every release as a story-driven mission with clear user stakes."
        if "Now respond as Sage" in prompt:
            return "Build a scope guard that blocks feature creep unless one feature ships first."
        if "BRAINSTORM MODE" in system:
            return "Here's one specific idea from my role with a clear outcome."
        return "PASS"

    monkeypatch.setattr(engine.ollama_client, "generate", fake_generate)
    async def fake_is_available():
        return True

    monkeypatch.setattr(engine.ollama_client, "is_available", fake_is_available)
    monkeypatch.setattr(engine, "PAUSE_BETWEEN_AGENTS", 0.01)

    channel = f"test-brainstorm-{int(time.time())}"

    async def scenario():
        await init_db()
        await engine.process_message(channel, "/brainstorm developer workflow")

        mode = {}
        for _ in range(120):
            await asyncio.sleep(0.05)
            mode = engine.get_collab_mode_status(channel)
            if mode.get("last_round_ids"):
                break

        assert mode.get("mode") == "brainstorm"
        assert mode.get("active") is True
        idea_ids = mode.get("last_round_ids", [])
        assert len(idea_ids) >= 3

        await db.toggle_message_reaction(
            message_id=idea_ids[0],
            actor_id="user",
            actor_type="user",
            emoji="👍",
        )
        await db.toggle_message_reaction(
            message_id=idea_ids[0],
            actor_id="user-2",
            actor_type="user",
            emoji="👍",
        )

        await engine.process_message(channel, "/brainstorm stop")
        status = engine.get_collab_mode_status(channel)
        assert status.get("active") is False

        messages = await get_messages(channel, limit=100)
        assert any(
            "BRAINSTORM MODE" in (msg.get("content") or "")
            for msg in messages
            if msg.get("sender") == "system"
        )
        assert any(
            "Top-voted ideas" in (msg.get("content") or "")
            for msg in messages
            if msg.get("sender") == "system"
        )

    asyncio.run(scenario())
