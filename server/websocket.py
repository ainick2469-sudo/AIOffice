"""AI Office — WebSocket connection manager."""

import json
import logging
from fastapi import WebSocket
from typing import Dict, Set

logger = logging.getLogger("ai-office.ws")


class ConnectionManager:
    """Manages WebSocket connections per channel."""

    def __init__(self):
        # channel -> set of websocket connections
        self._channels: Dict[str, Set[WebSocket]] = {}
        # ws -> set of channels subscribed
        self._subscriptions: Dict[WebSocket, Set[str]] = {}

    async def connect(self, ws: WebSocket, channel: str = "main"):
        await ws.accept()
        if channel not in self._channels:
            self._channels[channel] = set()
        self._channels[channel].add(ws)

        if ws not in self._subscriptions:
            self._subscriptions[ws] = set()
        self._subscriptions[ws].add(channel)
        logger.info(f"Client connected to #{channel}")

    def disconnect(self, ws: WebSocket):
        channels = self._subscriptions.pop(ws, set())
        for ch in channels:
            self._channels.get(ch, set()).discard(ws)
        logger.info("Client disconnected")

    async def subscribe(self, ws: WebSocket, channel: str):
        if channel not in self._channels:
            self._channels[channel] = set()
        self._channels[channel].add(ws)
        self._subscriptions.setdefault(ws, set()).add(channel)

    async def broadcast(self, channel: str, message: dict):
        """Send message to all clients subscribed to a channel."""
        dead = []
        for ws in self._channels.get(channel, set()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_personal(self, ws: WebSocket, message: dict):
        try:
            await ws.send_json(message)
        except Exception:
            self.disconnect(ws)


manager = ConnectionManager()
