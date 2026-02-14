"""AI Office — REST API routes."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from . import database as db
from .models import MessageOut, AgentOut, TaskIn

router = APIRouter(prefix="/api", tags=["api"])


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


@router.get("/messages/{channel}")
async def get_messages(channel: str, limit: int = 50, before_id: Optional[int] = None):
    messages = await db.get_messages(channel, limit, before_id)
    return messages


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


@router.post("/tasks")
async def create_task(task: TaskIn):
    conn = await db.get_db()
    try:
        cursor = await conn.execute(
            "INSERT INTO tasks (title, description, assigned_to, priority) VALUES (?, ?, ?, ?)",
            (task.title, task.description, task.assigned_to, task.priority),
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
async def tool_read(filepath: str, agent_id: str = "user"):
    from .tool_gateway import tool_read_file
    return await tool_read_file(agent_id, filepath)


@router.post("/tools/search")
async def tool_search(pattern: str, directory: str = "."):
    from .tool_gateway import tool_search_files
    return await tool_search_files("user", pattern, directory)


@router.post("/tools/run")
async def tool_run(command: str, agent_id: str = "user"):
    from .tool_gateway import tool_run_command
    return await tool_run_command(agent_id, command)


@router.post("/tools/write")
async def tool_write(filepath: str, content: str,
                     approved: bool = False, agent_id: str = "user"):
    from .tool_gateway import tool_write_file
    return await tool_write_file(agent_id, filepath, content, approved)


@router.post("/release-gate")
async def trigger_release_gate():
    from .release_gate import run_release_gate
    import asyncio
    task = asyncio.create_task(run_release_gate("main"))
    return {"status": "started", "message": "Release gate pipeline running in main room"}


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


@router.get("/conversation/{channel}")
async def conversation_status(channel: str):
    from .agent_engine import get_conversation_status
    return get_conversation_status(channel)


@router.post("/conversation/{channel}/stop")
async def stop_conversation(channel: str):
    from .agent_engine import stop_conversation as _stop
    stopped = await _stop(channel)
    return {"stopped": stopped}


@router.patch("/tasks/{task_id}/status")
async def update_task_status(task_id: int, body: dict):
    new_status = body.get("status", "backlog")
    conn = await db.get_db()
    try:
        await conn.execute(
            "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (new_status, task_id))
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


@router.get("/claude/status")
async def claude_status():
    from .claude_adapter import is_available
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

        return {
            **dict(agent),
            "message_count": msg_count,
            "recent_messages": recent,
            "memories": memories,
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
