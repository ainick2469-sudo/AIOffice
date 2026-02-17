import asyncio
from datetime import datetime, timezone

from server import database as db


def _run(coro):
    return asyncio.run(coro)


def test_permission_trusted_mode_expires_to_ask():
    async def scenario():
        expired = datetime(2001, 1, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        await db.set_permission_policy(
            "main",
            mode="trusted",
            expires_at=expired,
            scopes=["read", "search", "run", "write"],
        )
        policy = await db.get_permission_policy("main")
        assert policy["mode"] == "ask"
        assert policy.get("expires_at") in (None, "")

    _run(scenario())

