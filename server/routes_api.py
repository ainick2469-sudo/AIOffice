"""AI Office REST API routes."""

import json
import re
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from typing import Optional
from . import database as db
from .models import (
    AgentOut,
    AgentUpdateIn,
    AppBuilderStartIn,
    BuildConfigIn,
    ExecuteCodeIn,
    OllamaPullIn,
    ProjectCreateIn,
    ProjectSwitchIn,
    ReactionToggleIn,
    TaskIn,
)

router = APIRouter(prefix="/api", tags=["api"])
PROJECT_ROOT = Path("C:/AI_WORKSPACE/ai-office")
UPLOADS_DIR = PROJECT_ROOT / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "upload.bin")
    return cleaned[:120] or "upload.bin"


def _registry_agents() -> list[dict]:
    registry_path = PROJECT_ROOT / "agents" / "registry.json"
    if not registry_path.exists():
        return []
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
        agents = data.get("agents", [])
        return agents if isinstance(agents, list) else []
    except Exception:
        return []


def _recommended_ollama_model_map() -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for agent in _registry_agents():
        if agent.get("backend") != "ollama":
            continue
        if not agent.get("active", True):
            continue
        model = (agent.get("model") or "").strip()
        agent_id = (agent.get("id") or "").strip()
        if not model or not agent_id:
            continue
        mapping.setdefault(model, []).append(agent_id)
    return mapping


@router.get("/agents", response_model=list[AgentOut])
async def list_agents(active_only: bool = True):
    agents = await db.get_agents(active_only)
    return agents


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str):
    agent = await db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdateIn):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No updates provided")

    for key in ("display_name", "role", "model", "permissions", "color", "emoji", "system_prompt"):
        if key in updates and isinstance(updates[key], str):
            updates[key] = updates[key].strip()

    for required in ("display_name", "role", "model", "permissions", "color", "emoji"):
        if required in updates and not updates[required]:
            raise HTTPException(400, f"{required} cannot be empty")

    updated = await db.update_agent(agent_id, updates)
    if not updated:
        raise HTTPException(404, "Agent not found")
    return updated


@router.get("/messages/{channel}")
async def get_messages(channel: str, limit: int = 50, before_id: Optional[int] = None):
    messages = await db.get_messages(channel, limit, before_id)
    return messages


@router.post("/messages/{message_id}/reactions")
async def toggle_message_reaction(message_id: int, body: ReactionToggleIn):
    if not body.emoji.strip():
        raise HTTPException(400, "Emoji is required")
    result = await db.toggle_message_reaction(
        message_id=message_id,
        actor_id=(body.actor_id or "user").strip() or "user",
        actor_type=body.actor_type,
        emoji=body.emoji.strip(),
    )
    message = await db.get_message_by_id(message_id)
    if message:
        from .websocket import manager
        await manager.broadcast(message["channel"], {
            "type": "reaction_update",
            "message_id": message_id,
            "summary": result["summary"],
        })
    return result


@router.get("/messages/{message_id}/reactions")
async def get_message_reaction_summary(message_id: int):
    return await db.get_message_reactions(message_id)


@router.get("/channels")
async def list_channels():
    """List all channels: group rooms + DMs for each active agent."""
    channels = await db.get_channels()
    agents = await db.get_agents(active_only=True)
    custom_names = await db.get_all_channel_names()

    result = []
    for ch in channels:
        name = custom_names.get(ch["id"], ch["name"])
        result.append({"id": ch["id"], "name": name, "type": ch["type"]})

    # Add DM channels (virtual, not stored in DB)
    for a in agents:
        dm_id = f"dm:{a['id']}"
        result.append({
            "id": dm_id,
            "name": custom_names.get(dm_id, f"DM: {a['display_name']}"),
            "type": "dm",
            "agent_id": a["id"],
        })
    return result


@router.post("/channels")
async def create_channel_route(body: dict):
    """Create a new chat room."""
    name = body.get("name", "").strip()
    if not name:
        return {"error": "Name required"}
    # Generate ID from name
    import re
    ch_id = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not ch_id:
        ch_id = f"room-{int(__import__('time').time())}"
    # Check for duplicates
    existing = await db.get_channels()
    if any(c["id"] == ch_id for c in existing):
        ch_id = f"{ch_id}-{int(__import__('time').time()) % 10000}"
    ch = await db.create_channel(ch_id, name, "group")
    return ch


