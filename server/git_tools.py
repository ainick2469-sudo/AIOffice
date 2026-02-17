"""Safe git operations for project panel and commands."""

from __future__ import annotations

import os
import subprocess
import time
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
        return {"ok": False, "error": "Project not found.", "exit_code": -1, "project": name, "args": args}

    started = time.time()
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
            "duration_ms": int((time.time() - started) * 1000),
        }
    except Exception as exc:
        return {
            "ok": False,
            "project": name,
            "args": args,
            "stderr": str(exc),
            "exit_code": -1,
            "duration_ms": int((time.time() - started) * 1000),
        }


def _is_branch_name_safe(value: str) -> bool:
    name = (value or "").strip()
    if not name:
        return False
    if any(token in name for token in (" ", "\t", "\n", "..", "~", "^", ":", "\\", "@{")):
        return False
    if name.startswith(("-", "/", ".")) or name.endswith(("/", ".")):
        return False
    return True


def _working_tree_dirty(name: str) -> tuple[bool, dict]:
    status_result = status(name)
    if not status_result.get("ok"):
        return False, status_result
    dirty = bool((status_result.get("stdout") or "").strip())
    return dirty, status_result


def _extract_conflicts(name: str) -> list[str]:
    conflict_result = _run_git(name, ["diff", "--name-only", "--diff-filter=U"], timeout=15)
    raw = conflict_result.get("stdout", "")
    conflicts = [line.strip() for line in raw.splitlines() if line.strip()]
    return conflicts


def status(name: str) -> dict:
    return _run_git(name, ["status", "--short"])


def log(name: str, count: int = 20) -> dict:
    return _run_git(name, ["log", f"--max-count={max(1, min(count, 50))}", "--oneline"])


def diff(name: str) -> dict:
    return _run_git(name, ["diff", "--"])


def commit(name: str, message: str) -> dict:
    msg = (message or "").strip()
    if not msg:
        return {"ok": False, "error": "Commit message is required.", "exit_code": -1, "project": name}
    add_result = _run_git(name, ["add", "."])
    if not add_result.get("ok"):
        return add_result
    return _run_git(name, ["commit", "-m", msg], timeout=60)


def branch(name: str, branch_name: str) -> dict:
    value = (branch_name or "").strip()
    if not _is_branch_name_safe(value):
        return {"ok": False, "error": "Invalid branch name.", "exit_code": -1, "project": name}
    return _run_git(name, ["checkout", "-b", value], timeout=45)


def merge(name: str, branch_name: str) -> dict:
    value = (branch_name or "").strip()
    if not _is_branch_name_safe(value):
        return {"ok": False, "error": "Invalid merge branch name.", "exit_code": -1, "project": name}
    return _run_git(name, ["merge", value], timeout=60)


def current_branch(name: str) -> str:
    result = _run_git(name, ["rev-parse", "--abbrev-ref", "HEAD"], timeout=10)
    if not result.get("ok"):
        return ""
    lines = (result.get("stdout") or "").strip().splitlines()
    return lines[0].strip() if lines else ""


def list_branches(name: str) -> dict:
    branches_result = _run_git(name, ["branch", "--list", "--format=%(refname:short)"], timeout=20)
    if not branches_result.get("ok"):
        return branches_result
    branches = [line.strip() for line in (branches_result.get("stdout") or "").splitlines() if line.strip()]
    return {
        "ok": True,
        "project": name,
        "branches": branches,
        "current_branch": current_branch(name),
        "exit_code": 0,
    }


def switch_branch(name: str, branch_name: str, create_if_missing: bool = False) -> dict:
    value = (branch_name or "").strip()
    if not _is_branch_name_safe(value):
        return {"ok": False, "error": "Invalid branch name.", "exit_code": -1, "project": name}
    args = ["checkout", "-b", value] if create_if_missing else ["checkout", value]
    result = _run_git(name, args, timeout=45)
    if result.get("ok"):
        result["current_branch"] = current_branch(name)
    return result


