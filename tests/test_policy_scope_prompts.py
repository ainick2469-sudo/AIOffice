import asyncio

from server import database as db
from server.policy import evaluate_tool_policy


def _run(coro):
    return asyncio.run(coro)


def test_pip_scope_missing_requires_approval_in_ask_mode():
    async def scenario():
        channel = "scope-test"
        previous_mode = await db.get_project_autonomy_mode("ai-office")
        await db.set_project_autonomy_mode("ai-office", "TRUSTED")
        await db.set_permission_policy(
            channel,
            mode="ask",
            scopes=["read", "search", "run", "write", "task"],
            command_allowlist_profile="safe",
        )

        decision = await evaluate_tool_policy(
            channel=channel,
            tool_type="run",
            agent_id="builder",
            command="pip install requests",
            target_path=".",
            approved=False,
        )
        assert decision.get("allowed") is False
        assert decision.get("requires_approval") is True
        assert decision.get("missing_scope") == "pip"

        # Clean up
        await db.set_project_autonomy_mode("ai-office", previous_mode)

    _run(scenario())
