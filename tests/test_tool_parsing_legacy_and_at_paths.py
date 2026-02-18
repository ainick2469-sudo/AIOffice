import asyncio

from server import database as db
from server import project_manager
from server import tool_gateway
from server.tool_executor import parse_tool_calls


def _run(coro):
    return asyncio.run(coro)


def test_toolwrite_legacy_header_parses_and_at_paths_are_canonicalized():
    text = "[TOOLwrite] @apps/test.txt\n```txt\nhello\n```"
    calls = parse_tool_calls(text)
    assert calls
    assert calls[0]["type"] == "write"
    assert calls[0]["path"] == "@apps/test.txt"

    async def scenario():
        project = "proj-toolwrite"
        previous = await project_manager.get_active_project("main")
        try:
            await project_manager.create_project(project)
        except Exception:
            # Idempotent local runs: an existing project is acceptable.
            pass
        try:
            await project_manager.switch_project("main", project)

            # Ensure write scope is available in case other tests changed the policy.
            await db.set_permission_policy(
                "main",
                mode="trusted",
                scopes=["read", "search", "run", "write", "task"],
                command_allowlist_profile="safe",
            )

            result = await tool_gateway.tool_write_file(
                "builder",
                calls[0]["path"],
                calls[0]["content"],
                approved=True,
                channel="main",
            )
            assert result.get("ok") is True

            sandbox = await project_manager.get_sandbox_root("main")
            assert (sandbox / "apps" / "test.txt").exists()
            assert not (sandbox / "@apps" / "test.txt").exists()
        finally:
            # Restore channel state so other tests that assume app-root behavior remain stable.
            await project_manager.switch_project("main", previous.get("project") or "ai-office")

    _run(scenario())
