"""AI Office — Tool Gateway. Controlled file/command execution with audit."""

import asyncio
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import database as db_api
from . import runtime_manager
from .database import get_db
from .observability import emit_console_event
from .policy import evaluate_tool_policy, find_unquoted_shell_meta
from .project_manager import APP_ROOT, get_active_project, get_sandbox_root
from .runtime_config import build_runtime_env
from .websocket import manager

logger = logging.getLogger("ai-office.tools")

# Default sandbox root — tools cannot escape this or active project root.
SANDBOX = APP_ROOT

# Allowed file read extensions
READABLE_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".jsonl",
    ".md", ".txt", ".css", ".html", ".toml", ".yaml", ".yml",
    ".cfg", ".ini", ".sql", ".sh", ".bat", ".ps1", ".csv",
}

_approval_waiters: dict[str, asyncio.Future] = {}


def _is_safe_path(filepath: str, sandbox: Path) -> bool:
    """Check path is within sandbox."""
    try:
        p = Path(filepath)
        if not p.is_absolute():
            p = sandbox / p
        resolved = p.resolve()
        return str(resolved).startswith(str(sandbox.resolve()))
    except Exception:
        return False


def _resolve_path(filepath: str, sandbox: Path) -> Path:
    """Resolve a filepath relative to sandbox."""
    p = Path(filepath)
    if not p.is_absolute():
        p = sandbox / p
    return p.resolve()


def canonicalize_tool_path(raw: str) -> str:
    """Normalize tool file paths to avoid accidental wrong roots (e.g. `@apps/...`).

    Rules:
    - Strip a leading `@` (only at the beginning).
    - Strip leading `./` or `.\\`.
    - Strip leading slashes/backslashes to keep the path relative.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    if text.startswith("@"):
        text = text[1:]
    if text.startswith("./") or text.startswith(".\\"):
        text = text[2:]
    while text.startswith(("/", "\\")):
        text = text[1:]
    return text


def _parse_command_target(command: str, sandbox: Path) -> tuple[str, Path]:
    """Optional command target syntax: '@subdir actual command'."""
    raw = command.strip()
    target = sandbox

    match = re.match(r"^@([A-Za-z0-9_./\\-]+)\s+(.+)$", raw)
    if match:
        rel_dir = match.group(1).replace("\\", "/")
        raw = match.group(2).strip()
        target = (sandbox / rel_dir).resolve()
        if not str(target).startswith(str(sandbox.resolve())):
            raise ValueError(f"Target directory outside sandbox: {rel_dir}")
        if not target.exists() or not target.is_dir():
            raise ValueError(f"Target directory does not exist: {rel_dir}")

    return raw, target


def _command_timeout_seconds(command: str) -> int:
    """Longer timeout for package installation/scaffolding."""
    cmd = command.lower().strip()
    if (
        cmd.startswith("npm install")
        or cmd.startswith("npm ci")
        or cmd.startswith("npx --yes create-vite@latest")
        or cmd.startswith("npx create-vite@latest")
        or cmd.startswith("npx --yes create-next-app@latest")
        or cmd.startswith("npx create-next-app@latest")
        or cmd.startswith("npx create-react-app")
    ):
        return 300
    if cmd.startswith("npm run build") or cmd.startswith("npm --prefix "):
        return 120
    return 45


async def _audit_log(agent_id: str, tool_type: str, command: str,
                     args: Optional[str] = None, output: Optional[str] = None,
                     exit_code: Optional[int] = None, approved_by: str = "system",
                     channel: Optional[str] = None, task_id: Optional[str] = None,
                     approval_request_id: Optional[str] = None, policy_mode: Optional[str] = None,
                     reason: Optional[str] = None):
    """Write to audit log in DB."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO tool_logs (
                   agent_id, tool_type, command, args, output, exit_code, approved_by,
                   channel, task_id, approval_request_id, policy_mode, reason
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (agent_id, tool_type, command,
             json.dumps(args) if args else None,
             output[:2000] if output else None,
             exit_code, approved_by, channel, task_id, approval_request_id, policy_mode, reason),
        )
        await db.commit()
    finally:
        await db.close()


def _risk_level(tool_type: str) -> str:
    if tool_type == "run":
        return "high"
    if tool_type == "write":
        return "medium"
    return "low"


def _approval_ttl_seconds() -> int:
    raw = (os.environ.get("AI_OFFICE_APPROVAL_TTL_SECONDS") or "").strip()
    try:
        value = int(raw) if raw else 600
    except Exception:
        value = 600
    return max(1, min(value, 24 * 60 * 60))


