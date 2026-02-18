import time

from fastapi.testclient import TestClient

from server.main import app


def test_project_display_name_roundtrip_in_list():
    client = TestClient(app)
    name = f"proj-display-{int(time.time())}"

    created = client.post("/api/projects", json={"name": name})
    assert created.status_code == 200, created.text

    renamed = client.put(f"/api/projects/{name}/display-name", json={"display_name": "My Display Name"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["display_name"] == "My Display Name"

    listing = client.get("/api/projects")
    assert listing.status_code == 200, listing.text
    projects = listing.json().get("projects") or []
    match = [p for p in projects if p.get("name") == name]
    assert match, f"Project {name} missing from listing"
    assert match[0].get("display_name") == "My Display Name"
