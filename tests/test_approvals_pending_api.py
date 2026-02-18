import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from server import database as db
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_pending_approvals_endpoint_returns_expiry_and_context_fields():
    async def seed():
        rid = uuid4().hex[:16]
        now = datetime.now(timezone.utc).replace(microsecond=0)
        created_at = now.isoformat().replace("+00:00", "Z")
        expires_at = (now + timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
        payload = {
            "id": rid,
            "channel": "main",
            "project_name": "ai-office",
            "branch": "main",
            "agent_id": "builder",
            "tool_type": "write",
            "command": "write apps/demo.txt",
            "args": {"path": "apps/demo.txt"},
            "preview": "",
            "risk_level": "medium",
            "created_at": created_at,
            "expires_at": expires_at,
        }
        await db.create_approval_request(
            request_id=rid,
            channel="main",
            agent_id="builder",
            tool_type="write",
            payload=payload,
            risk_level="medium",
            project_name="ai-office",
            branch="main",
            expires_at=expires_at,
        )
        return rid

    request_id = _run(seed())
    client = TestClient(app)
    resp = client.get("/api/approvals/pending", params={"channel": "main", "project": "ai-office"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("ok") is True
    requests = payload.get("requests") or []
    match = next((item for item in requests if item.get("id") == request_id), None)
    assert match is not None
    assert match.get("project_name") == "ai-office"
    assert match.get("branch") == "main"
    assert match.get("expires_at")

