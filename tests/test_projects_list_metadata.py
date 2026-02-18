import time

from fastapi.testclient import TestClient

from server.main import app


def test_projects_list_includes_metadata_fields():
    client = TestClient(app)
    name = f"meta-proj-{int(time.time())}"

    created = client.post("/api/projects", json={"name": name, "template": "python"})
    assert created.status_code == 200, created.text

    switched = client.post("/api/projects/switch", json={"channel": f"proj-{name}", "name": name})
    assert switched.status_code == 200, switched.text

    listing = client.get("/api/projects")
    assert listing.status_code == 200, listing.text
    data = listing.json()
    project = next((item for item in data.get("projects", []) if item.get("name") == name), None)
    assert project is not None
    assert "display_name" in project
    assert "updated_at" in project
    assert "detected_kinds" in project
    assert "detected_kind" in project
    assert "last_opened_at" in project