async def _create_approval_request(
    *,
    channel: str,
    agent_id: str,
    tool_type: str,
    command: str,
    args: Optional[dict] = None,
    policy: Optional[dict] = None,
    preview: Optional[str] = None,
    task_id: Optional[str] = None,
) -> dict:
    request_id = uuid.uuid4().hex[:16]
    active = await get_active_project(channel)
    project_name = active.get("project") or "ai-office"
    branch_name = (active.get("branch") or "main").strip() or "main"
    now = datetime.now(timezone.utc).replace(microsecond=0)
    created_at = now.isoformat().replace("+00:00", "Z")
    expires_at = (now + timedelta(seconds=_approval_ttl_seconds())).isoformat().replace("+00:00", "Z")
    payload = {
        "id": request_id,
        "channel": channel,
        "project_name": project_name,
        "branch": branch_name,
        "agent_id": agent_id,
        "tool_type": tool_type,
        "command": command,
        "args": args or {},
        "preview": preview or "",
        "risk_level": _risk_level(tool_type),
        "policy_mode": (policy or {}).get("permission_mode", "ask"),
        "missing_scope": (policy or {}).get("missing_scope"),
        "created_at": created_at,
        "expires_at": expires_at,
        "task_id": task_id,
    }
    await db_api.create_approval_request(
        request_id=request_id,
        channel=channel,
        task_id=task_id,
        agent_id=agent_id,
        tool_type=tool_type,
        payload=payload,
        risk_level=payload["risk_level"],
        project_name=project_name,
        branch=branch_name,
        expires_at=expires_at,
    )
    loop = asyncio.get_running_loop()
    _approval_waiters[request_id] = loop.create_future()
    await manager.broadcast(channel, {"type": "approval_request", "request": payload})
    await emit_console_event(
        channel=channel,
        event_type="approval_request",
        source="tool_gateway",
        message=f"{tool_type} request awaiting approval: {command[:120]}",
        severity="warning",
        data={"request_id": request_id, "agent_id": agent_id, "tool_type": tool_type},
    )
    return payload


async def wait_for_approval_response(request_id: str, timeout_seconds: int = 120) -> Optional[bool]:
    existing = await db_api.get_approval_request(request_id)
    if existing and existing.get("status") == "approved":
        return True
    if existing and existing.get("status") == "denied":
        return False

    fut = _approval_waiters.get(request_id)
    if fut is None:
        return None
    try:
        approved = await asyncio.wait_for(fut, timeout=timeout_seconds)
        return bool(approved)
    except asyncio.TimeoutError:
        return None
    finally:
        _approval_waiters.pop(request_id, None)


async def resolve_approval_response(request_id: str, approved: bool, decided_by: str = "user") -> Optional[dict]:
    resolved = await db_api.resolve_approval_request(
        request_id,
        approved=approved,
        decided_by=decided_by,
    )
    fut = _approval_waiters.pop(request_id, None)
    if fut and not fut.done():
        fut.set_result(bool(approved))
    return resolved


# ── Tool Functions ─────────────────────────────────────────

async def tool_read_file(agent_id: str, filepath: str, channel: str = "main") -> dict:
    """Read a file within the sandbox."""
    raw_path = filepath
    filepath = canonicalize_tool_path(filepath)
    policy = await evaluate_tool_policy(
        channel=channel,
        tool_type="read",
        agent_id=agent_id,
        target_path=filepath,
        approved=True,
    )
    if filepath != (raw_path or "").strip():
        await emit_console_event(
            channel=channel,
            event_type="tool_path_canonicalized",
            source="tool_gateway",
            message=f'read path canonicalized: "{raw_path}" -> "{filepath}"',
            project_name=policy.get("project"),
            data={"tool_type": "read", "from": raw_path, "to": filepath},
        )
    if not policy.get("allowed"):
        return {"ok": False, "error": policy.get("reason", "Policy denied read."), "policy": policy}

    sandbox = await get_sandbox_root(channel)
    if not _is_safe_path(filepath, sandbox):
        result = {"ok": False, "error": f"Path outside sandbox: {filepath}"}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=result["error"], exit_code=-1)
        return result

    resolved = _resolve_path(filepath, sandbox)

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
        return {
            "ok": True,
            "content": content,
            "path": str(resolved),
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }
    except Exception as e:
        result = {"ok": False, "error": str(e)}
        await _audit_log(agent_id, "read", f"read_file: {filepath}",
                         output=str(e), exit_code=-1)
        return result


