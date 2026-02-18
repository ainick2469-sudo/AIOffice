import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from server import database as db
from server import memory
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_memory_stats_and_erase_scopes_and_optional_clears():
    project = "ai-office"

    assert memory.write_memory(None, {"type": "fact", "content": "Fact: the sky is blue."}, project_name=project)
    assert memory.write_memory(None, {"type": "decision", "content": "Decision: use SQLite for local state."}, project_name=project)
    assert memory.write_memory("builder", {"type": "fact", "content": "Builder note: run pytest after writes."}, project_name=project)

    task = _run(
        db.create_task_record(
            {"title": "demo-task", "description": "demo"},
            channel="main",
            project_name=project,
        )
    )
    assert task.get("id")

    request_id = uuid4().hex[:16]
    payload = {
        "id": request_id,
        "channel": "main",
        "project_name": project,
        "branch": "main",
        "agent_id": "builder",
        "tool_type": "write",
        "command": "write apps/demo.txt",
        "args": {"path": "apps/demo.txt"},
        "preview": "",
        "risk_level": "medium",
        "created_at": "2026-02-18T00:00:00Z",
    }
    _run(
        db.create_approval_request(
            request_id=request_id,
            channel="main",
            agent_id="builder",
            tool_type="write",
            payload=payload,
            risk_level="medium",
            project_name=project,
            branch="main",
        )
    )

    client = TestClient(app)
    before = client.get("/api/memory/stats", params={"project": project}).json()
    assert before["project"] == project
    assert before["facts_count"] >= 1
    assert before["decisions_count"] >= 1
    assert before["agent_entries"] >= 1
    assert before["index_rows"] >= 1

    resp = client.post(
        "/api/memory/erase",
        json={
            "project": project,
            "channel": "main",
            "scopes": ["facts", "decisions", "daily", "agent_logs", "index"],
            "also_clear_tasks": True,
            "also_clear_approvals": True,
            "also_clear_channel_messages": False,
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload.get("ok") is True
    assert payload.get("project") == project
    assert set(payload.get("scopes_erased") or []) == {"facts", "decisions", "daily", "agent_logs", "index"}

    after = client.get("/api/memory/stats", params={"project": project}).json()
    assert after["facts_count"] == 0
    assert after["decisions_count"] == 0
    assert after["daily_files"] == 0
    assert after["agent_entries"] == 0
    assert after["index_rows"] == 0

    tasks = _run(db.list_tasks(channel="main", project_name=project))
    assert tasks == []
    assert _run(db.get_approval_request(request_id)) is None

