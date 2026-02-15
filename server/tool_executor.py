"""AI Office — Tool Executor. Parses tool calls from agent messages and runs them."""

import re
import logging
from typing import Optional
from .tool_gateway import tool_read_file, tool_search_files, tool_run_command, tool_write_file
from .database import insert_message, get_db, update_task_from_tag, get_agent
from .websocket import manager
from . import web_search

logger = logging.getLogger("ai-office.toolexec")

# Pattern: agents wrap tool calls in [TOOL:x] blocks
# [TOOL:read] server/main.py
# [TOOL:run] python -m pytest tests/
# [TOOL:search] *.py
# [TOOL:write] path/to/file
# ```content here```
# [TOOL:task] Task title | assigned_to | priority
TOOL_PATTERNS = [
    (r'\[TOOL:read\]\s*(.+)', 'read'),
    (r'\[TOOL:run\]\s*(.+)', 'run'),
    (r'\[TOOL:search\]\s*(.+)', 'search'),
    (r'\[TOOL:write\]\s*(\S+)\s*\n```[\w]*\n(.*?)```', 'write'),
    (r'\[TOOL:write\]\s*(\S+)', 'write_noblock'),  # Agent forgot content block
    (r'\[TOOL:task\]\s*(.+)', 'task'),
    (r'\[TOOL:web\]\s*(.+)', 'web'),
    (r'\[TOOL:fetch\]\s*(.+)', 'fetch'),
]

TASK_TAG_PATTERN = re.compile(
    r"\[TASK:(start|done|blocked)\]\s*#(\d+)(?:\s*[—\-]\s*(.+))?",
    re.IGNORECASE,
)

# Alt patterns for natural language
ALT_PATTERNS = [
    (r'(?:let me|I\'ll|going to) (?:read|look at|check|open)\s+[`"]?(\S+\.\w+)[`"]?', 'read'),
    (r'(?:let me|I\'ll|going to) (?:search|find|look for)\s+[`"]?(.+?)[`"]?(?:\s|$)', 'search'),
]


def parse_tool_calls(text: str) -> list[dict]:
    """Extract tool calls from agent message text."""
    calls = []
    seen_writes = set()

    # Check explicit [TOOL:x] patterns first
    for pattern, tool_type in TOOL_PATTERNS:
        if tool_type == 'write':
            matches = re.finditer(pattern, text, re.DOTALL)
            for m in matches:
                path = m.group(1).strip()
                seen_writes.add(path)
                calls.append({"type": "write", "path": path, "content": m.group(2)})
        elif tool_type == 'write_noblock':
            # Agent wrote [TOOL:write] path but no content block
            matches = re.finditer(pattern, text, re.MULTILINE)
            for m in matches:
                path = m.group(1).strip()
                if path not in seen_writes:  # Don't duplicate if already matched with content
                    calls.append({"type": "write_noblock", "path": path})
        elif tool_type == 'task':
            matches = re.finditer(pattern, text, re.MULTILINE)
            for m in matches:
                calls.append({"type": "task", "arg": m.group(1).strip()})
        else:
            matches = re.finditer(pattern, text, re.MULTILINE)
            for m in matches:
                calls.append({"type": tool_type, "arg": m.group(1).strip()})

    # If no explicit tool calls, check alt patterns
    if not calls:
        for pattern, tool_type in ALT_PATTERNS:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for m in matches:
                calls.append({"type": tool_type, "arg": m.group(1).strip()})

    for match in TASK_TAG_PATTERN.finditer(text):
        status = match.group(1).strip().lower()
        task_id = int(match.group(2))
        summary = (match.group(3) or "").strip()
        calls.append({
            "type": "task_tag",
            "status": status,
            "task_id": task_id,
            "summary": summary,
        })

    return calls