async def tool_search_files(agent_id: str, pattern: str, directory: str = ".", channel: str = "main") -> dict:
    """Search for files matching a glob pattern within sandbox."""
    raw_dir = directory
    directory = canonicalize_tool_path(directory) or "."
    policy = await evaluate_tool_policy(
        channel=channel,
        tool_type="read",
        agent_id=agent_id,
        target_path=directory,
        approved=True,
    )
    if directory != (raw_dir or "").strip():
        await emit_console_event(
            channel=channel,
            event_type="tool_path_canonicalized",
            source="tool_gateway",
            message=f'search directory canonicalized: "{raw_dir}" -> "{directory}"',
            project_name=policy.get("project"),
            data={"tool_type": "search", "from": raw_dir, "to": directory},
        )
    if not policy.get("allowed"):
        return {"ok": False, "error": policy.get("reason", "Policy denied search."), "policy": policy}

    sandbox = await get_sandbox_root(channel)
    base = sandbox / directory if not Path(directory).is_absolute() else Path(directory)
    if not str(base.resolve()).startswith(str(sandbox.resolve())):
        return {"ok": False, "error": "Directory outside sandbox"}

    try:
        matches = []
        # Try the pattern directly first
        for p in base.rglob(pattern):
            if p.is_file() and len(matches) < 50:
                matches.append(str(p.relative_to(sandbox)))

        # If no matches and pattern has a directory component, try just the filename
        if not matches and "/" in pattern:
            filename = pattern.split("/")[-1]
            if filename:
                for p in base.rglob(filename):
                    if p.is_file() and len(matches) < 50:
                        matches.append(str(p.relative_to(sandbox)))

        await _audit_log(agent_id, "read", f"search: {pattern} in {directory}",
                         output=f"{len(matches)} matches", exit_code=0)
        return {
            "ok": True,
            "matches": matches,
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def tool_run_command(
    agent_id: str,
    command: str = "",
    channel: str = "main",
    approved: bool = False,
    *,
    cmd: Optional[list[str]] = None,
    cwd: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
    timeout: Optional[int] = None,
) -> dict:
    """Run an allow-listed command within the sandbox.

    - Legacy path: `command` shell-ish string (kept for backward compatibility).
    - Preferred path: argv execution via `cmd=[...]` using `create_subprocess_exec`.
    """

    def _needs_cmd_wrapper(argv0: str) -> bool:
        lower = (argv0 or "").strip().lower()
        return lower in {"dir", "type", "copy", "move", "mkdir"}

    sandbox = await get_sandbox_root(channel)
    structured = bool(cmd)
    target_dir = sandbox

    if cmd:
        argv = [str(item) for item in cmd if str(item).strip()]
        if not argv:
            result = {"ok": False, "error": "cmd is empty"}
            await _audit_log(agent_id, "run", "(argv)",
                             output=result["error"], exit_code=-1, channel=channel)
            return result
        if cwd:
            candidate = Path(cwd)
            if not candidate.is_absolute():
                candidate = sandbox / candidate
            resolved = candidate.resolve()
            if not str(resolved).startswith(str(sandbox.resolve())):
                return {"ok": False, "error": "cwd escapes sandbox", "channel": channel}
            if resolved.exists() and not resolved.is_dir():
                return {"ok": False, "error": "cwd is not a directory", "channel": channel}
            target_dir = resolved
        normalized_command = " ".join(argv)
    else:
        try:
            normalized_command, target_dir = _parse_command_target(command, sandbox)
        except ValueError as e:
            result = {"ok": False, "error": str(e)}
            await _audit_log(agent_id, "run", command,
                             output=result["error"], exit_code=-1, channel=channel)
            return result
        try:
            argv = shlex.split(normalized_command, posix=False)
        except Exception:
            argv = normalized_command.split()
        if not argv:
            result = {"ok": False, "error": "Command parsed to empty argv"}
            await _audit_log(agent_id, "run", normalized_command,
                             output=result["error"], exit_code=-1, channel=channel)
            return result
        shell_meta = find_unquoted_shell_meta(normalized_command)
        if shell_meta:
            result = {
                "ok": False,
                "error": (
                    f"Shell operator `{shell_meta}` is blocked when unquoted. "
                    "Use structured argv `[TOOL:run]{\"cmd\":[...]}` for literal arguments."
                ),
            }
            await _audit_log(
                agent_id,
                "run",
                normalized_command,
                output=result["error"],
                exit_code=-1,
                channel=channel,
            )
            return result

    policy = await evaluate_tool_policy(
        channel=channel,
        tool_type="run",
        agent_id=agent_id,
        command=normalized_command,
        target_path=str(target_dir),
        approved=approved,
        structured=structured,
    )
    if not policy.get("allowed"):
        if policy.get("requires_approval"):
            request = await _create_approval_request(
                channel=channel,
                agent_id=agent_id,
                tool_type="run",
                command=normalized_command,
                args={"cwd": str(target_dir), "cmd": argv},
                policy=policy,
            )
            await _audit_log(
                agent_id,
                "run",
                normalized_command,
                output="Awaiting approval response.",
                exit_code=0,
                approved_by="pending",
                channel=channel,
                approval_request_id=request["id"],
                policy_mode=policy.get("permission_mode"),
                reason=policy.get("reason"),
            )
            return {
                "ok": False,
                "status": "needs_approval",
                "request": request,
                "policy": policy,
                "channel": channel,
                "project": policy.get("project"),
                "branch": policy.get("branch", "main"),
            }
        result = {"ok": False, "error": policy.get("reason", "Policy denied command."), "policy": policy}
        await _audit_log(
            agent_id,
            "run",
            normalized_command,
            output=result["error"],
            exit_code=-1,
            channel=channel,
            policy_mode=policy.get("permission_mode"),
            reason=policy.get("reason"),
        )
        await emit_console_event(
            channel=channel,
            event_type="policy_block",
            source="tool_gateway",
            message=result["error"],
            severity="warning",
            data={
                "agent_id": agent_id,
                "command": normalized_command,
                "project": policy.get("project"),
                "branch": policy.get("branch", "main"),
            },
        )
        return result

    timeout_seconds = int(timeout or policy.get("timeout_seconds") or _command_timeout_seconds(normalized_command))

    try:
        # Rewrite argv for per-workspace venv where applicable.
        argv = await runtime_manager.rewrite_argv_for_workspace(channel, argv)
        if _needs_cmd_wrapper(argv[0]):
            command_line = subprocess.list2cmdline(argv)
            if command_line.startswith('"'):
                command_line = f'"{command_line}"'
            argv = ["cmd", "/d", "/s", "/c", command_line]

        base_env = os.environ.copy()
        if env:
            for k, v in dict(env).items():
                if k and v is not None:
                    base_env[str(k)] = str(v)
        run_env = build_runtime_env(base_env)

        if argv:
            head = (argv[0] or "").strip().lower()
            if head in {"npm", "npx"}:
                node_exe = shutil.which("node", path=run_env.get("PATH")) or "node"
                node_dir = Path(node_exe).resolve().parent if Path(node_exe).exists() else None
                if node_dir:
                    cli_name = "npm-cli.js" if head == "npm" else "npx-cli.js"
                    cli_path = (node_dir / "node_modules" / "npm" / "bin" / cli_name).resolve()
                    if cli_path.exists():
                        argv = [node_exe, str(cli_path)] + list(argv[1:])

        if argv and (argv[0] or "").strip().lower() not in {"cmd", "cmd.exe"}:
            resolved = shutil.which(str(argv[0]), path=run_env.get("PATH"))
            if resolved and resolved.lower().endswith((".cmd", ".bat")):
                command_line = subprocess.list2cmdline([resolved] + list(argv[1:]))
                if command_line.startswith('"'):
                    command_line = f'"{command_line}"'
                argv = ["cmd", "/d", "/s", "/c", command_line]

        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(target_dir),
            env=run_env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)

        output_limit = int(policy.get("output_limit") or 12000)
        stdout_str = stdout.decode("utf-8", errors="replace")[:output_limit]
        stderr_str = stderr.decode("utf-8", errors="replace")[:output_limit]
        exit_code = proc.returncode

        output = stdout_str
        if stderr_str:
            output += f"\nSTDERR:\n{stderr_str}"

        await _audit_log(
            agent_id,
            "run",
            f"{normalized_command} @ {target_dir}",
            args={"cmd": argv, "cwd": str(target_dir)},
            output=output,
            exit_code=exit_code,
            approved_by=("trusted_session" if policy.get("permission_mode") == "trusted" else "user"),
            channel=channel,
            policy_mode=policy.get("permission_mode"),
            reason=policy.get("reason"),
        )

        return {
            "ok": exit_code == 0,
            "cmd": argv,
            "cwd": str(target_dir),
            "stdout": stdout_str,
            "stderr": stderr_str,
            "exit_code": exit_code,
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }
    except asyncio.TimeoutError:
        await _audit_log(
            agent_id,
            "run",
            f"{normalized_command} @ {target_dir}",
            output=f"TIMEOUT after {timeout_seconds}s",
            exit_code=-1,
            channel=channel,
            policy_mode=policy.get("permission_mode"),
            reason=policy.get("reason"),
        )
        return {
            "ok": False,
            "error": f"Command timed out ({timeout_seconds}s)",
            "cwd": str(target_dir),
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }
    except Exception as e:
        await _audit_log(
            agent_id,
            "run",
            f"{normalized_command} @ {target_dir}",
            output=str(e),
            exit_code=-1,
            channel=channel,
            policy_mode=policy.get("permission_mode"),
            reason=policy.get("reason"),
        )
        return {
            "ok": False,
            "error": str(e),
            "cwd": str(target_dir),
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }


