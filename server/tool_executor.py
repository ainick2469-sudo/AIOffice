"""AI Office — Tool Executor. Parses tool calls from agent messages and runs them."""

import re
import logging
from typing import Optional
from .tool_gateway import tool_read_file, tool_search_files, tool_run_command, tool_write_file
from .database import insert_message, get_db
from .websocket import manager

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
]

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

    for call in calls:
        tool_type = call["type"]
        logger.info(f"[{agent_id}] executing {tool_type}: {call.get('arg', call.get('path', ''))[:80]}")

        try:
            if tool_type == "read":
                result = await tool_read_file(agent_id, call["arg"])
                if result["ok"]:
                    content = result["content"]
                    if len(content) > 2000:
                        content = content[:2000] + "\n... (truncated)"
                    msg = f"📄 **Read** `{call['arg']}`\n```\n{content}\n```"
                else:
                    msg = f"❌ **Read failed:** {result['error']}"

            elif tool_type == "run":
                result = await tool_run_command(agent_id, call["arg"])
                if result["ok"]:
                    stdout = result.get("stdout", "").strip()
                    if len(stdout) > 1500:
                        stdout = stdout[:1500] + "\n... (truncated)"
                    msg = f"⚡ **Ran `{call['arg']}`** (exit: {result['exit_code']})\n```\n{stdout}\n```"
                else:
                    err = result.get("error", result.get("stderr", "unknown"))
                    msg = f"❌ **Command failed:** `{call['arg']}`\n```\n{err}\n```"

            elif tool_type == "search":
                result = await tool_search_files(agent_id, call["arg"])
                if result["ok"]:
                    matches = result["matches"][:20]
                    file_list = "\n".join(f"  {f}" for f in matches)
                    msg = f"🔍 **Found {len(result['matches'])} files matching** `{call['arg']}`\n```\n{file_list}\n```"
                else:
                    msg = f"❌ **Search failed:** {result['error']}"

            elif tool_type == "write":
                # Get diff preview first, then auto-write
                preview = await tool_write_file(agent_id, call["path"], call["content"], approved=False)
                result = await tool_write_file(agent_id, call["path"], call["content"], approved=True)
                if result.get("action") == "written" or result.get("ok"):
                    diff = preview.get("diff", "")
                    if len(diff) > 1500:
                        diff = diff[:1500] + "\n... (truncated)"
                    msg = f"✅ **Wrote `{call['path']}`** ({result.get('size', 0)} chars)\n```diff\n{diff}\n```"
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
            results.append({"type": tool_type, "result": result if 'result' in dir() else {}, "msg": msg})

        except Exception as e:
            logger.error(f"Tool exec error: {e}")
            err_msg = f"❌ **Tool error:** {e}"
            saved = await insert_message(channel=channel, sender=agent_id, content=err_msg, msg_type="tool_result")
            await manager.broadcast(channel, {"type": "chat", "message": saved})
            results.append({"type": tool_type, "error": str(e)})

    return results