def merge_preview(name: str, source_branch: str, target_branch: str) -> dict:
    source = (source_branch or "").strip()
    target = (target_branch or "").strip()
    if not _is_branch_name_safe(source) or not _is_branch_name_safe(target):
        return {"ok": False, "error": "Invalid branch name for merge preview.", "exit_code": -1, "project": name}
    if source == target:
        return {
            "ok": False,
            "error": "Source and target branch must differ.",
            "exit_code": -1,
            "project": name,
        }

    dirty, status_result = _working_tree_dirty(name)
    if isinstance(status_result, dict) and not status_result.get("ok"):
        return status_result
    if dirty:
        return {
            "ok": False,
            "error": "Working tree is dirty. Commit or stash changes before merge preview.",
            "project": name,
            "exit_code": -1,
            "status": status_result.get("stdout", ""),
        }

    original_branch = current_branch(name) or target
    checkout_target = switch_branch(name, target, create_if_missing=False)
    if not checkout_target.get("ok"):
        return checkout_target

    preview_result = _run_git(name, ["merge", "--no-commit", "--no-ff", source], timeout=90)
    conflicts = _extract_conflicts(name)
    would_merge = bool(preview_result.get("ok") and not conflicts)

    abort_result = _run_git(name, ["merge", "--abort"], timeout=30)
    if not abort_result.get("ok"):
        # If no merge in progress, this can fail harmlessly.
        msg = (abort_result.get("stderr") or "").lower()
        harmless = "there is no merge to abort" in msg or "merge_head missing" in msg
        if not harmless:
            return {
                "ok": False,
                "error": "Failed to abort merge preview cleanly.",
                "project": name,
                "exit_code": -1,
                "details": abort_result,
            }

    if original_branch != target:
        restore_result = switch_branch(name, original_branch, create_if_missing=False)
        if not restore_result.get("ok"):
            return {
                "ok": False,
                "error": "Preview completed but failed to restore original branch.",
                "project": name,
                "exit_code": -1,
                "restore": restore_result,
            }

    return {
        "ok": True,
        "project": name,
        "source_branch": source,
        "target_branch": target,
        "original_branch": original_branch,
        "would_merge": would_merge,
        "has_conflicts": bool(conflicts),
        "conflicts": conflicts,
        "stdout": preview_result.get("stdout", ""),
        "stderr": preview_result.get("stderr", ""),
        "exit_code": 0,
    }


def merge_apply(
    name: str,
    source_branch: str,
    target_branch: str,
    allow_dirty_override: bool = False,
) -> dict:
    source = (source_branch or "").strip()
    target = (target_branch or "").strip()
    if not _is_branch_name_safe(source) or not _is_branch_name_safe(target):
        return {"ok": False, "error": "Invalid branch name for merge apply.", "exit_code": -1, "project": name}
    if source == target:
        return {"ok": False, "error": "Source and target branch must differ.", "exit_code": -1, "project": name}

    dirty, status_result = _working_tree_dirty(name)
    if isinstance(status_result, dict) and not status_result.get("ok"):
        return status_result
    if dirty and not allow_dirty_override:
        return {
            "ok": False,
            "error": "Working tree is dirty. Merge apply requires a clean working tree.",
            "project": name,
            "exit_code": -1,
            "status": status_result.get("stdout", ""),
        }

    original_branch = current_branch(name) or target
    checkout_target = switch_branch(name, target, create_if_missing=False)
    if not checkout_target.get("ok"):
        return checkout_target

    merge_result = _run_git(name, ["merge", source], timeout=120)
    conflicts = _extract_conflicts(name)
    if conflicts:
        _run_git(name, ["merge", "--abort"], timeout=30)
        if original_branch != target:
            switch_branch(name, original_branch, create_if_missing=False)
        return {
            "ok": False,
            "project": name,
            "source_branch": source,
            "target_branch": target,
            "conflicts": conflicts,
            "error": "Merge conflicts detected. Merge was aborted.",
            "stdout": merge_result.get("stdout", ""),
            "stderr": merge_result.get("stderr", ""),
            "exit_code": merge_result.get("exit_code", 1),
        }

    head_result = _run_git(name, ["rev-parse", "HEAD"], timeout=15)
    head_commit = (head_result.get("stdout") or "").strip() if head_result.get("ok") else ""

    if original_branch != target:
        restore_result = switch_branch(name, original_branch, create_if_missing=False)
        if not restore_result.get("ok"):
            return {
                "ok": False,
                "project": name,
                "error": "Merge applied but failed to restore original branch.",
                "merge": merge_result,
                "restore": restore_result,
                "exit_code": -1,
            }

    return {
        "ok": bool(merge_result.get("ok")),
        "project": name,
        "source_branch": source,
        "target_branch": target,
        "conflicts": [],
        "stdout": merge_result.get("stdout", ""),
        "stderr": merge_result.get("stderr", ""),
        "exit_code": merge_result.get("exit_code", 0),
        "merge_commit": head_commit,
    }