async def _create_task(agent_id: str, task_text: str) -> dict:
    """Create a task from agent tool call. Format: Title | assigned_to | priority"""
    parts = [p.strip() for p in task_text.split("|")]
    title = parts[0] if parts else task_text
    assigned = parts[1] if len(parts) > 1 else agent_id
    try:
        priority = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        priority = 0

    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO tasks (title, assigned_to, created_by, priority, status) VALUES (?, ?, ?, ?, 'backlog')",
            (title, assigned, agent_id, priority),
        )
        await db.commit()
        row = await db.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,))
        task = dict(await row.fetchone())
        return {"ok": True, "task": task}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        await db.close()


async def execute_tool_calls(agent_id: str, calls: list[dict], channel: str) -> list[dict]:
    """Execute tool calls and broadcast results to chat."""
    results = []
    agent = await get_agent(agent_id)
    role = (agent or {}).get("role", "").lower()
    can_research = agent_id in {"researcher", "director"} or "research" in role or "director" in role

    for call in calls:
        tool_type = call["type"]
        result = {}
        logger.info(f"[{agent_id}] executing {tool_type}: {call.get('arg', call.get('path', ''))[:80]}")

        try:
            if tool_type == "read":
                result = await tool_read_file(agent_id, call["arg"], channel=channel)
                if result["ok"]:
                    content = result["content"]
                    if len(content) > 2000:
                        content = content[:2000] + "\n... (truncated)"
                    msg = f"📄 **Read** `{call['arg']}`\n```\n{content}\n```"
                else:
                    msg = f"❌ **Read failed:** {result['error']}"

            elif tool_type == "run":
                result = await tool_run_command(agent_id, call["arg"], channel=channel)
                if result["ok"]:
                    stdout = result.get("stdout", "").strip()
                    if len(stdout) > 1500:
                        stdout = stdout[:1500] + "\n... (truncated)"
                    cwd_note = f" @ `{result['cwd']}`" if result.get("cwd") else ""
                    msg = f"⚡ **Ran `{call['arg']}`{cwd_note} (exit: {result['exit_code']})\n```\n{stdout}\n```"
                else:
                    err = result.get("error", result.get("stderr", "unknown"))
                    cwd_note = f" @ `{result['cwd']}`" if result.get("cwd") else ""
                    msg = f"❌ **Command failed:** `{call['arg']}`{cwd_note}\n```\n{err}\n```"

            elif tool_type == "search":
                result = await tool_search_files(agent_id, call["arg"], channel=channel)
                if result["ok"]:
                    matches = result["matches"][:20]
                    file_list = "\n".join(f"  {f}" for f in matches)
                    msg = f"🔍 **Found {len(result['matches'])} files matching** `{call['arg']}`\n```\n{file_list}\n```"
                else:
                    msg = f"❌ **Search failed:** {result['error']}"

            elif tool_type == "write":
                # Get diff preview first, then auto-write
                preview = await tool_write_file(
                    agent_id,
                    call["path"],
                    call["content"],
                    approved=False,
                    channel=channel,
                )
                result = await tool_write_file(
                    agent_id,
                    call["path"],
                    call["content"],
                    approved=True,
                    channel=channel,
                )
                if result.get("action") == "written" or result.get("ok"):
                    diff = preview.get("diff", "")
                    if len(diff) > 1500:
                        diff = diff[:1500] + "\n... (truncated)"
                    msg = f"✅ **Wrote `{call['path']}`** ({result.get('size', 0)} chars)\n```diff\n{diff}\n```"
                    path_lower = call["path"].replace("\\", "/").lower()
                    if path_lower.startswith("tools/") and path_lower.endswith(".py"):
                        compile_cmd = f"python -m py_compile {call['path']}"
                        compile_result = await tool_run_command(agent_id, compile_cmd, channel=channel)
                        if compile_result.get("ok"):
                            msg += "\n🧪 Tool script compile check: pass."
                        else:
                            err_text = compile_result.get("stderr") or compile_result.get("error") or "compile failed"
                            msg += f"\n⚠️ Tool script compile check failed:\n```text\n{err_text[:600]}\n```"
                else:
                    msg = f"❌ **Write failed:** {result.get('error', 'unknown')}"

            elif tool_type == "write_noblock":
                # Agent tried to write but didn't include content block
                msg = f"⚠️ **Write skipped for** `{call['path']}` — no content block provided. Use:\n```\n[TOOL:write] {call['path']}\n```\nfile content here\n```\n```"

            elif tool_type == "task":
                result = await _create_task(agent_id, call["arg"])
                if result["ok"]:
                    task = result["task"]
                    assigned = task.get("assigned_to", "unassigned")
                    msg = f"📋 **Task created:** {task['title']}\n  Status: `backlog` | Assigned: `{assigned}`"
                    # Also broadcast task event for TaskBoard
                    await manager.broadcast(channel, {"type": "task_created", "task": task})
                else:
                    msg = f"❌ **Task creation failed:** {result.get('error', 'unknown')}"
            elif tool_type == "task_tag":
                db_status = "in_progress" if call["status"] == "start" else call["status"]
                updated = await update_task_from_tag(
                    call["task_id"],
                    db_status,
                    agent_id,
                    call.get("summary"),
                )
                if updated:
                    summary_suffix = f" ({call.get('summary')})" if call.get("summary") else ""
                    msg = (
                        f"🧩 **Task update:** #{updated['id']} -> `{updated['status']}`"
                        f"{summary_suffix}"
                    )
                    await manager.broadcast(channel, {"type": "task_updated", "task": updated})
                    result = {"ok": True, "task": updated}
                else:
                    result = {"ok": False, "error": "Task not found or invalid status"}
                    msg = f"❌ **Task update failed:** {result['error']}"
            elif tool_type == "web":
                if not can_research:
                    result = {"ok": False, "error": "Web tools are restricted to researcher/director roles."}
                    msg = f"⛔ **Web search blocked:** {result['error']}"
                else:
                    result = await web_search.search_web(call["arg"], limit=6)
                    if result.get("ok"):
                        items = result.get("results", [])
                        if not items:
                            msg = "🔎 **Web search returned no results.**"
                        else:
                            lines = [f"🔎 **Web results** via `{result.get('provider')}`:"]
                            for item in items:
                                lines.append(f"- [{item['title']}]({item['url']}) — {item.get('snippet', '')}")
                            msg = "\n".join(lines)
                    else:
                        msg = f"❌ **Web search failed:** {result.get('error', 'unknown error')}"
            elif tool_type == "fetch":
                if not can_research:
                    result = {"ok": False, "error": "Fetch tool is restricted to researcher/director roles."}
                    msg = f"⛔ **Fetch blocked:** {result['error']}"
                else:
                    result = await web_search.fetch_url(call["arg"])
                    if result.get("ok"):
                        snippet = (result.get("content") or "").strip()
                        if len(snippet) > 1800:
                            snippet = snippet[:1800] + "\n... (truncated)"
                        msg = (
                            f"🌐 **Fetched** {result.get('url')} (status {result.get('status_code')})\n"
                            f"```text\n{snippet}\n```"
                        )
                    else:
                        msg = f"❌ **Fetch failed:** {result.get('error', 'unknown error')}"
            else:
                continue

            # Save and broadcast tool result
            saved = await insert_message(
                channel=channel,
                sender=agent_id,
                content=msg,
                msg_type="tool_result",
            )
            await manager.broadcast(channel, {"type": "chat", "message": saved})
            results.append({"type": tool_type, "result": result, "msg": msg})

        except Exception as e:
            logger.error(f"Tool exec error: {e}")
            err_msg = f"❌ **Tool error:** {e}"
            saved = await insert_message(channel=channel, sender=agent_id, content=err_msg, msg_type="tool_result")
            await manager.broadcast(channel, {"type": "chat", "message": saved})
            results.append({"type": tool_type, "error": str(e)})

    return results