async def tool_write_file(
    agent_id: str,
    filepath: str,
    content: str,
    approved: bool = False,
    channel: str = "main",
) -> dict:
    """Write a file with diff preview. Auto-approved for sandboxed writes."""
    raw_path = filepath
    filepath = canonicalize_tool_path(filepath)
    policy = await evaluate_tool_policy(
        channel=channel,
        tool_type="write",
        agent_id=agent_id,
        target_path=filepath,
        approved=approved,
    )
    if filepath != (raw_path or "").strip():
        await emit_console_event(
            channel=channel,
            event_type="tool_path_canonicalized",
            source="tool_gateway",
            message=f'write path canonicalized: "{raw_path}" -> "{filepath}"',
            project_name=policy.get("project"),
            data={"tool_type": "write", "from": raw_path, "to": filepath},
        )
    if not policy.get("allowed"):
        if policy.get("requires_approval"):
            # Build a preview so the approval modal can show a concrete diff.
            sandbox = await get_sandbox_root(channel)
            resolved = _resolve_path(filepath, sandbox)
            old_content = ""
            if resolved.exists():
                try:
                    old_content = resolved.read_text(encoding="utf-8")
                except Exception:
                    old_content = ""
            diff = _generate_diff(old_content, content, str(resolved))
            request = await _create_approval_request(
                channel=channel,
                agent_id=agent_id,
                tool_type="write",
                command=f"write {filepath}",
                args={"path": filepath, "size": len(content)},
                policy=policy,
                preview=diff[:6000],
            )
            await _audit_log(
                agent_id,
                "write",
                f"write_file: {filepath}",
                output="Awaiting approval response.",
                exit_code=0,
                approved_by="pending",
                channel=channel,
                approval_request_id=request["id"],
                policy_mode=policy.get("permission_mode"),
                reason=policy.get("reason"),
            )
            return {
                "ok": False,
                "status": "needs_approval",
                "request": request,
                "diff": diff,
                "path": str(resolved),
                "size": len(content),
                "policy": policy,
                "channel": channel,
                "project": policy.get("project"),
                "branch": policy.get("branch", "main"),
            }
        return {"ok": False, "error": policy.get("reason", "Policy denied write."), "policy": policy}

    sandbox = await get_sandbox_root(channel)
    if not _is_safe_path(filepath, sandbox):
        return {"ok": False, "error": f"Path outside sandbox: {filepath}"}

    resolved = _resolve_path(filepath, sandbox)
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

    should_write_now = bool(approved or policy.get("permission_mode") == "trusted" or agent_id in {"user", "system"})
    if not should_write_now:
        request = await _create_approval_request(
            channel=channel,
            agent_id=agent_id,
            tool_type="write",
            command=f"write {filepath}",
            args={"path": filepath, "size": len(content)},
            policy=policy,
            preview=diff[:6000],
        )
        await _audit_log(
            agent_id,
            "write",
            f"write_file: {filepath}",
            output="Awaiting approval response.",
            exit_code=0,
            approved_by="pending",
            channel=channel,
            approval_request_id=request["id"],
            policy_mode=policy.get("permission_mode"),
            reason=policy.get("reason"),
        )
        return {
            "ok": False,
            "status": "needs_approval",
            "request": request,
            "diff": diff,
            "path": str(resolved),
            "size": len(content),
            "policy": policy,
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
        }

    # Actually write
    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        await _audit_log(agent_id, "write", f"write_file: {filepath}",
                         output=f"Written {len(content)} chars", exit_code=0,
                         approved_by=("trusted_session" if policy.get("permission_mode") == "trusted" else "user"),
                         channel=channel, policy_mode=policy.get("permission_mode"),
                         reason=policy.get("reason"))
        return {
            "ok": True,
            "action": "written",
            "path": str(resolved),
            "size": len(content),
            "channel": channel,
            "project": policy.get("project"),
            "branch": policy.get("branch", "main"),
            "policy": policy,
        }
    except Exception as e:
        await _audit_log(agent_id, "write", f"write_file: {filepath}",
                         output=str(e), exit_code=-1, channel=channel,
                         policy_mode=policy.get("permission_mode"), reason=policy.get("reason"))
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
