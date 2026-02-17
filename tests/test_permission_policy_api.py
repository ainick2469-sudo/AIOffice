from datetime import datetime, timezone

from fastapi.testclient import TestClient

from server.main import app


def test_permissions_get_put_and_trust_session():
    client = TestClient(app)

    put_resp = client.put(
        "/api/permissions",
        json={
            "channel": "main",
            "mode": "ask",
            "scopes": ["read", "search"],
            "command_allowlist_profile": "safe",
        },
    )
    assert put_resp.status_code == 200
    payload = put_resp.json()
    assert payload["channel"] == "main"
    assert payload["mode"] == "ask"

    get_resp = client.get("/api/permissions", params={"channel": "main"})
    assert get_resp.status_code == 200
    fetched = get_resp.json()
    assert fetched["mode"] == "ask"

    trust_resp = client.post(
        "/api/permissions/trust_session",
        json={"channel": "main", "minutes": 15},
    )
    assert trust_resp.status_code == 200
    trusted = trust_resp.json()
    assert trusted["mode"] == "trusted"
    assert trusted.get("expires_at")


def test_trusted_policy_auto_reverts_on_expiry():
    client = TestClient(app)
    expired = datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

    put_resp = client.put(
        "/api/permissions",
        json={
            "channel": "main",
            "mode": "trusted",
            "expires_at": expired,
            "scopes": ["read", "search", "run", "write"],
        },
    )
    assert put_resp.status_code == 200

    get_resp = client.get("/api/permissions", params={"channel": "main"})
    assert get_resp.status_code == 200
    policy = get_resp.json()
    assert policy["mode"] == "ask"
    assert policy.get("expires_at") in (None, "")

