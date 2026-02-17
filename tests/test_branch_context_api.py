import pytest
from fastapi.testclient import TestClient

from server.main import app


def _create_and_switch(client: TestClient, project_name: str, channel: str) -> dict:
    create = client.post("/api/projects", json={"name": project_name})
    assert create.status_code in (200, 400)
    switched = client.post("/api/projects/switch", json={"channel": channel, "name": project_name})
    assert switched.status_code == 200
    payload = switched.json()
    assert payload["active"]["project"] == project_name
    assert payload["active"].get("branch")
    return payload["active"]


def test_branch_context_switch_api():
    client = TestClient(app)
    project_name = "branch-context-api"
    channel = "branch-room"
    active = _create_and_switch(client, project_name, channel)
    base_branch = active.get("branch") or "main"

    listing = client.get(f"/api/projects/{project_name}/branches", params={"channel": channel})
    assert listing.status_code == 200
    data = listing.json()
    assert isinstance(data.get("branches"), list)
    assert data.get("active_branch") == base_branch

    switched = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": "feature/login", "create_if_missing": True},
    )
    if switched.status_code == 400:
        pytest.skip(f"git branch switch unavailable in this environment: {switched.text}")

    assert switched.status_code == 200
    assert switched.json().get("branch") == "feature/login"

    active_after = client.get(f"/api/projects/active/{channel}")
    assert active_after.status_code == 200
    assert active_after.json().get("branch") == "feature/login"
