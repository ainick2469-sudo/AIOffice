from fastapi.testclient import TestClient

from server.main import app


def test_settings_providers_round_trip_masks_key():
    client = TestClient(app)

    initial = client.get("/api/settings/providers")
    assert initial.status_code == 200, initial.text
    initial_payload = initial.json()
    assert "openai" in initial_payload
    assert "claude" in initial_payload

    resp = client.post(
        "/api/settings/providers",
        json={
            "openai": {
                "api_key": "sk-test-openai-7788",
                "model_default": "gpt-5.2",
                "base_url": "https://api.openai.com/v1",
            },
            "fallback_to_ollama": False,
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["openai"]["configured"] is True
    assert payload["openai"]["key_masked"]
    assert payload["openai"]["key_source"] in {"settings", "settings-legacy", "vault", "env", "override", "none"}
    assert "7788" in payload["openai"]["key_masked"]
    assert payload["openai"]["key_fingerprint_last4"] == "7788"
    assert "api_key" not in payload["openai"]
    assert payload["fallback_to_ollama"] is False

    status = client.get("/api/openai/status")
    assert status.status_code == 200, status.text
    status_payload = status.json()
    assert status_payload["available"] is True
    assert status_payload["key_source"] in {"settings", "settings-legacy", "vault", "env", "override"}
