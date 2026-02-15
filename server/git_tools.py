"""Safe git operations for project panel and commands."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .project_manager import APP_ROOT, get_project_root


def _runtime_env() -> dict:
    env = os.environ.copy()
    system_root = env.get("SystemRoot", r"C:\Windows")
    env["PATH"] = ";".join([
        str(Path(system_root) / "System32"),
        system_root,
        r"C:\Program Files\Git\cmd",
        env.get("PATH", ""),
    ])
    return env


def _project_root(name: str) -> Path:
    if name == "ai-office":
        return APP_ROOT
    return get_project_root(name)


def _run_git(name: str, args: list[str], timeout: int = 30) -> dict:
    root = _project_root(name)
    if not root.exists():
        return {"ok": False, "error": "Project not found.", "exit_code": -1}
    try:
        proc = subprocess.run(
            ["cmd", "/c", "git", *args],
            cwd=str(root),
            env=_runtime_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "project": name,
            "args": args,
            "stdout": (proc.stdout or "")[:12000],
            "stderr": (proc.stderr or "")[:6000],
            "exit_code": proc.returncode,
        }
    except Exception as exc:
        return {"ok": False, "project": name, "args": args, "stderr": str(exc), "exit_code": -1}


def status(name: str) -> dict:
    return _run_git(name, ["status", "--short"])


def log(name: str, count: int = 20) -> dict:
    return _run_git(name, ["log", f"--max-count={max(1, min(count, 50))}", "--oneline"])


def diff(name: str) -> dict:
    return _run_git(name, ["diff", "--"])


def commit(name: str, message: str) -> dict:
    msg = (message or "").strip()
    if not msg:
        return {"ok": False, "error": "Commit message is required.", "exit_code": -1}
    add_result = _run_git(name, ["add", "."])
    if not add_result.get("ok"):
        return add_result
    return _run_git(name, ["commit", "-m", msg], timeout=60)


def branch(name: str, branch_name: str) -> dict:
    value = (branch_name or "").strip()
    if not value:
        return {"ok": False, "error": "Branch name is required.", "exit_code": -1}
    if value.startswith("-") or " " in value:
        return {"ok": False, "error": "Invalid branch name.", "exit_code": -1}
    return _run_git(name, ["checkout", "-b", value], timeout=45)


def merge(name: str, branch_name: str) -> dict:
    value = (branch_name or "").strip()
    if not value or value.startswith("-") or " " in value:
        return {"ok": False, "error": "Invalid merge branch name.", "exit_code": -1}
    return _run_git(name, ["merge", value], timeout=60)


def current_branch(name: str) -> str:
    result = _run_git(name, ["rev-parse", "--abbrev-ref", "HEAD"], timeout=10)
    if not result.get("ok"):
        return ""
    return (result.get("stdout") or "").strip().splitlines()[0] if result.get("stdout") else ""
