import asyncio

from fastapi.testclient import TestClient

from server import database as db
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_tools_run_structured_argv_allows_semicolons_in_args():
    async def setup():
        await db.set_project_autonomy_mode("ai-office", "TRUSTED")
        await db.set_permission_policy(
            "main",
            mode="trusted",
            scopes=["read", "search", "run", "write", "task"],
            command_allowlist_profile="safe",
        )

    _run(setup())
    client = TestClient(app)

    resp = client.post(
        "/api/tools/run",
        json={
            "channel": "main",
            "agent_id": "builder",
            "cmd": ["python", "-c", "import sys; print('argv-ok')"],
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("ok") is True
    assert "argv-ok" in (payload.get("stdout") or "")

    _run(db.set_project_autonomy_mode("ai-office", "SAFE"))

