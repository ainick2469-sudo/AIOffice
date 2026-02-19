from __future__ import annotations

import asyncio
import uuid

from fastapi.testclient import TestClient

from server import database as db
from server.main import app


def test_channels_activity_endpoint_returns_latest_messages():
    client = TestClient(app)
    channel_id = f"perf-{uuid.uuid4().hex[:8]}"

    asyncio.run(db.create_channel(channel_id, "Perf Channel", "group"))
    asyncio.run(db.insert_message("main", "user", "hello from main"))
    asyncio.run(db.insert_message(channel_id, "builder", "latest perf update"))

    response = client.get("/api/channels/activity?limit=20")
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("activity"), list)
    assert payload.get("count", 0) >= 1

    by_channel = {item["channel_id"]: item for item in payload["activity"]}
    assert channel_id in by_channel
    assert by_channel[channel_id]["latest_message_id"] >= 1
    assert "latest_message_ts" in by_channel[channel_id]
    assert "latest_preview" in by_channel[channel_id]


def test_dashboard_summary_endpoint_is_compact():
    client = TestClient(app)
    channel_id = f"dash-{uuid.uuid4().hex[:8]}"

    asyncio.run(db.create_channel(channel_id, "Dashboard Channel", "group"))
    asyncio.run(db.insert_message(channel_id, "qa", "dashboard summary ping"))
    asyncio.run(
        db.create_task_record(
            {
                "title": "Perf triage item",
                "description": "Validate dashboard summary endpoint",
                "status": "backlog",
                "created_by": "user",
            },
            channel=channel_id,
            project_name="ai-office",
        )
    )

    response = client.get("/api/dashboard/summary?limit_recent=5")
    assert response.status_code == 200
    payload = response.json()

    assert payload["channels_count"] >= 1
    assert payload["agents_count"] >= 1
    assert payload["tasks_open_count"] >= 1
    assert isinstance(payload.get("task_status_counts"), dict)
    assert isinstance(payload.get("recent_activity"), list)
    assert isinstance(payload.get("provider_status_summary"), dict)
    assert len(payload["recent_activity"]) <= 5