@router.delete("/channels/{channel_id}")
async def delete_channel_route(channel_id: str, delete_messages: bool = True):
    """Delete a chat room and optionally its messages."""
    if channel_id == "main":
        return {"error": "Cannot delete Main Room"}
    await db.delete_channel(channel_id, delete_messages)
    return {"ok": True, "deleted": channel_id, "messages_deleted": delete_messages}


@router.patch("/channels/{channel_id}/name")
async def rename_channel(channel_id: str, body: dict):
    """Manually rename a channel."""
    name = body.get("name", "").strip()
    if not name:
        return {"error": "Name required"}
    await db.set_channel_name(channel_id, name)
    await db.rename_channel_db(channel_id, name)
    return {"ok": True, "channel": channel_id, "name": name}


@router.post("/projects")
async def create_project_route(body: ProjectCreateIn):
    from . import project_manager as pm

    try:
        project = await pm.create_project(body.name, template=body.template)
        from . import build_runner
        detected = await build_runner.detect_and_store_config(project["name"])
        return {"ok": True, "project": project, "detected_config": detected}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/projects")
async def list_projects_route():
    from . import project_manager as pm

    projects = await pm.list_projects()
    return {"projects": projects, "projects_root": str(pm.PROJECTS_ROOT)}


@router.post("/projects/switch")
async def switch_project_route(body: ProjectSwitchIn):
    from . import project_manager as pm

    try:
        result = await pm.switch_project(body.channel, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    detection = await pm.maybe_detect_build_config(body.channel)
    return {"ok": True, "active": result, "detected_config": detection}


@router.get("/projects/active/{channel}")
async def get_active_project_route(channel: str):
    from . import project_manager as pm
    return await pm.get_active_project(channel)


@router.get("/projects/status/{channel}")
async def get_project_status_route(channel: str):
    from . import project_manager as pm
    return await pm.get_project_status(channel)


@router.delete("/projects/{name}")
async def delete_project_route(name: str, confirm_token: Optional[str] = Query(default=None)):
    from . import project_manager as pm

    try:
        return await pm.delete_project(name, confirm_token=confirm_token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/projects/{name}/build-config")
async def get_project_build_config(name: str):
    from . import build_runner

    try:
        config = build_runner.get_build_config(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"project": name, "config": config, "latest_result": build_runner.get_latest_result(name)}


@router.put("/projects/{name}/build-config")
async def put_project_build_config(name: str, body: BuildConfigIn):
    from . import build_runner

    try:
        config = build_runner.set_build_config(name, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "project": name, "config": config}


@router.post("/projects/{name}/build")
async def run_project_build(name: str):
    from . import build_runner
    return build_runner.run_build(name)


@router.post("/projects/{name}/test")
async def run_project_test(name: str):
    from . import build_runner
    return build_runner.run_test(name)


@router.post("/projects/{name}/run")
async def run_project_start(name: str):
    from . import build_runner
    return build_runner.run_start(name)


@router.get("/projects/{name}/git/status")
async def git_status(name: str):
    from . import git_tools
    return git_tools.status(name)


@router.get("/projects/{name}/git/log")
async def git_log(name: str, limit: int = 20):
    from . import git_tools
    return git_tools.log(name, count=limit)


@router.get("/projects/{name}/git/diff")
async def git_diff(name: str):
    from . import git_tools
    return git_tools.diff(name)


@router.post("/projects/{name}/git/commit")
async def git_commit(name: str, body: dict):
    from . import git_tools
    return git_tools.commit(name, str(body.get("message", "")).strip())


@router.post("/projects/{name}/git/branch")
async def git_branch(name: str, body: dict):
    from . import git_tools
    return git_tools.branch(name, str(body.get("name", "")).strip())


@router.post("/projects/{name}/git/merge")
async def git_merge(name: str, body: dict):
    from . import git_tools
    return git_tools.merge(name, str(body.get("name", "")).strip())


@router.post("/execute")
async def execute_code(body: ExecuteCodeIn):
    import subprocess
    import tempfile
    import time

    language = body.language
    code = body.code
    if "&&" in code or "||" in code:
        raise HTTPException(400, "Shell chaining is not allowed.")

    suffix_map = {"python": ".py", "javascript": ".js", "bash": ".sh"}
    run_map = {
        "python": ["cmd", "/c", "python", "{file}"],
        "javascript": ["cmd", "/c", "node", "{file}"],
        "bash": ["cmd", "/c", "bash", "{file}"],
    }

    with tempfile.TemporaryDirectory(prefix="ai-office-exec-") as tmp:
        file_path = Path(tmp) / f"snippet{suffix_map[language]}"
        file_path.write_text(code, encoding="utf-8")
        args = [part if part != "{file}" else str(file_path) for part in run_map[language]]
        started = time.time()
        try:
            proc = subprocess.run(
                args,
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "stdout": (proc.stdout or "")[:12000],
                "stderr": (proc.stderr or "")[:8000],
                "exit_code": proc.returncode,
                "duration_ms": int((time.time() - started) * 1000),
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Execution timed out after 30s.",
                "exit_code": -1,
                "duration_ms": int((time.time() - started) * 1000),
            }


@router.post("/tasks")
async def create_task(task: TaskIn):
    conn = await db.get_db()
    try:
        cursor = await conn.execute(
            "INSERT INTO tasks (title, description, assigned_to, assigned_by, priority) VALUES (?, ?, ?, ?, ?)",
            (task.title, task.description, task.assigned_to, "user", task.priority),
        )
        await conn.commit()
        row = await conn.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,))
        return dict(await row.fetchone())
    finally:
        await conn.close()


