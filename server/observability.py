"""Console event helpers (persist + websocket fanout)."""

from __future__ import annotations

from typing import Any

from . import database as db
from .websocket import manager


async def emit_console_event(
    *,
    channel: str,
    event_type: str,
    source: str,
    message: str,
    project_name: str | None = None,
    severity: str = "info",
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = await db.log_console_event(
        channel=channel,
        event_type=event_type,
        source=source,
        message=message,
        project_name=project_name,
        severity=severity,
        data=data or {},
    )
    await manager.broadcast(channel, {"type": "console_event", "event": event})
    return event
