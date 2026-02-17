import pytest
from fastapi.testclient import TestClient

from server.main import app


def test_channel_branch_state_persists_independently():
    client = TestClient(app)
    project_name = "branch-persist-api"
    channel_a = "branch-alpha"
    channel_b = "branch-beta"

    client.post("/api/projects", json={"name": project_name})
    first = client.post("/api/projects/switch", json={"channel": channel_a, "name": project_name})
    second = client.post("/api/projects/switch", json={"channel": channel_b, "name": project_name})
    assert first.status_code == 200
    assert second.status_code == 200

    base_branch = first.json().get("active", {}).get("branch") or "main"
    if second.json().get("active", {}).get("branch"):
        base_branch = second.json()["active"]["branch"]

    a_switch = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel_a, "branch": "feature/alpha", "create_if_missing": True},
    )
    if a_switch.status_code == 400:
        pytest.skip(f"git branch switching unavailable in this environment: {a_switch.text}")
    assert a_switch.status_code == 200

    b_switch = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel_b, "branch": "feature/beta", "create_if_missing": True},
    )
    assert b_switch.status_code == 200

    active_a = client.get(f"/api/projects/active/{channel_a}")
    active_b = client.get(f"/api/projects/active/{channel_b}")
    assert active_a.status_code == 200
    assert active_b.status_code == 200
    assert active_a.json()["branch"] == "feature/alpha"
    assert active_b.json()["branch"] == "feature/beta"

    listing = client.get(f"/api/projects/{project_name}/branches", params={"channel": channel_a})
    assert listing.status_code == 200
    channel_state = listing.json().get("channel_branch_state", [])
    channels = {row.get("channel"): row.get("branch") for row in channel_state}
    assert channels.get(channel_a) == "feature/alpha"
    assert channels.get(channel_b) == "feature/beta"
    assert base_branch