@router.get("/tasks")
async def list_tasks(status: Optional[str] = None):
    conn = await db.get_db()
    try:
        if status:
            rows = await conn.execute("SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC", (status,))
        else:
            rows = await conn.execute("SELECT * FROM tasks ORDER BY priority DESC")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.get("/health")
async def health():
    return {"status": "ok", "service": "ai-office"}


@router.get("/health/startup")
async def startup_health():
    from . import claude_adapter, openai_adapter, ollama_client
    from .project_manager import PROJECTS_ROOT

    db_ok = False
    db_error = ""
    conn = None
    try:
        conn = await db.get_db()
        await conn.execute("SELECT 1")
        db_ok = True
    except Exception as exc:
        db_error = str(exc)
    finally:
        try:
            await conn.close()
        except Exception:
            pass

    projects_root_ok = PROJECTS_ROOT.exists() and PROJECTS_ROOT.is_dir()
    frontend_dist_ok = (PROJECT_ROOT / "client-dist" / "index.html").exists()
    backends = {
        "ollama": bool(await ollama_client.is_available()),
        "claude": bool(claude_adapter.is_available()),
        "openai": bool(openai_adapter.is_available()),
    }

    warnings = []
    if not frontend_dist_ok:
        warnings.append("frontend_dist_missing")
    if not backends["ollama"]:
        warnings.append("ollama_unavailable")
    if not backends["claude"]:
        warnings.append("claude_unavailable")
    if not backends["openai"]:
        warnings.append("openai_unavailable")

    checks = {
        "db": {"ok": db_ok, "error": db_error},
        "projects_root": {"ok": projects_root_ok, "path": str(PROJECTS_ROOT)},
        "frontend_dist": {"ok": frontend_dist_ok},
        "backends": backends,
    }
    overall_healthy = db_ok and projects_root_ok
    return {
        "status": "ok" if overall_healthy else "degraded",
        "overall_healthy": overall_healthy,
        "checks": checks,
        "warnings": warnings,
    }


@router.get("/memory/shared")
async def get_shared_memory(limit: int = 50, type_filter: Optional[str] = None):
    from .memory import read_memory
    return read_memory(None, limit=limit, type_filter=type_filter)


@router.get("/memory/{agent_id}")
async def get_agent_memory(agent_id: str, limit: int = 50):
    from .memory import read_all_memory_for_agent
    return read_all_memory_for_agent(agent_id, limit=limit)


@router.get("/audit")
async def get_audit_logs(limit: int = 50, agent_id: Optional[str] = None):
    conn = await db.get_db()
    try:
        if agent_id:
            rows = await conn.execute(
                "SELECT * FROM tool_logs WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
                (agent_id, limit))
        else:
            rows = await conn.execute(
                "SELECT * FROM tool_logs ORDER BY id DESC LIMIT ?", (limit,))
        results = [dict(r) for r in await rows.fetchall()]
        results.reverse()
        return results
    finally:
        await conn.close()


