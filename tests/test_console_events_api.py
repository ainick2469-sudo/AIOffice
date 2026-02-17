import asyncio

from fastapi.testclient import TestClient

from server import database as db
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_console_events_api_returns_and_filters_entries():
    async def seed():
        await db.log_console_event(
            channel="main",
            event_type="router_decision",
            source="test-suite",
            message="selected agents",
            data={"agents": ["builder", "architect"]},
        )
        await db.log_console_event(
            channel="main",
            event_type="tool_result",
            source="test-suite",
            message="tool ok",
            data={"ok": True},
        )

    _run(seed())
    client = TestClient(app)

    all_events = client.get("/api/console/events/main?limit=50")
    assert all_events.status_code == 200
    payload = all_events.json()
    assert isinstance(payload, list)
    assert any(item.get("event_type") == "router_decision" for item in payload)

    filtered = client.get("/api/console/events/main?event_type=router_decision&source=test-suite")
    assert filtered.status_code == 200
    filtered_payload = filtered.json()
    assert filtered_payload
    assert all(item.get("event_type") == "router_decision" for item in filtered_payload)
    assert all(item.get("source") == "test-suite" for item in filtered_payload)
