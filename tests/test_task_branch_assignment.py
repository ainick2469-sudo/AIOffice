import pytest
from fastapi.testclient import TestClient

from server.main import app


def test_task_branch_assignment_and_filtering():
    client = TestClient(app)
    project_name = "task-branch-api"
    channel = "task-branch-room"

    client.post("/api/projects", json={"name": project_name})
    switched = client.post("/api/projects/switch", json={"channel": channel, "name": project_name})
    assert switched.status_code == 200
    base_branch = switched.json().get("active", {}).get("branch") or "main"

    branch_switch = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": "feature/login", "create_if_missing": True},
    )
    if branch_switch.status_code == 400:
        pytest.skip(f"git branch switch unavailable in this environment: {branch_switch.text}")
    assert branch_switch.status_code == 200

    created = client.post(
        f"/api/tasks?channel={channel}",
        json={"title": "Implement branch-aware login", "assigned_to": "builder", "priority": 2},
    )
    assert created.status_code == 200
    task = created.json()
    assert task["branch"] == "feature/login"

    branch_tasks = client.get("/api/tasks", params={"branch": "feature/login"})
    assert branch_tasks.status_code == 200
    ids = {row["id"] for row in branch_tasks.json()}
    assert task["id"] in ids

    base_tasks = client.get("/api/tasks", params={"branch": base_branch})
    assert base_tasks.status_code == 200
    base_ids = {row["id"] for row in base_tasks.json()}
    if base_branch != "feature/login":
        assert task["id"] not in base_ids
