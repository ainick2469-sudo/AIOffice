import asyncio

from server import database as db
from server import tool_gateway


def _run(coro):
    return asyncio.run(coro)


def test_tool_run_waits_for_approval_then_executes():
    async def scenario():
        await db.set_permission_policy("main", mode="ask", scopes=["read", "search", "run"])
        result = await tool_gateway.tool_run_command(
            "builder",
            "python -m py_compile server/main.py",
            channel="main",
            approved=False,
        )
        assert result.get("status") == "needs_approval"
        request_id = result["request"]["id"]

        waiter = asyncio.create_task(tool_gateway.wait_for_approval_response(request_id, timeout_seconds=5))
        await asyncio.sleep(0.05)
        resolved = await tool_gateway.resolve_approval_response(request_id, approved=True, decided_by="user")
        assert resolved is not None
        assert resolved.get("status") == "approved"

        approved = await waiter
        assert approved is True

        rerun = await tool_gateway.tool_run_command(
            "builder",
            "python -m py_compile server/main.py",
            channel="main",
            approved=True,
        )
        assert rerun.get("ok") is True

    _run(scenario())

