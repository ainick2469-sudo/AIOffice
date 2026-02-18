from fastapi.testclient import TestClient

from server.main import app


def test_patch_agent_allows_backend_and_active_updates():
    client = TestClient(app)

    resp = client.patch(
        "/api/agents/codex",
        json={"backend": "openai", "active": False},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["id"] == "codex"
    assert payload["backend"] == "openai"
    assert payload["active"] is False

    get_resp = client.get("/api/agents/codex")
    assert get_resp.status_code == 200
    stored = get_resp.json()
    assert stored["backend"] == "openai"
    assert stored["active"] is False

