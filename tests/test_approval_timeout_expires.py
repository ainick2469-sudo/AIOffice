import asyncio

from server import database as db
from server import tool_executor


def _run(coro):
    return asyncio.run(coro)


def test_approval_timeout_marks_request_expired(monkeypatch):
    monkeypatch.setenv("AI_OFFICE_APPROVAL_TTL_SECONDS", "1")

    async def scenario():
        await db.set_permission_policy(
            "main",
            mode="ask",
            scopes=["read", "search", "run", "write", "task"],
            command_allowlist_profile="safe",
        )

        results = await tool_executor.execute_tool_calls(
            "builder",
            [{"type": "run", "arg": "python -m py_compile server/main.py"}],
            "main",
        )
        assert results
        result = results[0].get("result") or {}
        request = result.get("request") or {}
        request_id = request.get("id") or ""
        assert request_id

        row = await db.get_approval_request(request_id)
        assert row is not None
        assert row.get("status") == "expired"

    _run(scenario())

