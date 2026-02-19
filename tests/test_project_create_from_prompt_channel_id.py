import time

from fastapi.testclient import TestClient

from server.main import app


def test_create_from_prompt_returns_channel_id_alias():
    client = TestClient(app)
    name = f"prompt-channel-id-{int(time.time())}"

    resp = client.post(
        "/api/projects/create_from_prompt",
        json={
            "prompt": "Build a compact internal analytics app.",
            "project_name": name,
            "template": "react",
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["channel"] == f"proj-{name}"
    assert payload["channel_id"] == f"proj-{name}"
