import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_spec_gate_blocks_mutating_tools_until_approved():
    from server import project_manager as pm
    from server import database as db
    from server.agent_engine import _send

    project_name = f"spec-gate-{uuid4().hex[:6]}"

    async def setup():
        await pm.create_project(project_name)
        await pm.switch_project("main", project_name)
        return await pm.get_active_project("main")

    active = _run(setup())
    try:
        assert active.get("project") == project_name
        repo_root = Path(active["path"]).resolve()

        # Ensure later tests can't strand us in ASK mode (which would cause approval waits).
        _run(
            db.set_permission_policy(
                "main",
                mode="trusted",
                scopes=["read", "search", "run", "write", "task"],
                command_allowlist_profile="safe",
            )
        )

        client = TestClient(app)

        # Saving a spec sets DRAFT state for this channel+project.
        resp = client.post(
            "/api/spec/current",
            json={"channel": "main", "spec_md": "# Spec\n\nDraft", "idea_bank_md": "# Ideas\n- A"},
        )
        assert resp.status_code == 200
        payload = resp.json()
        assert payload.get("status") == "draft"

        agent = {"id": "builder", "display_name": "Max"}
        tool_msg = "[TOOL:write] apps/specgate.txt\n```txt\nhello\n```"

        # While spec is DRAFT, mutating tools must not execute.
        _run(_send(agent, "main", tool_msg, run_post_checks=False))
        target = repo_root / "apps" / "specgate.txt"
        assert not target.exists()

        # Approve spec, then tools can execute.
        resp2 = client.post("/api/spec/approve", json={"channel": "main", "confirm_text": "APPROVE SPEC"})
        assert resp2.status_code == 200
        assert (resp2.json().get("status") or "").lower() == "approved"

        _run(_send(agent, "main", tool_msg, run_post_checks=False))
        assert target.exists()
        assert "hello" in target.read_text(encoding="utf-8")
    finally:
        # Restore app-root project context so later tests that reference server/* files stay valid.
        _run(db.set_channel_active_project("main", "ai-office"))
