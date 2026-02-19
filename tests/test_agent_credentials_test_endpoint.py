from fastapi.testclient import TestClient

from server.main import app


def test_agent_credentials_test_endpoint_openai_success(monkeypatch):
    client = TestClient(app)

    saved = client.post(
        "/api/agents/codex/credentials",
        json={"backend": "openai", "api_key": "sk-test-1234"},
    )
    assert saved.status_code == 200, saved.text

    async def _fake_probe_connection(**_kwargs):
        return {
            "ok": True,
            "model_hint": "gpt-5.2-codex",
            "latency_ms": 12,
            "error": None,
            "details": {"source": "test"},
        }

    monkeypatch.setattr("server.openai_adapter.probe_connection", _fake_probe_connection)

    resp = client.post(
        "/api/agents/codex/credentials/test",
        json={"backend": "openai", "model": "gpt-5.2-codex"},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["backend"] == "openai"
    assert payload["latency_ms"] == 12
    assert payload["details"]["source"] == "test"
