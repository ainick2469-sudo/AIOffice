import asyncio
import time

from fastapi.testclient import TestClient

from server.database import get_db, insert_message
from server.main import app


async def _seed_audit_records(marker: str) -> None:
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO tool_logs
               (agent_id, tool_type, command, args, output, exit_code, approved_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "builder",
                "run",
                f"pytest -k {marker}",
                "--maxfail=1",
                f"{marker} run output",
                0,
                "user",
                "2026-01-15 12:00:00",
            ),
        )
        await db.execute(
            """INSERT INTO tool_logs
               (agent_id, tool_type, command, args, output, exit_code, approved_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "reviewer",
                "write",
                f"update {marker}.md",
                "",
                f"{marker} write output",
                1,
                "user",
                "2026-01-16 12:00:00",
            ),
        )
        await db.execute(
            """INSERT INTO decisions (title, description, decided_by, rationale)
               VALUES (?, ?, ?, ?)""",
            (
                f"Decision {marker}",
                f"Decision body {marker}",
                "director",
                "test",
            ),
        )
        await db.commit()
    finally:
        await db.close()


def test_clear_channel_messages_endpoint_keeps_notice():
    client = TestClient(app)
    channel = f"test-clear-{int(time.time())}"

    async def seed():
        await insert_message(channel=channel, sender="user", content="hello one")
        await insert_message(channel=channel, sender="builder", content="hello two")

    asyncio.run(seed())

    cleared = client.delete(f"/api/channels/{channel}/messages")
    assert cleared.status_code == 200
    payload = cleared.json()
    assert payload["ok"] is True
    assert payload["deleted_count"] >= 2
    assert payload["system_message"]["sender"] == "system"
    assert payload["system_message"]["content"] == "Chat history cleared."

    listed = client.get(f"/api/messages/{channel}?limit=20")
    assert listed.status_code == 200
    messages = listed.json()
    assert len(messages) == 1
    assert messages[0]["sender"] == "system"
    assert messages[0]["content"] == "Chat history cleared."


def test_audit_filters_count_and_clear_endpoints():
    client = TestClient(app)

    # Start from clean audit tables for deterministic assertions.
    reset = client.delete("/api/audit/all")
    assert reset.status_code == 200

    marker = f"audit-marker-{time.time_ns()}"
    asyncio.run(_seed_audit_records(marker))

    filtered = client.get(
        f"/api/audit?agent_id=builder&tool_type=run&q={marker}&date_from=2026-01-01&date_to=2026-01-31"
    )
    assert filtered.status_code == 200
    rows = filtered.json()
    assert len(rows) == 1
    assert rows[0]["agent_id"] == "builder"
    assert rows[0]["tool_type"] == "run"
    assert marker in rows[0]["command"]

    no_match = client.get(f"/api/audit?q={marker}&date_from=2030-01-01&date_to=2030-01-31")
    assert no_match.status_code == 200
    assert no_match.json() == []

    count_resp = client.get("/api/audit/count")
    assert count_resp.status_code == 200
    assert count_resp.json()["count"] >= 2

    clear_decisions = client.delete("/api/audit/decisions")
    assert clear_decisions.status_code == 200
    assert clear_decisions.json()["deleted_decisions"] >= 1

    marker_two = f"audit-marker-{time.time_ns()}-two"
    asyncio.run(_seed_audit_records(marker_two))
    clear_all = client.delete("/api/audit/all")
    assert clear_all.status_code == 200
    clear_payload = clear_all.json()
    assert clear_payload["ok"] is True
    assert clear_payload["deleted_logs"] >= 2
    assert clear_payload["deleted_decisions"] >= 1

    assert client.get("/api/audit/count").json()["count"] == 0
    assert client.get("/api/decisions?limit=20").json() == []
