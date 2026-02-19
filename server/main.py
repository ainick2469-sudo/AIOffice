"""AI Office — Main FastAPI application."""

import asyncio
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import init_db, insert_message, get_messages
from .websocket import manager
from .routes_api import router as api_router
from .models import WSMessage
from .agent_engine import process_message
from . import ollama_client
from .runtime_config import AI_OFFICE_HOME, APP_ROOT, ensure_runtime_dirs
from . import skills_loader

# ── Logging ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("ai-office")


def _env_key_safety_warnings() -> list[str]:
    env_path = APP_ROOT / ".env"
    warnings: list[str] = []
    if not env_path.exists():
        warnings.append(".env not found; configure API keys in Settings -> API Keys.")
        return warnings

    try:
        content = env_path.read_text(encoding="utf-8")
    except Exception:
        return warnings

    if "REPLACE_WITH_ROTATED_KEY" in content:
        warnings.append(".env contains placeholder API keys. Set keys in Settings -> API Keys.")

    key_line_pattern = re.compile(r"^(OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=\s*(.+)$", re.MULTILINE)
    for match in key_line_pattern.finditer(content):
        name = match.group(1)
        value = match.group(2).strip().strip('"').strip("'")
        if not value or value.startswith("REPLACE_WITH_"):
            continue
        if re.search(r"(sk-|rk-)", value):
            warnings.append(f"{name} appears to contain a real key in .env. Rotate it and use Settings -> API Keys.")
    return warnings


# ── Lifespan ───────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🏢 AI Office starting up...")
    ensure_runtime_dirs()
    await init_db()
    logger.info("✅ Database initialized")
    for warning in _env_key_safety_warnings():
        logger.warning("⚠️  %s", warning)
        try:
            from . import database as db

            await db.log_console_event(
                channel="main",
                project_name=None,
                event_type="security_warning",
                source="startup",
                severity="warning",
                message=warning,
                data={"scope": "env"},
            )
        except Exception:
            pass
    try:
        from . import process_manager

        orphans = await process_manager.list_orphan_processes()
        if orphans:
            logger.warning("⚠️  Found %s orphan process(es) from a previous session. Use /api/process/orphans to inspect and /api/process/orphans/cleanup to terminate.", len(orphans))
    except Exception:
        pass
    skills_info = skills_loader.load_skills()
    logger.info("✅ Skills loaded (%s tools)", len(skills_info.get("loaded_tools", [])))
    skills_loader.ensure_dev_watcher(
        os.environ.get("AI_OFFICE_SKILLS_WATCH", "").strip().lower() in {"1", "true", "yes"}
    )
    if await ollama_client.is_available():
        logger.info("✅ Ollama connected")
    else:
        logger.warning("⚠️  Ollama not reachable — local-model agents may be unavailable")
    yield
    from . import process_manager
    shutdown = await process_manager.shutdown_all_processes()
    logger.info("✅ Process manager shutdown complete (%s stopped)", shutdown.get("stopped_count", 0))
    logger.info("🏢 AI Office shutting down.")


# ── App ────────────────────────────────────────────────────
app = FastAPI(title="AI Office", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


# ── WebSocket endpoint ─────────────────────────────────────
@app.websocket("/ws/{channel}")
async def websocket_endpoint(ws: WebSocket, channel: str):
    await manager.connect(ws, channel)
    logger.info(f"WS connected: #{channel}")

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                msg = WSMessage(**data)
            except Exception:
                await manager.send_personal(ws, {"error": "Invalid message format"})
                continue

            # Save to DB
            saved = await insert_message(
                channel=channel,
                sender="user",
                content=msg.content,
                msg_type=msg.msg_type,
                parent_id=msg.parent_id,
            )

            # Broadcast to channel
            await manager.broadcast(channel, {
                "type": "chat",
                "message": saved,
            })

            logger.info(f"[#{channel}] user: {msg.content[:80]}")

            # Route to agents and generate responses (non-blocking)
            asyncio.create_task(process_message(channel, msg.content))

    except WebSocketDisconnect:
        manager.disconnect(ws)
        logger.info(f"WS disconnected: #{channel}")


# ── Static files (frontend) ───────────────────────────────
uploads_dir = AI_OFFICE_HOME / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

client_dist = APP_ROOT / "client-dist"
if client_dist.exists():
    app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="static")
