"""Autonomy and command policy engine for tool execution."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from . import database as db
from .project_manager import get_active_project

AUTONOMY_MODES = ("SAFE", "TRUSTED", "ELEVATED")
MUTATING_TOOLS = {"run", "write", "create-skill"}

SHELL_META_TOKENS = ("&&", "||", ";", "|", "`", "$(", ">", "<")
BLOCKED_PATTERNS = (
    r"\brm\s+-rf\b",
    r"\bdel\s+/[sS]\b",
    r"\bformat\s+\w+",
    r"\brmdir\b",
    r"\bshutdown\b",
    r"\btaskkill\b",
    r"\breg(?:edit)?\b",
    r"\bnet\s+user\b",
    r"\bpowershell\s+-enc(?:odedcommand)?\b",
    r"\bcurl\s+https?://",
    r"\bwget\s+https?://",
)

# Structured command templates by autonomy mode.
_SAFE_PATTERNS = (
    r"^python -m py_compile(\s+.+)?$",
    r"^python -m pytest(\s+.+)?$",
    r"^npm test(\s+.+)?$",
    r"^npm run (build|lint|test)(\s+.+)?$",
    r"^node -v$",
    r"^npm -v$",
    r"^where (node|npm|python|git)$",
    r"^git (status|log|diff)(\s+.+)?$",
    r"^dir(\s+.+)?$",
    r"^type(\s+.+)?$",
    r"^findstr(\s+.+)?$",
)

_TRUSTED_EXTRA_PATTERNS = (
    r"^python(\s+.+)?$",
    r"^pip install(\s+.+)?$",
    r"^npm (install|ci)(\s+.+)?$",
    r"^npm run (dev|start|build|lint|test)(\s+.+)?$",
    r"^mkdir(\s+.+)?$",
    r"^copy(\s+.+)?$",
    r"^move(\s+.+)?$",
    r"^uvicorn(\s+.+)?$",
    r"^flask run(\s+.+)?$",
)

_ELEVATED_EXTRA_PATTERNS = (
    r"^git add(\s+.+)?$",
    r"^git commit(\s+.+)?$",
    r"^git branch(\s+.+)?$",
    r"^git checkout(\s+.+)?$",
    r"^git merge(\s+.+)?$",
)


def normalize_mode(value: str | None) -> str:
    mode = (value or "SAFE").strip().upper()
    if mode not in AUTONOMY_MODES:
        return "SAFE"
    return mode


def _mode_patterns(mode: str) -> tuple[str, ...]:
    normalized = normalize_mode(mode)
    if normalized == "SAFE":
        return _SAFE_PATTERNS
    if normalized == "TRUSTED":
        return _SAFE_PATTERNS + _TRUSTED_EXTRA_PATTERNS
    return _SAFE_PATTERNS + _TRUSTED_EXTRA_PATTERNS + _ELEVATED_EXTRA_PATTERNS


def _is_command_shape_safe(command: str, *, structured: bool = False) -> tuple[bool, str]:
    normalized = (command or "").strip().lower()
    if not normalized:
        return False, "Command is empty."
    # Only treat shell tokens as dangerous when we're executing a legacy shell-string command.
    # For argv-based exec calls, these tokens are passed as literal arguments.
    if not structured and any(token in normalized for token in SHELL_META_TOKENS):
        return False, "Shell chaining/redirection is blocked."
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, normalized):
            return False, "Command matches a blocked security pattern."
    return True, ""


def _matches_mode_patterns(command: str, mode: str) -> bool:
    normalized = (command or "").strip().lower()
    for pattern in _mode_patterns(mode):
        if re.match(pattern, normalized):
            return True
    return False


def _inside_root(candidate: Path, root: Path) -> bool:
    try:
        candidate.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def validate_path_in_project(path_value: str, project_root: Path) -> tuple[bool, str]:
    path = Path(path_value)
    if not path.is_absolute():
        path = project_root / path
    if not _inside_root(path, project_root):
        return False, "Path escapes active project root."
    return True, ""


async def evaluate_tool_policy(
    *,
    channel: str,
    tool_type: str,
    agent_id: str,
    command: str | None = None,
    target_path: str | None = None,
    approved: bool = False,
    structured: bool = False,
) -> dict[str, Any]:
    active = await get_active_project(channel)
    project_name = active["project"]
    project_root = Path(active["path"]).resolve()
    branch_name = (active.get("branch") or "main").strip() or "main"
    mode = normalize_mode(await db.get_project_autonomy_mode(project_name))
    permission = await db.get_permission_policy(channel)
    permission_mode = (permission.get("mode") or "ask").strip().lower()
    permission_scopes = {str(item).strip().lower() for item in (permission.get("scopes") or []) if str(item).strip()}

    caller_auto_approved = agent_id in {"user", "system"}
    is_approved = bool(approved or caller_auto_approved)
    decision: dict[str, Any] = {
        "allowed": True,
        "requires_approval": False,
        "mode": mode,
        "project": project_name,
        "branch": branch_name,
        "project_root": str(project_root),
        "tool_type": tool_type,
        "reason": "allowed",
        "timeout_seconds": 45,
        "output_limit": 12000,
        "permission_mode": permission_mode,
        "permission_expires_at": permission.get("expires_at"),
        "permission_scopes": sorted(permission_scopes),
    }

    if tool_type in MUTATING_TOOLS:
        required_scope = "run" if tool_type == "run" else "write"
        if required_scope not in permission_scopes:
            if permission_mode == "locked":
                decision.update({
                    "allowed": False,
                    "requires_approval": False,
                    "reason": f"Channel is locked. `{required_scope}` is not permitted.",
                })
                return decision
            else:
                # Trigger approval flow instead of hard deny
                decision.update({
                    "allowed": False,
                    "requires_approval": True,
                    "reason": f"Agent wants to `{required_scope}`. Approve this action?",
                })
                return decision
        if permission_mode == "locked":
            decision.update({
                "allowed": False,
                "requires_approval": False,
                "reason": "Channel permission policy is locked for mutating tools.",
            })
            return decision
        if permission_mode == "trusted":
            is_approved = True
        elif permission_mode == "ask" and not is_approved:
            decision.update({
                "allowed": False,
                "requires_approval": True,
                "reason": "Channel permission policy requires explicit approval.",
            })
            return decision

    if target_path:
        path_ok, path_reason = validate_path_in_project(target_path, project_root)
        if not path_ok:
            decision.update({
                "allowed": False,
                "reason": path_reason,
                "requires_approval": False,
            })
            return decision

    if mode == "SAFE" and tool_type in MUTATING_TOOLS and not is_approved:
        decision.update({
            "allowed": False,
            "requires_approval": True,
            "reason": "SAFE mode requires approval for mutating tools.",
        })
        return decision

    if tool_type != "run":
        return decision

    command_text = (command or "").strip()
    shape_ok, shape_reason = _is_command_shape_safe(command_text, structured=structured)
    if not shape_ok:
        decision.update({
            "allowed": False,
            "reason": shape_reason,
            "requires_approval": False,
        })
        return decision

    if not _matches_mode_patterns(command_text, mode):
        decision.update({
            "allowed": False,
            "requires_approval": mode == "SAFE" and not is_approved,
            "reason": f"Command is not allowed in {mode} mode.",
        })
        return decision

    normalized = command_text.lower()
    if normalized.startswith(("pip install", "python -m pip install")) and "pip" not in permission_scopes:
        decision.update({
            "allowed": False,
            "requires_approval": False,
            "reason": "Channel permission scope `pip` is required for package installs.",
        })
        return decision
    if normalized.startswith(("git add", "git commit", "git branch", "git checkout", "git merge")) and "git" not in permission_scopes:
        decision.update({
            "allowed": False,
            "requires_approval": False,
            "reason": "Channel permission scope `git` is required for git mutation commands.",
        })
        return decision
    if normalized.startswith(("npm install", "npm ci", "pip install")):
        decision["timeout_seconds"] = 300 if mode in {"TRUSTED", "ELEVATED"} else 120
    elif normalized.startswith(("npm run build", "python -m pytest")):
        decision["timeout_seconds"] = 180
    elif normalized.startswith(("uvicorn", "flask run", "npm run dev", "npm run start")):
        decision["timeout_seconds"] = 3600
        decision["output_limit"] = 20000

    return decision
