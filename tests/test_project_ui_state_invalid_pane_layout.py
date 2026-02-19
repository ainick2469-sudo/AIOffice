import time

from fastapi.testclient import TestClient

from server.main import app


def test_project_ui_state_invalid_pane_layout_falls_back_per_preset():
    client = TestClient(app)
    name = f"pane-invalid-{int(time.time())}"

    created = client.post("/api/projects", json={"name": name})
    assert created.status_code == 200, created.text

    payload = {
        "preview_focus_mode": False,
        "layout_preset": "full-ide",
        "pane_layout": {
            "full-ide": [0.01, 0.01, 0.98],
            "split": [0.03, 0.97],
            "chat-files": [0.1, 0.9],
            "files-preview": [-1, 2],
        },
    }
    updated = client.put(f"/api/projects/{name}/ui-state", json=payload)
    assert updated.status_code == 200, updated.text
    data = updated.json()

    # 3-pane should be clamped to min ratios and normalized.
    assert data["pane_layout"]["full-ide"] == [0.16, 0.16, 0.68]
    # Split should be clamped to min ratio 0.22.
    assert data["pane_layout"]["split"] == [0.22, 0.78]
    # 2-pane should be clamped to min ratio 0.22.
    assert data["pane_layout"]["chat-files"] == [0.22, 0.78]
    # Invalid values fall back to per-preset defaults.
    assert data["pane_layout"]["files-preview"] == [0.62, 0.38]
