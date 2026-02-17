from fastapi.testclient import TestClient

from server.main import app


def test_permission_grant_and_revoke_updates_effective_policy():
    client = TestClient(app)

    base = client.put(
        "/api/permissions",
        json={
            "channel": "main",
            "mode": "ask",
            "scopes": ["read", "search"],
            "command_allowlist_profile": "safe",
        },
    )
    assert base.status_code == 200

    granted = client.post(
        "/api/permissions/grant",
        json={
            "channel": "main",
            "scope": "run",
            "grant_level": "chat",
            "minutes": 10,
            "created_by": "user",
        },
    )
    assert granted.status_code == 200
    policy = granted.json()
    assert policy["channel"] == "main"
    assert policy["mode"] == "ask"
    assert "run" in (policy.get("scopes") or [])
    assert policy.get("active_grants")

    grant_id = policy["active_grants"][0]["id"]

    revoked = client.post(
        "/api/permissions/revoke",
        json={"channel": "main", "grant_id": grant_id},
    )
    assert revoked.status_code == 200
    after = revoked.json()
    assert all(item.get("id") != grant_id for item in (after.get("active_grants") or []))

