"""AI Office — Tool Gateway. Controlled file/command execution with audit."""

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from .database import get_db

logger = logging.getLogger("ai-office.tools")

# Sandbox root — tools cannot escape this
SANDBOX = Path("C:/AI_WORKSPACE/ai-office")

# Allow-listed commands (prefix match)
ALLOWED_COMMANDS = [
    "python -m pytest",
    "python -m py_compile",
    "python -c",
    "npm test",
    "npm run lint",
    "npm run build",
    "npx vite build",
    "dir ",
    "type ",
    "findstr ",
    "git status",
    "git log",
    "git diff",
    "ollama list",
]

# Blocked patterns (never allow)
BLOCKED_PATTERNS = [
    r"rm\s+-rf",
    r"del\s+/[sS]",
    r"format\s+",
    r"rmdir",
    r"reg\s+(add|delete)",
    r"regedit",
    r"net\s+user",
    r"shutdown",
    r"taskkill",
    r"\.env",
    r"password",
    r"secret",
    r"token",
    r"api.key",
]

# Allowed file read extensions
READABLE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".jsonl",
    ".md", ".txt", ".css", ".html", ".toml", ".yaml", ".yml",
    ".cfg", ".ini", ".sql", ".sh", ".bat", ".ps1", ".csv",
}


def _is_safe_path(filepath: str) -> bool:
    """Check path is within sandbox."""
    try:
        p = Path(filepath)
        if not p.is_absolute():
            p = SANDBOX / p
        resolved = p.resolve()
        return str(resolved).startswith(str(SANDBOX.resolve()))
    except Exception:
        return False


def _resolve_path(filepath: str) -> Path:
    """Resolve a filepath relative to sandbox."""
    p = Path(filepath)
    if not p.is_absolute():
        p = SANDBOX / p
    return p.resolve()


def _is_command_allowed(command: str) -> bool:
    """Check command against allowlist and blocklist."""
    cmd_lower = command.lower().strip()

    # Check blocklist first
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, cmd_lower):
            return False

    # Check allowlist
    for allowed in ALLOWED_COMMANDS:
        if cmd_lower.startswith(allowed.lower()):
            return True

    return False


