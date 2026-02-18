from fastapi.testclient import TestClient

from server.main import app


def test_agent_credentials_set_get_delete_and_no_plaintext_leak():
    client = TestClient(app)

    api_key = "sk-test-1234"
    base_url = "https://example.com/v1"

    resp = client.post(
        "/api/agents/codex/credentials",
        json={"backend": "openai", "api_key": api_key, "base_url": base_url},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["agent_id"] == "codex"
    assert payload["backend"] == "openai"
    assert payload["has_key"] is True
    assert payload["last4"] == "1234"
    assert payload["base_url"] == base_url
    assert "api_key" not in payload
    assert api_key not in resp.text

    get_resp = client.get("/api/agents/codex/credentials", params={"backend": "openai"})
    assert get_resp.status_code == 200
    meta = get_resp.json()
    assert meta["has_key"] is True
    assert meta["last4"] == "1234"
    assert api_key not in get_resp.text

    # Backend status should reflect vault credentials.
    status_resp = client.get("/api/openai/status")
    assert status_resp.status_code == 200
    status = status_resp.json()
    assert status["backend"] == "openai"
    assert status["available"] is True

    del_resp = client.delete("/api/agents/codex/credentials", params={"backend": "openai"})
    assert del_resp.status_code == 200

    meta2 = client.get("/api/agents/codex/credentials", params={"backend": "openai"}).json()
    assert meta2["has_key"] is False

