"""AI Office REST API routes."""

import json
import re
import os
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Request
from fastapi.responses import FileResponse
from typing import Optional
from . import database as db
from .models import (
    ApprovalResponseIn,
    AutonomyModeIn,
    AgentOut,
    AgentUpdateIn,
    AppBuilderStartIn,
    BranchSwitchIn,
    BuildConfigIn,
    CreateSkillIn,
    MergeApplyIn,
    MergePreviewIn,
    ProcessStartIn,
    ProcessStopIn,
    ProjectActiveOut,
    DebugBundleIn,
    MemoryEraseIn,
    ExecuteCodeIn,
    OllamaPullIn,
    PermissionPolicyIn,
    PermissionPolicyOut,
    PermissionGrantIn,
    PermissionRevokeIn,
    RunCommandIn,
    ProjectCreateIn,
    ProjectSwitchIn,
    ReactionToggleIn,
    TaskIn,
    TaskUpdateIn,
    TrustSessionIn,
)
from .runtime_config import (
    AI_OFFICE_HOME,
    APP_ROOT,
    build_runtime_env,
    executable_candidates,
    resolve_executable as resolve_runtime_executable,
)

router = APIRouter(prefix="/api", tags=["api"])
PROJECT_ROOT = APP_ROOT
UPLOADS_DIR = AI_OFFICE_HOME / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _resolve_executable(name: str, candidates: list[str]) -> str:
    return resolve_runtime_executable(name, candidates)


def _runtime_env() -> dict:
    return build_runtime_env(os.environ.copy())


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "upload.bin")
    return cleaned[:120] or "upload.bin"


