import asyncio
import time

from fastapi.testclient import TestClient

from server import database as db
from server import memory
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def _create_task(client: TestClient, title: str, channel: str, project: str) -> dict:
    response = client.post(
        "/api/tasks",
        json={
            "title": title,
            "description": "cleanup test",
            "channel": channel,
            "project_name": project,
            "branch": "main",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_tasks_clear_endpoints():
    client = TestClient(app)
    stamp = int(time.time())
    project_a = f"cleanup-a-{stamp}"
    project_b = f"cleanup-b-{stamp}"

    _create_task(client, "task-a-1", "main", project_a)
    _create_task(client, "task-a-2", "main", project_a)
    _create_task(client, "task-b-1", "main", project_b)

    clear_project = client.delete("/api/tasks/clear", params={"project": project_a})
    assert clear_project.status_code == 200
    payload = clear_project.json()
    assert payload["ok"] is True
    assert payload["project"] == project_a
    assert payload["deleted"] >= 2

    remaining_a = client.get("/api/tasks", params={"project_name": project_a, "channel": "main"})
    assert remaining_a.status_code == 200
    assert remaining_a.json() == []

    remaining_b = client.get("/api/tasks", params={"project_name": project_b, "channel": "main"})
    assert remaining_b.status_code == 200
    assert len(remaining_b.json()) >= 1

    clear_all = client.delete("/api/tasks/clear-all")
    assert clear_all.status_code == 200
    assert clear_all.json()["ok"] is True
    assert clear_all.json()["deleted"] >= 1


def test_memory_clear_endpoints():
    client = TestClient(app)
    stamp = int(time.time())
    project = f"memory-clear-{stamp}"

    assert memory.write_memory(None, {"type": "fact", "content": "project fact one"}, project_name=project)
    assert memory.write_memory("builder", {"type": "fact", "content": "agent fact one"}, project_name=project)

    agent_clear = client.delete(f"/api/memory/agent/builder?project={project}")
    assert agent_clear.status_code == 200
    agent_payload = agent_clear.json()
    assert agent_payload["ok"] is True
    assert agent_payload["project"] == project
    assert agent_payload["agent_id"] == "builder"

    project_clear = client.delete(f"/api/memory/project/{project}")
    assert project_clear.status_code == 200
    project_payload = project_clear.json()
    assert project_payload["ok"] is True
    assert project_payload["project"] == project
    assert set(project_payload["scopes_erased"]) == {"facts", "decisions", "daily", "agent_logs", "index"}

    all_clear = client.delete("/api/memory/all")
    assert all_clear.status_code == 200
    all_payload = all_clear.json()
    assert all_payload["ok"] is True
    assert "removed" in all_payload


def test_system_reset_preserves_agents_and_providers():
    client = TestClient(app)
    stamp = int(time.time())
    project = f"reset-{stamp}"

    _run(
        db.insert_message(
            channel="main",
            sender="user",
            content="runtime reset test message",
            msg_type="message",
        )
    )
    _run(
        db.create_task_record(
            {"title": "runtime reset task", "description": "cleanup", "status": "backlog"},
            channel="main",
            project_name=project,
        )
    )
    assert memory.write_memory(None, {"type": "fact", "content": "reset memory content"}, project_name=project)

    reset_response = client.post("/api/system/reset")
    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["ok"] is True
    assert reset_payload["runtime"]["ok"] is True
    assert reset_payload["memory"]["ok"] is True

    tasks_after = client.get("/api/tasks", params={"channel": "main"})
    assert tasks_after.status_code == 200
    assert tasks_after.json() == []

    providers_after = client.get("/api/providers")
    assert providers_after.status_code == 200
    providers_payload = providers_after.json()
    assert isinstance(providers_payload.get("providers"), list)
    assert len(providers_payload.get("providers")) >= 1

    agents_after = client.get("/api/agents")
    assert agents_after.status_code == 200
    assert isinstance(agents_after.json(), list)
    assert len(agents_after.json()) >= 1
