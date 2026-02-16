from fastapi.testclient import TestClient

from server.main import app


def test_task_crud_with_structured_fields():
    client = TestClient(app)

    created = client.post(
        "/api/tasks",
        json={
            "title": "Task API segment test",
            "description": "Verify task get/put/delete",
            "assigned_to": "builder",
            "priority": 3,
            "subtasks": [{"title": "first step", "done": False}],
            "linked_files": ["server/routes_api.py"],
            "depends_on": [1, 2],
        },
    )
    assert created.status_code == 200
    task = created.json()
    task_id = task["id"]

    fetched = client.get(f"/api/tasks/{task_id}")
    assert fetched.status_code == 200
    payload = fetched.json()
    assert payload["priority"] == 3
    assert isinstance(payload["subtasks"], list)
    assert isinstance(payload["linked_files"], list)
    assert isinstance(payload["depends_on"], list)

    updated = client.put(
        f"/api/tasks/{task_id}",
        json={
            "title": "Task API segment test updated",
            "status": "in_progress",
            "priority": 2,
            "subtasks": [{"title": "first step", "done": True}],
            "linked_files": ["client/src/components/TaskBoard.jsx"],
            "depends_on": [3],
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload["title"] == "Task API segment test updated"
    assert updated_payload["status"] == "in_progress"
    assert updated_payload["priority"] == 2
    assert updated_payload["subtasks"][0]["done"] is True

    deleted = client.delete(f"/api/tasks/{task_id}")
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = client.get(f"/api/tasks/{task_id}")
    assert missing.status_code == 404