def _normalize_timestamp(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = value.strip().replace("T", " ").replace("Z", "")
    return text or None


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


@router.delete("/channels/{channel_id}/messages")
async def clear_channel_messages_route(channel_id: str):
    deleted = await db.clear_channel_messages(channel_id)
    system_message = await db.insert_message(
        channel=channel_id,
        sender="system",
        content="Chat history cleared.",
        msg_type="system",
    )

    from .websocket import manager

    await manager.broadcast(channel_id, {"type": "chat", "message": system_message})
    return {
        "ok": True,
        "channel": channel_id,
        "deleted_count": deleted,
        "system_message": system_message,
    }


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
    return {"projects": projects, "projects_root": str(pm.WORKSPACE_ROOT)}


@router.post("/projects/switch")
async def switch_project_route(body: ProjectSwitchIn):
    from . import project_manager as pm

    try:
        result = await pm.switch_project(body.channel, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    detection = await pm.maybe_detect_build_config(body.channel)
    return {"ok": True, "active": result, "detected_config": detection}


@router.get("/projects/active/{channel}", response_model=ProjectActiveOut)
async def get_active_project_route(channel: str):
    from . import project_manager as pm
    return await pm.get_active_project(channel)


@router.get("/projects/status/{channel}")
async def get_project_status_route(channel: str):
    from . import project_manager as pm
    return await pm.get_project_status(channel)


@router.get("/projects/{name}/autonomy-mode")
async def get_project_autonomy_mode(name: str):
    mode = await db.get_project_autonomy_mode(name)
    return {"project": name, "mode": mode}


@router.put("/projects/{name}/autonomy-mode")
async def set_project_autonomy_mode(name: str, body: AutonomyModeIn):
    try:
        mode = await db.set_project_autonomy_mode(name, body.mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "project": name, "mode": mode}


@router.get("/permissions", response_model=PermissionPolicyOut)
async def get_channel_permissions(channel: str = "main"):
    return await db.get_permission_policy(channel)


@router.put("/permissions", response_model=PermissionPolicyOut)
async def put_channel_permissions(body: PermissionPolicyIn):
    try:
        return await db.set_permission_policy(
            body.channel,
            mode=body.mode,
            expires_at=body.expires_at,
            scopes=body.scopes,
            command_allowlist_profile=body.command_allowlist_profile,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/trust_session", response_model=PermissionPolicyOut)
async def trust_session_permissions(body: TrustSessionIn):
    try:
        return await db.issue_trusted_session(
            body.channel,
            minutes=body.minutes,
            scopes=body.scopes,
            command_allowlist_profile=body.command_allowlist_profile,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/grant", response_model=PermissionPolicyOut)
async def grant_channel_permission(body: PermissionGrantIn):
    try:
        await db.grant_permission_scope(
            channel=body.channel,
            scope=body.scope,
            grant_level=body.grant_level,
            minutes=body.minutes,
            project_name=body.project_name,
            source_request_id=body.request_id,
            created_by=body.created_by,
        )
        return await db.get_permission_policy(body.channel)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/revoke", response_model=PermissionPolicyOut)
async def revoke_channel_permission(body: PermissionRevokeIn):
    try:
        await db.revoke_permission_grant(
            channel=body.channel,
            grant_id=body.grant_id,
            scope=body.scope,
            project_name=body.project_name,
        )
        return await db.get_permission_policy(body.channel)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/approval-response")
async def permissions_approval_response(body: ApprovalResponseIn):
    from . import tool_gateway
    from .websocket import manager

    resolved = await tool_gateway.resolve_approval_response(
        body.request_id,
        approved=body.approved,
        decided_by=body.decided_by,
    )
    if not resolved:
        raise HTTPException(404, "Approval request not found")

    await manager.broadcast(resolved["channel"], {
        "type": "approval_resolved",
        "request_id": body.request_id,
        "approved": bool(body.approved),
        "decided_by": body.decided_by,
    })
    return {"ok": True, "request": resolved}


@router.get("/approvals/pending")
async def approvals_pending(
    channel: str = Query(default="main"),
    project: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    requests = await db.list_pending_approval_requests(channel, project_name=project, limit=limit)
    return {"ok": True, "channel": channel, "project": project, "requests": requests}


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


@router.get("/projects/{name}/branches")
async def list_project_branches_route(name: str, channel: Optional[str] = None):
    from . import git_tools
    from . import project_manager as pm

    result = git_tools.list_branches(name)
    if not result.get("ok"):
        return result
    active_branch = (
        await pm.get_active_branch(channel, name)
        if channel
        else (result.get("current_branch") or "main")
    )
    channel_state = await db.list_project_branches_state(name)
    return {
        **result,
        "active_branch": active_branch,
        "channel_branch_state": channel_state,
    }


@router.post("/projects/{name}/branches/switch")
async def switch_project_branch_route(name: str, body: BranchSwitchIn):
    from . import git_tools
    from . import project_manager as pm

    result = git_tools.switch_branch(
        name,
        body.branch,
        create_if_missing=bool(body.create_if_missing),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or result.get("stderr") or "Failed to switch branch")

    branch = (result.get("current_branch") or body.branch).strip() or "main"
    await pm.set_active_branch(body.channel, name, branch)
    active = await pm.get_active_project(body.channel)
    return {
        "ok": True,
        "project": name,
        "channel": body.channel,
        "branch": branch,
        "active": active,
        "git": result,
    }


@router.post("/projects/{name}/merge-preview")
async def merge_preview_route(name: str, body: MergePreviewIn):
    from . import git_tools
    return git_tools.merge_preview(name, body.source_branch, body.target_branch)


@router.post("/projects/{name}/merge-apply")
async def merge_apply_route(name: str, body: MergeApplyIn):
    from . import git_tools
    return git_tools.merge_apply(
        name,
        body.source_branch,
        body.target_branch,
        allow_dirty_override=bool(body.allow_dirty_override),
    )


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

    python_exe = _resolve_executable("python", executable_candidates("python"))
    node_exe = _resolve_executable("node", executable_candidates("node"))
    bash_exe = _resolve_executable("bash", executable_candidates("bash"))

    suffix_map = {"python": ".py", "javascript": ".js", "bash": ".sh"}
    run_map = {
        "python": [python_exe, "{file}"],
        "javascript": [node_exe, "{file}"],
        "bash": [bash_exe, "{file}"],
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
                env=_runtime_env(),
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
async def create_task(task: TaskIn, channel: str = "main"):
    payload = task.model_dump()
    selected_channel = (payload.get("channel") or channel or "main").strip() or "main"
    if not payload["title"].strip():
        raise HTTPException(400, "Title is required.")
    if "branch" in payload and payload["branch"] is not None:
        payload["branch"] = str(payload["branch"]).strip() or None
    return await db.create_task_record(
        payload,
        channel=selected_channel,
        project_name=(payload.get("project_name") or None),
    )


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
):
    if status and status not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {status}")
    if branch is not None and not str(branch).strip():
        raise HTTPException(400, "branch cannot be empty")
    if channel is not None and not str(channel).strip():
        raise HTTPException(400, "channel cannot be empty")
    if project_name is not None and not str(project_name).strip():
        raise HTTPException(400, "project_name cannot be empty")
    return await db.list_tasks(status=status, branch=branch, channel=channel, project_name=project_name)


@router.get("/tasks/{task_id}")
async def get_task(task_id: int):
    task = await db.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.put("/tasks/{task_id}")
async def update_task(task_id: int, body: TaskUpdateIn):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No updates provided.")
    if "title" in updates and not str(updates["title"]).strip():
        raise HTTPException(400, "Title cannot be empty.")
    if "status" in updates and updates["status"] not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {updates['status']}")
    if "branch" in updates and not str(updates["branch"]).strip():
        raise HTTPException(400, "branch cannot be empty.")
    updated = await db.update_task(task_id, updates)
    if not updated:
        raise HTTPException(404, "Task not found")
    return updated


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int):
    ok = await db.delete_task(task_id)
    if not ok:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "deleted": task_id}


@router.get("/health")
async def health():
    return {"status": "ok", "service": "ai-office"}


@router.get("/health/startup")
async def startup_health():
    from . import claude_adapter, openai_adapter, ollama_client
    from .project_manager import WORKSPACE_ROOT

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

    projects_root_ok = WORKSPACE_ROOT.exists() and WORKSPACE_ROOT.is_dir()
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
        "projects_root": {"ok": projects_root_ok, "path": str(WORKSPACE_ROOT)},
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


@router.get("/memory/stats")
async def memory_stats(project: str = Query(default="ai-office")):
    from .memory import get_memory_stats
    return get_memory_stats(project)


@router.post("/memory/erase")
async def memory_erase(body: MemoryEraseIn):
    from .memory import erase_memory

    project = (body.project or "").strip() or "ai-office"
    channel = (body.channel or "main").strip() or "main"
    scopes = list(body.scopes or [])

    result = erase_memory(project, scopes)
    cleared = {"messages_deleted": 0, "tasks_deleted": 0, "approvals_deleted": 0}
    system_message = None

    if body.also_clear_tasks:
        cleared["tasks_deleted"] = await db.clear_tasks_for_scope(channel=channel, project_name=project)

    if body.also_clear_approvals:
        cleared["approvals_deleted"] = await db.clear_approval_requests_for_scope(channel=channel, project_name=project)

    if body.also_clear_channel_messages:
        cleared["messages_deleted"] = await db.clear_channel_messages(channel)
        system_message = await db.insert_message(
            channel=channel,
            sender="system",
            content="Chat history cleared.",
            msg_type="system",
        )
        from .websocket import manager
        await manager.broadcast(channel, {"type": "chat", "message": system_message})

    try:
        await db.log_console_event(
            channel=channel,
            event_type="memory_erase",
            source="controls",
            project_name=project,
            message=f"Memory erased: {', '.join(result.get('scopes_erased') or [])}",
            data={"scopes": result.get("scopes_erased") or [], "cleared": cleared},
        )
    except Exception:
        pass

    return {
        "ok": True,
        "project": project,
        "scopes_erased": result.get("scopes_erased") or [],
        "memory_stats": result.get("stats") or {},
        "cleared": cleared,
        "system_message": system_message,
    }


@router.get("/memory/{agent_id}")
async def get_agent_memory(agent_id: str, limit: int = 50):
    from .memory import read_all_memory_for_agent
    return read_all_memory_for_agent(agent_id, limit=limit)


@router.get("/audit")
async def get_audit_logs(
    limit: int = 200,
    agent_id: Optional[str] = None,
    tool_type: Optional[str] = None,
    channel: Optional[str] = None,
    task_id: Optional[str] = None,
    risk_level: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    conn = await db.get_db()
    try:
        where = []
        params = []
        if agent_id:
            where.append("tl.agent_id = ?")
            params.append(agent_id)
        if tool_type:
            where.append("tl.tool_type = ?")
            params.append(tool_type)
        if channel:
            where.append("tl.channel = ?")
            params.append(channel)
        if task_id:
            where.append("tl.task_id = ?")
            params.append(task_id)
        if risk_level:
            where.append("COALESCE(ar.risk_level, '') = ?")
            params.append(risk_level.strip().lower())
        if q:
            where.append("(tl.command LIKE ? OR tl.args LIKE ? OR tl.output LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])
        start_ts = _normalize_timestamp(date_from)
        end_ts = _normalize_timestamp(date_to)
        if start_ts:
            where.append("tl.created_at >= ?")
            params.append(start_ts)
        if end_ts:
            where.append("tl.created_at <= ?")
            params.append(end_ts)

        sql = (
            "SELECT tl.*, COALESCE(ar.risk_level, '') AS risk_level "
            "FROM tool_logs tl "
            "LEFT JOIN approval_requests ar ON ar.id = tl.approval_request_id"
        )
        if where:
            sql += " WHERE " + " AND ".join(where)
        safe_limit = max(1, min(int(limit), 1000))
        sql += " ORDER BY tl.id DESC LIMIT ?"
        params.append(safe_limit)
        rows = await conn.execute(sql, tuple(params))
        results = [dict(r) for r in await rows.fetchall()]
        results.reverse()
        return results
    finally:
        await conn.close()


@router.get("/audit/export")
async def export_audit_logs(
    channel: Optional[str] = None,
    task_id: Optional[str] = None,
    tool_type: Optional[str] = None,
    risk_level: Optional[str] = None,
):
    rows = await get_audit_logs(
        limit=1000,
        channel=channel,
        task_id=task_id,
        tool_type=tool_type,
        risk_level=risk_level,
    )
    return {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "filters": {
            "channel": channel,
            "task_id": task_id,
            "tool_type": tool_type,
            "risk_level": risk_level,
        },
        "count": len(rows),
        "rows": rows,
    }


@router.get("/audit/count")
async def get_audit_count():
    conn = await db.get_db()
    try:
        row = await conn.execute("SELECT COUNT(*) AS c FROM tool_logs")
        result = await row.fetchone()
        return {"count": int(result["c"] if result else 0)}
    finally:
        await conn.close()


@router.delete("/audit/logs")
async def clear_audit_logs():
    conn = await db.get_db()
    try:
        cursor = await conn.execute("DELETE FROM tool_logs")
        await conn.commit()
        return {"ok": True, "deleted_logs": int(cursor.rowcount or 0)}
    finally:
        await conn.close()


@router.delete("/audit/decisions")
async def clear_audit_decisions():
    conn = await db.get_db()
    try:
        cursor = await conn.execute("DELETE FROM decisions")
        await conn.commit()
        return {"ok": True, "deleted_decisions": int(cursor.rowcount or 0)}
    finally:
        await conn.close()


@router.delete("/audit/all")
async def clear_audit_all():
    conn = await db.get_db()
    try:
        logs_cursor = await conn.execute("DELETE FROM tool_logs")
        decisions_cursor = await conn.execute("DELETE FROM decisions")
        await conn.commit()
        return {
            "ok": True,
            "deleted_logs": int(logs_cursor.rowcount or 0),
            "deleted_decisions": int(decisions_cursor.rowcount or 0),
        }
    finally:
        await conn.close()


@router.get("/console/events/{channel}")
async def get_console_events_route(
    channel: str,
    limit: int = 200,
    event_type: Optional[str] = None,
    source: Optional[str] = None,
):
    return await db.get_console_events(
        channel=channel,
        limit=limit,
        event_type=event_type,
        source=source,
    )


@router.post("/debug/bundle")
async def export_debug_bundle(body: DebugBundleIn):
    from . import debug_bundle

    try:
        result = await debug_bundle.create_debug_bundle(
            channel=(body.channel or "main").strip() or "main",
            minutes=int(body.minutes or 30),
            include_prompts=bool(body.include_prompts),
            redact_secrets=bool(body.redact_secrets),
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return FileResponse(
        path=str(result.path),
        media_type="application/zip",
        filename=result.file_name,
    )


@router.post("/tools/read")
async def tool_read(filepath: str, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_read_file
    return await tool_read_file(agent_id, filepath, channel=channel)


@router.post("/tools/search")
async def tool_search(pattern: str, directory: str = ".", channel: str = "main"):
    from .tool_gateway import tool_search_files
    return await tool_search_files("user", pattern, directory, channel=channel)


@router.post("/tools/run")
async def tool_run(request: Request, command: Optional[str] = None, agent_id: str = "user", channel: str = "main", approved: bool = False):
    from .tool_gateway import tool_run_command

    # Prefer structured JSON payloads (argv execution) when provided.
    if (request.headers.get("content-type") or "").lower().startswith("application/json"):
        try:
            raw = await request.json()
        except Exception:
            raw = None
        if isinstance(raw, dict) and raw:
            try:
                body = RunCommandIn(**raw)
            except Exception as exc:
                raise HTTPException(400, str(exc))
            return await tool_run_command(
                (body.agent_id or "user").strip() or "user",
                body.command or "",
                channel=(body.channel or "main").strip() or "main",
                approved=bool(body.approved),
                cmd=body.cmd,
                cwd=body.cwd,
                env=body.env,
                timeout=body.timeout,
            )

    if not (command or "").strip():
        raise HTTPException(400, "command is required")
    return await tool_run_command(agent_id, command, channel=channel, approved=bool(approved))


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


@router.post("/tools/create-skill")
async def create_skill_route(body: CreateSkillIn):
    from . import skills_loader

    created = skills_loader.create_skill_scaffold(body.name)
    if not created.get("ok"):
        raise HTTPException(400, created.get("error", "Failed to create skill."))
    return {"ok": True, "skill": created}


@router.post("/skills/reload")
async def reload_skills_route():
    from . import skills_loader
    return skills_loader.reload_skills()


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
    approved = bool(body.get("approved", False))
    return start_work(channel, approved=approved)


@router.post("/work/stop")
async def work_stop(body: dict):
    from .autonomous_worker import stop_work

    channel = str(body.get("channel", "main")).strip() or "main"
    return stop_work(channel)


@router.get("/work/status/{channel}")
async def work_status(channel: str):
    from .autonomous_worker import get_work_status

    return get_work_status(channel)


@router.post("/process/start")
async def process_start(body: ProcessStartIn):
    from . import process_manager

    try:
        result = await process_manager.start_process(
            channel=(body.channel or "main").strip() or "main",
            command=body.command,
            name=body.name,
            project=body.project,
            agent_id=(body.agent_id or "user").strip() or "user",
            approved=bool(body.approved),
            task_id=(body.task_id or "").strip() or None,
        )
        return {"ok": True, "process": result}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/process/stop")
async def process_stop(body: ProcessStopIn):
    from . import process_manager

    try:
        result = await process_manager.stop_process(
            channel=(body.channel or "main").strip() or "main",
            process_id=body.process_id,
        )
        return {"ok": True, "process": result}
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.get("/process/list/{channel}")
async def process_list(channel: str, include_logs: bool = False):
    from . import process_manager

    processes = await process_manager.list_processes(channel, include_logs=include_logs)
    return {"channel": channel, "processes": processes}


@router.post("/process/kill-switch")
async def process_kill_switch(body: dict):
    from . import process_manager

    channel = str(body.get("channel", "main")).strip() or "main"
    result = await process_manager.kill_switch(channel)
    return result


@router.get("/process/orphans")
async def process_orphans(channel: Optional[str] = None, project: Optional[str] = None):
    from . import process_manager

    orphans = await process_manager.list_orphan_processes(channel=channel, project_name=project)
    return {"orphans": orphans, "count": len(orphans)}


@router.post("/process/orphans/cleanup")
async def process_orphans_cleanup(body: dict):
    from . import process_manager

    channel = str(body.get("channel") or "").strip() or None
    project = str(body.get("project_name") or body.get("project") or "").strip() or None
    raw_ids = body.get("process_ids") or body.get("process_id") or []
    if isinstance(raw_ids, (str, int)):
        raw_ids = [raw_ids]
    if not isinstance(raw_ids, list):
        raw_ids = []
    process_ids = [str(item).strip() for item in raw_ids if str(item).strip()]

    return await process_manager.cleanup_orphan_processes(
        channel=channel,
        project_name=project,
        process_ids=process_ids or None,
    )


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
    task = await db.update_task(task_id, {"status": new_status})
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.get("/files/tree")
async def file_tree(path: str = "."):
    """Get directory tree for file viewer."""
    root = PROJECT_ROOT.resolve()
    base = (root / path).resolve()
    try:
        base.relative_to(root)
    except Exception:
        return {"error": "Outside sandbox"}

    items = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith('.') or entry.name in ('node_modules', '__pycache__', '.git', 'data'):
                continue
            items.append({
                "name": entry.name,
                "path": str(entry.relative_to(root)).replace("\\", "/"),
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
