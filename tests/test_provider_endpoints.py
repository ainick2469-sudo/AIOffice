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


def test_openai_direct_test_endpoint_returns_structured_fields(monkeypatch):
    client = TestClient(app)

    saved = client.post(
        "/api/providers",
        json={"provider": "openai", "key_ref": "openai_default", "api_key": "sk-provider-1299"},
    )
    assert saved.status_code == 200, saved.text

    async def _fake_probe_connection(**_kwargs):
        return {
            "ok": False,
            "model_hint": "gpt-5.2",
            "latency_ms": 18,
            "error": "OpenAI rate limit reached.",
            "details": {
                "status_code": 429,
                "url": "https://api.openai.com/v1/responses",
                "request_id": "req_test_123",
                "ratelimit": {"retry-after": "4"},
                "error": {
                    "type": "insufficient_quota",
                    "code": "rate_limit",
                    "message": "billing limit reached",
                },
            },
        }

    monkeypatch.setattr("server.openai_adapter.probe_connection", _fake_probe_connection)

    tested = client.post(
        "/api/providers/openai/test",
        json={"model": "gpt-5.2"},
    )
    assert tested.status_code == 200, tested.text
    payload = tested.json()
    assert payload["provider"] == "openai"
    assert payload["ok"] is False
    assert payload["status"] == 429
    assert payload["request_id"] == "req_test_123"
    assert payload["ratelimit"]["retry-after"] == "4"
    assert payload["error_code"] == "QUOTA_EXCEEDED"
    assert payload["error_detail"]["code"] == "rate_limit"


def test_settings_models_catalog_returns_friendly_defaults():
    client = TestClient(app)
    resp = client.get("/api/settings/models")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    providers = payload.get("providers") or {}

    assert "openai" in providers
    assert "claude" in providers
    assert "codex" in providers

    assert providers["openai"]["default_model_id"] == "gpt-5.2"
    assert providers["claude"]["default_model_id"] == "claude-opus-4-6"
    assert providers["codex"]["default_model_id"] == "gpt-5.2-codex"

    openai_labels = {item["id"]: item["label"] for item in providers["openai"]["models"]}
    claude_labels = {item["id"]: item["label"] for item in providers["claude"]["models"]}
    assert openai_labels.get("gpt-5.2") == "GPT-5.2 Thinking"
    assert claude_labels.get("claude-opus-4-6") == "Claude Opus 4.6"


def test_provider_test_maps_quota_error_code(monkeypatch):
    client = TestClient(app)
    saved = client.post(
        "/api/providers",
        json={"provider": "openai", "key_ref": "openai_default", "api_key": "sk-provider-7788"},
    )
    assert saved.status_code == 200, saved.text

    async def _fake_probe_connection(**_kwargs):
        return {
            "ok": False,
            "model_hint": "gpt-5.2",
            "latency_ms": 12,
            "error": "OpenAI rate limit reached.",
            "details": {"status_code": 429},
        }

    monkeypatch.setattr("server.openai_adapter.probe_connection", _fake_probe_connection)

    tested = client.post(
        "/api/providers/test",
        json={"provider": "openai", "model": "gpt-5.2", "key_ref": "openai_default"},
    )
    assert tested.status_code == 200, tested.text
    payload = tested.json()
    assert payload["ok"] is False
    assert payload["error_code"] == "QUOTA_EXCEEDED"
    assert payload["hint"]