async def _audit_log(agent_id: str, tool_type: str, command: str,
                     args: Optional[str] = None, output: Optional[str] = None,
                     exit_code: Optional[int] = None, approved_by: str = "system"):
    """Write to audit log in DB."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO tool_logs (agent_id, tool_type, command, args, output, exit_code, approved_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (agent_id, tool_type, command,
             json.dumps(args) if args else None,
             output[:2000] if output else None,
             exit_code, approved_by),
        )
        await db.commit()
    finally:
        await db.close()


# ── Tool Functions ─────────────────────────────────────────

async def tool_read_file(agent_id: str, filepath: str) -> dict:
    """Read a file within the sandbox."""
    if not _is_safe_path(filepath):
        result = {"ok": False, "error": f"Path outside sandbox: {filepath}"}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=result["error"], exit_code=-1)
        return result

    resolved = _resolve_path(filepath)

    if not resolved.exists():
        result = {"ok": False, "error": f"File not found: {filepath}"}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=result["error"], exit_code=-1)
        return result

    ext = resolved.suffix.lower()
    if ext not in READABLE_EXTENSIONS:
        result = {"ok": False, "error": f"Extension not readable: {ext}"}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=result["error"], exit_code=-1)
        return result

    try:
        content = resolved.read_text(encoding="utf-8")
        # Truncate large files
        if len(content) > 10000:
            content = content[:10000] + f"\n... [truncated, {len(content)} chars total]"

        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=f"{len(content)} chars", exit_code=0)
        return {"ok": True, "content": content, "path": str(resolved)}
    except Exception as e:
        result = {"ok": False, "error": str(e)}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=str(e), exit_code=-1)
        return result


async def tool_search_files(agent_id: str, pattern: str, directory: str = ".") -> dict:
    """Search for files matching a glob pattern within sandbox."""
    base = SANDBOX / directory if not Path(directory).is_absolute() else Path(directory)
    if not str(base.resolve()).startswith(str(SANDBOX.resolve())):
        return {"ok": False, "error": "Directory outside sandbox"}

    try:
        matches = []
        # Try the pattern directly first
        for p in base.rglob(pattern):
            if p.is_file() and len(matches) < 50:
                matches.append(str(p.relative_to(SANDBOX)))

        # If no matches and pattern has a directory component, try just the filename
        if not matches and "/" in pattern:
            filename = pattern.split("/")[-1]
            if filename:
                for p in base.rglob(filename):
                    if p.is_file() and len(matches) < 50:
                        matches.append(str(p.relative_to(SANDBOX)))

        await _audit_log(agent_id, "read", f"search: {pattern} in {directory}",
                         output=f"{len(matches)} matches", exit_code=0)
        return {"ok": True, "matches": matches}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def tool_run_command(agent_id: str, command: str) -> dict:
    """Run an allow-listed command within the sandbox."""
    if not _is_command_allowed(command):
        result = {"ok": False, "error": f"Command not in allowlist: {command}"}
        await _audit_log(agent_id, "run", command,
                         output=result["error"], exit_code=-1)
        return result

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            cwd=str(SANDBOX),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        stdout_str = stdout.decode("utf-8", errors="replace")[:5000]
        stderr_str = stderr.decode("utf-8", errors="replace")[:2000]
        exit_code = proc.returncode

        output = stdout_str
        if stderr_str:
            output += f"\nSTDERR:\n{stderr_str}"

        await _audit_log(agent_id, "run", command,
                         output=output, exit_code=exit_code)

        return {
            "ok": exit_code == 0,
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": exit_code,
        }
    except asyncio.TimeoutError:
        await _audit_log(agent_id, "run", command,
                         output="TIMEOUT after 30s", exit_code=-1)
        return {"ok": False, "error": "Command timed out (30s)"}
    except Exception as e:
        await _audit_log(agent_id, "run", command,
                         output=str(e), exit_code=-1)
        return {"ok": False, "error": str(e)}


async def tool_write_file(agent_id: str, filepath: str, content: str,
                          approved: bool = False) -> dict:
    """Write a file with diff preview. Auto-approved for sandboxed writes."""
    if not _is_safe_path(filepath):
        return {"ok": False, "error": f"Path outside sandbox: {filepath}"}

    resolved = _resolve_path(filepath)
    ext = resolved.suffix.lower()
    if ext not in READABLE_EXTENSIONS:
        return {"ok": False, "error": f"Cannot write to extension: {ext}"}

    # Generate diff preview
    old_content = ""
    if resolved.exists():
        try:
            old_content = resolved.read_text(encoding="utf-8")
        except Exception:
            pass

    diff = _generate_diff(old_content, content, str(resolved))

    if not approved:
        await _audit_log(agent_id, "write", f"write_file (PREVIEW): {filepath}",
                         output=f"Diff preview generated, {len(content)} chars", exit_code=0)
        return {
            "ok": True,
            "action": "preview",
            "diff": diff,
            "path": str(resolved),
            "size": len(content),
            "requires_approval": True,
        }

    # Actually write
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        await _audit_log(agent_id, "write", f"write_file: {filepath}",
                         output=f"Written {len(content)} chars", exit_code=0,
                         approved_by="user")
        return {"ok": True, "action": "written", "path": str(resolved), "size": len(content)}
    except Exception as e:
        await _audit_log(agent_id, "write", f"write_file: {filepath}",
                         output=str(e), exit_code=-1)
        return {"ok": False, "error": str(e)}


def _generate_diff(old: str, new: str, filename: str) -> str:
    """Generate a simple unified diff."""
    import difflib
    old_lines = old.splitlines(keepends=True)
    new_lines = new.splitlines(keepends=True)
    diff = difflib.unified_diff(old_lines, new_lines,
                                 fromfile=f"a/{filename}",
                                 tofile=f"b/{filename}")
    return "".join(diff) or "(no changes)"
