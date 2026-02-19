import time

from fastapi.testclient import TestClient

from server.main import app


def test_project_ui_state_pane_layout_roundtrip():
    client = TestClient(app)
    name = f"pane-roundtrip-{int(time.time())}"

    created = client.post("/api/projects", json={"name": name})
    assert created.status_code == 200, created.text

    payload = {
        "preview_focus_mode": False,
        "layout_preset": "full-ide",
        "pane_layout": {
            "full-ide": [0.28, 0.4, 0.32],
            "split": [0.52, 0.48],
            "chat-files": [0.45, 0.55],
            "files-preview": [0.62, 0.38],
        },
    }
    updated = client.put(f"/api/projects/{name}/ui-state", json=payload)
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["layout_preset"] == "full-ide"
    assert data["pane_layout"]["full-ide"] == [0.28, 0.4, 0.32]
    assert data["pane_layout"]["split"] == [0.52, 0.48]
    assert data["pane_layout"]["chat-files"] == [0.45, 0.55]
    assert data["pane_layout"]["files-preview"] == [0.62, 0.38]

    fetched = client.get(f"/api/projects/{name}/ui-state")
    assert fetched.status_code == 200, fetched.text
    fetched_data = fetched.json()
    assert fetched_data["pane_layout"]["full-ide"] == [0.28, 0.4, 0.32]
    assert fetched_data["pane_layout"]["split"] == [0.52, 0.48]
    assert fetched_data["pane_layout"]["chat-files"] == [0.45, 0.55]
    assert fetched_data["pane_layout"]["files-preview"] == [0.62, 0.38]
