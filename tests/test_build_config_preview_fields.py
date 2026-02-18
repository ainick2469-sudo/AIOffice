from fastapi.testclient import TestClient

from server.main import app


def test_build_config_preview_fields_roundtrip():
    client = TestClient(app)

    created = client.post("/api/projects", json={"name": "preview-fields-test"})
    assert created.status_code == 200

    resp = client.put(
        "/api/projects/preview-fields-test/build-config",
        json={"preview_cmd": "npm -v", "preview_port": 5173},
    )
    assert resp.status_code == 200
    payload = resp.json()
    cfg = payload["config"]
    assert cfg["preview_cmd"] == "npm -v"
    assert cfg["preview_port"] == 5173

    fetched = client.get("/api/projects/preview-fields-test/build-config")
    assert fetched.status_code == 200
    cfg2 = fetched.json()["config"]
    assert cfg2["preview_cmd"] == "npm -v"
    assert cfg2["preview_port"] == 5173

