"""Debug bundle export helpers.

Creates a single zip file containing the minimum useful context to reproduce or
diagnose issues without requiring screenshots or manual copy/paste.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from . import database as db
from .runtime_config import AI_OFFICE_HOME, ensure_runtime_dirs


_DEFAULT_LIMIT = 1200

_SECRET_ENV_KEYS = {
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "TAVILY_API_KEY",
    "SEARXNG_URL",
}

_SECRET_VALUE_PATTERNS = (
    # OpenAI
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{12,}\b"),
    # Anthropic (best-effort)
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{12,}\b"),
    # Generic "api key" style tokens
    re.compile(r"\b(?:api[_-]?key|token)\s*[:=]\s*[A-Za-z0-9_\-]{12,}\b", re.IGNORECASE),
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_created_at(value: Optional[str]) -> Optional[datetime]:
    raw = (value or "").strip()
    if not raw:
        return None
    # SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    # ISO-ish: "YYYY-MM-DDTHH:MM:SSZ"
    try:
        normalized = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _filter_recent(rows: list[dict[str, Any]], minutes: int) -> list[dict[str, Any]]:
    cutoff = _utc_now() - timedelta(minutes=max(1, int(minutes or 30)))
    kept: list[dict[str, Any]] = []
    for item in rows:
        dt = _parse_created_at(str(item.get("created_at") or ""))
        if not dt:
            kept.append(item)
            continue
        if dt >= cutoff:
            kept.append(item)
    return kept


def _redact_text(text: str) -> str:
    if not text:
        return text
    redacted = text
    for pattern in _SECRET_VALUE_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def _redact_obj(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, list):
        return [_redact_obj(item) for item in value]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key_upper = str(k).upper()
            if key_upper in _SECRET_ENV_KEYS:
                out[k] = "[REDACTED]"
            else:
                out[k] = _redact_obj(v)
        return out
    return value


def _dump_json(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=True)


@dataclass(frozen=True)
class DebugBundleResult:
    path: Path
    file_name: str
    bytes: int
    created_at: str


async def create_debug_bundle(
    *,
    channel: str,
    minutes: int = 30,
    include_prompts: bool = False,
    redact_secrets: bool = True,
) -> DebugBundleResult:
    ensure_runtime_dirs()
    channel_id = (channel or "main").strip() or "main"

    from . import process_manager
    from . import project_manager

    active_project = await project_manager.get_active_project(channel_id)
    autonomy_mode = await db.get_project_autonomy_mode(active_project["project"])
    permission_policy = await db.get_permission_policy(channel_id)

    # Console events
    console_events = await db.get_console_events(channel=channel_id, limit=_DEFAULT_LIMIT)
    console_events = _filter_recent(console_events, minutes)

    # Tool logs
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            "SELECT tl.*, COALESCE(ar.risk_level, '') AS risk_level "
            "FROM tool_logs tl "
            "LEFT JOIN approval_requests ar ON ar.id = tl.approval_request_id "
            "WHERE COALESCE(tl.channel, 'main') = ? "
            "ORDER BY tl.id DESC LIMIT ?",
            (channel_id, int(_DEFAULT_LIMIT)),
        )
        tool_logs = [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()
    tool_logs.reverse()
    tool_logs = _filter_recent(tool_logs, minutes)

    # Tasks snapshot (scoped to active project + channel)
    tasks = await db.list_tasks(channel=channel_id, project_name=active_project["project"])

    # Processes (in-memory registry) + logs
    processes = await process_manager.list_processes(channel_id, include_logs=True)
    process_index = [
        {k: v for k, v in proc.items() if k != "logs"}
        for proc in processes
    ]

    snapshot: dict[str, Any] = {
        "exported_at": _utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "channel": channel_id,
        "minutes": int(minutes or 30),
        "active_project": active_project,
        "autonomy_mode": autonomy_mode,
        "permission_policy": permission_policy,
        "counts": {
            "console_events": len(console_events),
            "tool_logs": len(tool_logs),
            "tasks": len(tasks),
            "processes": len(processes),
        },
    }
    if include_prompts:
        # We don't persist full prompts (only metadata events). Keep placeholder so the bundle is stable.
        snapshot["prompts_included"] = False

    if redact_secrets:
        snapshot = _redact_obj(snapshot)
        console_events = _redact_obj(console_events)
        tool_logs = _redact_obj(tool_logs)
        tasks = _redact_obj(tasks)
        process_index = _redact_obj(process_index)
        processes = _redact_obj(processes)

    bundle_dir = (AI_OFFICE_HOME / "debug-bundles").resolve()
    bundle_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    file_name = f"debug-bundle-{channel_id}-{ts}.zip"
    out_path = (bundle_dir / file_name).resolve()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", _dump_json(snapshot))
        zf.writestr("console_events.json", _dump_json(console_events))
        zf.writestr("tool_logs.json", _dump_json(tool_logs))
        zf.writestr("tasks.json", _dump_json(tasks))
        zf.writestr("processes.json", _dump_json(process_index))

        for proc in processes:
            proc_id = str(proc.get("id") or "").strip() or "unknown"
            logs = proc.get("logs") or []
            if not logs:
                continue
            safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", proc_id)[:64] or "process"
            zf.writestr(f"process_logs/{safe_id}.log", "\n".join([str(line) for line in logs]) + "\n")

    out_path.write_bytes(buffer.getvalue())
    created_at = _utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return DebugBundleResult(
        path=out_path,
        file_name=file_name,
        bytes=out_path.stat().st_size,
        created_at=created_at,
    )

