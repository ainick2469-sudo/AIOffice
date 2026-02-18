import time

from fastapi.testclient import TestClient

from server.main import app


def test_create_project_from_prompt_creates_project_channel_spec_and_tasks():
    client = TestClient(app)
    name = f"proj-from-prompt-{int(time.time())}"
    payload = {
        "prompt": "Build a tiny calculator app with add/sub/mul/div.",
        "project_name": name,
        "template": "python",
    }

    resp = client.post("/api/projects/create_from_prompt", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    assert data["project"]["name"] == name
    assert data["channel"] == f"proj-{name}"
    assert data["spec_status"] == "draft"
    assert isinstance(data.get("created_tasks") or [], list)
    assert len(data.get("created_tasks") or []) >= 3

    # Spec is accessible and in DRAFT for the project channel.
    spec = client.get("/api/spec/current", params={"channel": data["channel"]})
    assert spec.status_code == 200, spec.text
    assert spec.json()["status"] == "draft"

    # Tasks default-filtering (channel + project) returns the seeded tasks.
    tasks = client.get("/api/tasks", params={"channel": data["channel"], "project_name": name})
    assert tasks.status_code == 200, tasks.text
    titles = {t.get("title") for t in tasks.json()}
    assert "Define scope" in titles