@router.post("/tools/read")
async def tool_read(filepath: str, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_read_file
    return await tool_read_file(agent_id, filepath, channel=channel)


@router.post("/tools/search")
async def tool_search(pattern: str, directory: str = ".", channel: str = "main"):
    from .tool_gateway import tool_search_files
    return await tool_search_files("user", pattern, directory, channel=channel)


@router.post("/tools/run")
async def tool_run(command: str, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_run_command
    return await tool_run_command(agent_id, command, channel=channel)


@router.post("/tools/write")
async def tool_write(filepath: str, content: str,
                     approved: bool = False, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_write_file
    return await tool_write_file(agent_id, filepath, content, approved, channel=channel)


@router.post("/tools/web")
async def tool_web_search(query: str):
    from . import web_search
    return await web_search.search_web(query, limit=8)


@router.post("/tools/fetch")
async def tool_web_fetch(url: str):
    from . import web_search
    return await web_search.fetch_url(url)


@router.post("/release-gate")
async def trigger_release_gate():
    from .release_gate import run_release_gate
    import asyncio
    task = asyncio.create_task(run_release_gate("main"))
    return {"status": "started", "message": "Release gate pipeline running in main room"}


@router.post("/app-builder/start")
async def start_app_builder_route(body: AppBuilderStartIn):
    from .app_builder import start_app_builder

    try:
        return await start_app_builder(
            channel=(body.channel or "main").strip() or "main",
            app_name=body.app_name,
            goal=body.goal,
            stack=body.stack,
            target_dir=body.target_dir,
            include_tests=body.include_tests,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/release-gate/history")
async def release_gate_history():
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            "SELECT * FROM decisions WHERE decided_by = 'release_gate' ORDER BY id DESC LIMIT 10")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.post("/pulse/start")
async def start_pulse_endpoint():
    from .pulse import start_pulse
    start_pulse()
    return {"status": "started"}


@router.post("/pulse/stop")
async def stop_pulse_endpoint():
    from .pulse import stop_pulse
    stop_pulse()
    return {"status": "stopped"}


@router.get("/pulse/status")
async def pulse_status():
    from .pulse import get_pulse_status
    return get_pulse_status()


@router.post("/work/start")
async def work_start(body: dict):
    from .autonomous_worker import start_work

    channel = str(body.get("channel", "main")).strip() or "main"
    return start_work(channel)


@router.post("/work/stop")
async def work_stop(body: dict):
    from .autonomous_worker import stop_work

    channel = str(body.get("channel", "main")).strip() or "main"
    return stop_work(channel)


@router.get("/work/status/{channel}")
async def work_status(channel: str):
    from .autonomous_worker import get_work_status

    return get_work_status(channel)


@router.get("/conversation/{channel}")
async def conversation_status(channel: str):
    from .agent_engine import get_conversation_status
    return get_conversation_status(channel)


@router.get("/collab-mode/{channel}")
async def collab_mode_status(channel: str):
    from .agent_engine import get_collab_mode_status
    return get_collab_mode_status(channel)


@router.post("/conversation/{channel}/stop")
async def stop_conversation(channel: str):
    from .agent_engine import stop_conversation as _stop
    stopped = await _stop(channel)
    return {"stopped": stopped}


@router.patch("/tasks/{task_id}/status")
async def update_task_status(task_id: int, body: dict):
    new_status = str(body.get("status", "backlog")).strip().lower()
    if new_status not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {new_status}")
    conn = await db.get_db()
    try:
        await conn.execute(
            "UPDATE tasks SET status = ?, assigned_by = COALESCE(assigned_by, ?), updated_at = datetime('now') WHERE id = ?",
            (new_status, "user", task_id))
        await conn.commit()
        row = await conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        result = await row.fetchone()
        return dict(result) if result else {"error": "Not found"}
    finally:
        await conn.close()


@router.get("/files/tree")
async def file_tree(path: str = "."):
    """Get directory tree for file viewer."""
    from pathlib import Path
    base = Path("C:/AI_WORKSPACE/ai-office") / path
    if not str(base.resolve()).startswith(str(Path("C:/AI_WORKSPACE/ai-office").resolve())):
        return {"error": "Outside sandbox"}

    items = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith('.') or entry.name in ('node_modules', '__pycache__', '.git', 'data'):
                continue
            items.append({
                "name": entry.name,
                "path": str(entry.relative_to(Path("C:/AI_WORKSPACE/ai-office"))).replace("\\", "/"),
                "type": "dir" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
            })
    except Exception as e:
        return {"error": str(e)}
    return items


@router.get("/files/read")
async def file_read(path: str):
    """Read file contents for file viewer."""
    from .tool_gateway import tool_read_file
    return await tool_read_file("viewer", path)


@router.post("/files/upload")
async def file_upload(file: UploadFile = File(...)):
    """Upload a user file for sharing in chat."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(file.filename or "upload.bin")
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    final_name = f"{stamp}-{safe_name}"
    target = UPLOADS_DIR / final_name

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")

    target.write_bytes(data)
    rel_path = f"uploads/{final_name}"
    return {
        "ok": True,
        "original_name": file.filename or safe_name,
        "file_name": final_name,
        "path": rel_path,
        "url": f"/{rel_path}",
        "size": len(data),
        "content_type": file.content_type or "application/octet-stream",
    }


@router.get("/claude/status")
async def claude_status():
    from .claude_adapter import is_available
    return {"available": is_available()}


@router.get("/ollama/status")
async def ollama_status():
    from . import ollama_client
    return {"available": await ollama_client.is_available()}


@router.get("/ollama/models/recommendations")
async def ollama_model_recommendations():
    from . import ollama_client

    available = await ollama_client.is_available()
    installed = await ollama_client.list_models() if available else []
    installed_set = set(installed)
    model_map = _recommended_ollama_model_map()

    recommended = []
    for model_name in sorted(model_map.keys()):
        recommended.append({
            "model": model_name,
            "agents": sorted(model_map[model_name]),
            "installed": model_name in installed_set,
        })

    missing = [item["model"] for item in recommended if not item["installed"]]
    return {
        "available": available,
        "installed_models": installed,
        "recommended_models": recommended,
        "missing_models": missing,
        "missing_count": len(missing),
    }


@router.post("/ollama/models/pull")
async def ollama_pull_models(body: OllamaPullIn):
    from . import ollama_client

    if not await ollama_client.is_available():
        raise HTTPException(503, "Ollama is not available on 127.0.0.1:11434")

    installed = set(await ollama_client.list_models())
    recommended_map = _recommended_ollama_model_map()
    recommended = set(recommended_map.keys())
    requested = {m.strip() for m in body.models if m and m.strip()}

    targets = set(requested)
    if body.include_recommended:
        targets.update(recommended)

    if body.pull_missing_only:
        targets = {m for m in targets if m not in installed}

    if not targets:
        return {
            "status": "noop",
            "pulled": [],
            "failed": [],
            "message": "No models to pull.",
        }

    pulled: list[dict] = []
    failed: list[dict] = []
    for model_name in sorted(targets):
        result = await ollama_client.pull_model(model_name)
        if result.get("ok"):
            pulled.append(result)
        else:
            failed.append(result)

    return {
        "status": "completed" if not failed else "partial",
        "requested": sorted(targets),
        "pulled": pulled,
        "failed": failed,
        "pulled_count": len(pulled),
        "failed_count": len(failed),
    }


@router.get("/openai/status")
async def openai_status():
    from .openai_adapter import is_available
    return {"available": is_available()}

@router.get("/messages/search")
async def search_messages(q: str, channel: str = None, limit: int = 50):
    """Search messages across all channels or a specific one."""
    conn = await db.get_db()
    try:
        if channel:
            rows = await conn.execute(
                "SELECT * FROM messages WHERE content LIKE ? AND channel = ? ORDER BY created_at DESC LIMIT ?",
                (f"%{q}%", channel, limit))
        else:
            rows = await conn.execute(
                "SELECT * FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?",
                (f"%{q}%", limit))
        results = [dict(r) for r in await rows.fetchall()]
        return results
    finally:
        await conn.close()


@router.get("/agents/{agent_id}/profile")
async def agent_profile(agent_id: str):
    """Get agent profile with stats and recent memory."""
    from .memory import read_all_memory_for_agent
    agent = await db.get_agent(agent_id)
    if not agent:
        return {"error": "Not found"}

    conn = await db.get_db()
    try:
        # Message count
        row = await conn.execute(
            "SELECT COUNT(*) as count FROM messages WHERE sender = ?", (agent_id,))
        msg_count = (await row.fetchone())["count"]

        # Recent messages
        rows = await conn.execute(
            "SELECT * FROM messages WHERE sender = ? ORDER BY created_at DESC LIMIT 10", (agent_id,))
        recent = [dict(r) for r in await rows.fetchall()]

        # Memory
        memories = read_all_memory_for_agent(agent_id, limit=20)
        performance = await db.get_agent_performance(agent_id)

        return {
            **dict(agent),
            "message_count": msg_count,
            "recent_messages": recent,
            "memories": memories,
            "performance": performance,
        }
    finally:
        await conn.close()


@router.get("/decisions")
async def get_decisions(limit: int = 50):
    """Get all decisions."""
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            "SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?", (limit,))
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.get("/usage")
async def api_usage(limit: int = 200):
    conn = await db.get_db()
    try:
        rows = await conn.execute("SELECT * FROM api_usage ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.get("/usage/summary")
async def api_usage_summary(channel: Optional[str] = None, project: Optional[str] = None):
    summary = await db.get_api_usage_summary(channel=channel, project_name=project)
    budget_raw = await db.get_setting("api_budget_usd")
    if budget_raw is None:
        import os
        budget_raw = os.environ.get("API_USAGE_BUDGET_USD", "").strip()
    try:
        budget = float(budget_raw) if budget_raw else 0.0
    except Exception:
        budget = 0.0
    used = float(summary.get("total_estimated_cost", 0.0) or 0.0)
    return {
        **summary,
        "budget_usd": budget,
        "budget_warning": bool(budget > 0 and used >= budget * 0.8),
        "budget_exceeded": bool(budget > 0 and used >= budget),
        "remaining_usd": max(0.0, budget - used),
    }


@router.get("/usage/budget")
async def get_api_budget():
    value = await db.get_setting("api_budget_usd")
    if value is None:
        import os
        value = os.environ.get("API_USAGE_BUDGET_USD", "").strip()
    try:
        budget = float(value) if value else 0.0
    except Exception:
        budget = 0.0
    return {"budget_usd": budget}


@router.put("/usage/budget")
async def set_api_budget(body: dict):
    raw = str(body.get("budget_usd", "0")).strip()
    try:
        value = float(raw)
    except Exception:
        raise HTTPException(400, "budget_usd must be numeric")
    if value < 0:
        raise HTTPException(400, "budget_usd must be >= 0")
    await db.set_setting("api_budget_usd", str(value))
    return {"ok": True, "budget_usd": value}


@router.get("/performance/agents")
async def agents_performance():
    perf = await db.get_all_agent_performance()
    agents = await db.get_agents(active_only=False)
    meta = {a["id"]: a for a in agents}
    enriched = []
    for item in perf:
        aid = item["agent_id"]
        agent = meta.get(aid, {})
        enriched.append({
            **item,
            "display_name": agent.get("display_name", aid),
            "emoji": agent.get("emoji", "AI"),
            "color": agent.get("color", "#6B7280"),
        })
    return enriched


@router.post("/agents/{agent_id}/memory/cleanup")
async def cleanup_agent_memory(agent_id: str):
    """Remove duplicate memories for an agent."""
    from .memory import cleanup_memories
    removed = cleanup_memories(agent_id)
    shared_removed = cleanup_memories(None)
    return {"ok": True, "removed": removed, "shared_removed": shared_removed}


@router.get("/agents/{agent_id}/memories")
async def get_agent_memories(agent_id: str, limit: int = 100, type: str = None):
    """Get paginated memories for an agent."""
    from .memory import read_all_memory_for_agent, read_memory
    if type:
        personal = read_memory(agent_id, limit=limit, type_filter=type)
        shared = read_memory(None, limit=limit, type_filter=type)
        # Deduplicate
        seen = set()
        combined = []
        for entry in personal + shared:
            key = entry.get("content", "").lower().strip()
            if key not in seen:
                seen.add(key)
                combined.append(entry)
        combined.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return combined[:limit]
    else:
        memories = read_all_memory_for_agent(agent_id, limit=limit)
        memories.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return memories
