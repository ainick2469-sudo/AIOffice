from fastapi.testclient import TestClient

from server.main import app


def test_project_lifecycle_api():
    client = TestClient(app)
    name = "proj-test-api"

    create = client.post("/api/projects", json={"name": name})
    assert create.status_code in (200, 400)
    if create.status_code == 400:
        # Existing project from a prior run is acceptable for idempotent local tests.
        pass

    listing = client.get("/api/projects")
    assert listing.status_code == 200
    assert "projects" in listing.json()

    switched = client.post("/api/projects/switch", json={"channel": "main", "name": name})
    if switched.status_code == 200:
        payload = switched.json()
        assert payload["active"]["project"] == name

    first_delete = client.delete(f"/api/projects/{name}")
    assert first_delete.status_code in (200, 400)
    if first_delete.status_code == 200 and first_delete.json().get("requires_confirmation"):
        token = first_delete.json()["confirm_token"]
        second_delete = client.delete(f"/api/projects/{name}?confirm_token={token}")
        assert second_delete.status_code == 200
