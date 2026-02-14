"""AI Office — Office Pulse. Periodic limited checks without runaway loops."""

import asyncio
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger("ai-office.pulse")

# Config
PULSE_INTERVAL_SECONDS = 300  # 5 minutes
MAX_MESSAGES_PER_PULSE = 1  # per agent per pulse
PULSE_ENABLED = False  # disabled by default, enable via API

_pulse_task: Optional[asyncio.Task] = None
_pulse_running = False


async def _run_pulse_cycle():
    """One pulse cycle: quick checks from QA + Reviewer."""
    from .database import get_agent, insert_message
    from .websocket import manager
    from . import ollama_client

    logger.info("💓 Pulse cycle running")

    # QA quick check
    qa = await get_agent("qa")
    if qa and qa.get("active"):
        resp = await ollama_client.generate(
            model=qa["model"],
            prompt="Quick smoke check: any obvious issues with the project? One sentence max. If nothing, say 'All clear.'",
            system=qa.get("system_prompt", ""),
            temperature=0.3, max_tokens=100,
        )
        if resp and "all clear" not in resp.lower():
            saved = await insert_message("main", "qa", f"💓 Pulse: {resp}", msg_type="review")
            await manager.broadcast("main", {"type": "chat", "message": saved})

    logger.info("💓 Pulse cycle complete")


async def _pulse_loop():
    """Main pulse loop."""
    global _pulse_running
    _pulse_running = True
    logger.info(f"💓 Pulse started (interval: {PULSE_INTERVAL_SECONDS}s)")

    while _pulse_running:
        try:
            await asyncio.sleep(PULSE_INTERVAL_SECONDS)
            if _pulse_running:
                await _run_pulse_cycle()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Pulse error: {e}")
            await asyncio.sleep(30)

    logger.info("💓 Pulse stopped")


def start_pulse():
    """Start the pulse scheduler."""
    global _pulse_task, PULSE_ENABLED
    PULSE_ENABLED = True
    if _pulse_task is None or _pulse_task.done():
        _pulse_task = asyncio.create_task(_pulse_loop())
    return True


def stop_pulse():
    """Stop the pulse scheduler."""
    global _pulse_running, PULSE_ENABLED
    PULSE_ENABLED = False
    _pulse_running = False
    if _pulse_task and not _pulse_task.done():
        _pulse_task.cancel()
    return True


def get_pulse_status() -> dict:
    return {
        "enabled": PULSE_ENABLED,
        "running": _pulse_running,
        "interval_seconds": PULSE_INTERVAL_SECONDS,
    }
