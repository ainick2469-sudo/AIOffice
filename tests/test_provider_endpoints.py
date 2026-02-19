from fastapi.testclient import TestClient

from server.main import app


def test_provider_config_round_trip_redacts_secret():
    client = TestClient(app)
    api_key = "sk-provider-5566"

    resp = client.post(
        "/api/providers",
        json={
            "provider": "openai",
            "key_ref": "openai_default",
            "api_key": api_key,
            "base_url": "https://api.openai.com/v1",
            "default_model": "gpt-5.2",
        },
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["provider"] == "openai"
    assert payload["key_ref"] == "openai_default"
    assert payload["has_key"] is True
    assert payload["last4"] == "5566"
    assert "api_key" not in payload
    assert api_key not in resp.text

    listing = client.get("/api/providers")
    assert listing.status_code == 200, listing.text
    rows = listing.json().get("providers", [])
    openai = next((item for item in rows if item.get("provider") == "openai"), None)
    assert openai is not None
    assert openai["key_ref"] == "openai_default"
    assert openai["has_key"] is True
    assert openai["last4"] == "5566"
    assert api_key not in listing.text


def test_provider_test_endpoint_uses_provider_config(monkeypatch):
    client = TestClient(app)

    saved = client.post(
        "/api/providers",
        json={"provider": "openai", "key_ref": "openai_default", "api_key": "sk-provider-8899"},
    )
    assert saved.status_code == 200, saved.text

    async def _fake_probe_connection(**_kwargs):
        return {
            "ok": True,
            "model_hint": "gpt-5.2",
            "latency_ms": 21,
            "error": None,
            "details": {"source": "test"},
        }

    monkeypatch.setattr("server.openai_adapter.probe_connection", _fake_probe_connection)

    tested = client.post(
        "/api/providers/test",
        json={"provider": "openai", "model": "gpt-5.2", "key_ref": "openai_default"},
    )
    assert tested.status_code == 200, tested.text
    payload = tested.json()
    assert payload["ok"] is True
    assert payload["provider"] == "openai"
    assert payload["model_hint"] == "gpt-5.2"
    assert payload["latency_ms"] == 21
    assert payload["details"]["source"] == "test"
