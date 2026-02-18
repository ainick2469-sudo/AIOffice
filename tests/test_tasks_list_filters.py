from fastapi.testclient import TestClient

from server.main import app


def test_tasks_list_filters_by_channel_and_project_name():
    client = TestClient(app)

    t1 = client.post(
        "/api/tasks",
        json={"title": "scoped-1", "channel": "main", "project_name": "proj-a"},
    ).json()
    t2 = client.post(
        "/api/tasks",
        json={"title": "scoped-2", "channel": "main", "project_name": "proj-b"},
    ).json()
    t3 = client.post(
        "/api/tasks",
        json={"title": "scoped-3", "channel": "other", "project_name": "proj-a"},
    ).json()

    assert t1["title"] == "scoped-1"
    assert t2["title"] == "scoped-2"
    assert t3["title"] == "scoped-3"

    resp = client.get("/api/tasks", params={"channel": "main", "project_name": "proj-a"})
    assert resp.status_code == 200
    titles = {item["title"] for item in resp.json()}
    assert titles == {"scoped-1"}

    resp2 = client.get("/api/tasks", params={"channel": "main"})
    assert resp2.status_code == 200
    titles2 = {item["title"] for item in resp2.json()}
    assert "scoped-1" in titles2
    assert "scoped-2" in titles2
    assert "scoped-3" not in titles2

