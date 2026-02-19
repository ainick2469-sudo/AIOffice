from fastapi.testclient import TestClient

from server.main import app


def test_agents_repair_codex_defaults_only_when_old_signature():
    client = TestClient(app)

    # Force legacy signature.
    patch_resp = client.patch(
        "/api/agents/codex",
        json={"backend": "ollama", "model": "qwen2.5:14b"},
    )
    assert patch_resp.status_code == 200

    repair_resp = client.post("/api/agents/repair")
    assert repair_resp.status_code == 200
    payload = repair_resp.json()
    assert payload["ok"] is True
    assert payload["changed"] is True
    assert payload["after"]["backend"] == "openai"
    assert payload["after"]["model"] == "gpt-5.2-codex"

    # Second call should no-op.
    repair_resp2 = client.post("/api/agents/repair")
    assert repair_resp2.status_code == 200
    payload2 = repair_resp2.json()
    assert payload2["ok"] is True
    assert payload2["changed"] is False
