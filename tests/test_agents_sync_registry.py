from fastapi.testclient import TestClient

from server.main import app


def test_sync_registry_respects_user_overrides_for_codex_backend():
    client = TestClient(app)

    # Explicit user override should lock backend/model against registry sync.
    patched = client.patch(
        "/api/agents/codex",
        json={"backend": "ollama", "model": "qwen2.5:14b"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["backend"] == "ollama"

    synced = client.post("/api/agents/sync-registry")
    assert synced.status_code == 200, synced.text
    sync_payload = synced.json()
    assert sync_payload["ok"] is True

    codex = client.get("/api/agents/codex")
    assert codex.status_code == 200, codex.text
    assert codex.json()["backend"] == "ollama"

    forced = client.post("/api/agents/sync-registry?force=true")
    assert forced.status_code == 200, forced.text

    codex_after_force = client.get("/api/agents/codex")
    assert codex_after_force.status_code == 200, codex_after_force.text
    assert codex_after_force.json()["backend"] == "openai"

