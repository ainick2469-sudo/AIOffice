"""Project runtime helpers for channel-scoped workspaces and venv management."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Optional

from . import project_manager
from .runtime_config import build_runtime_env


def _venv_python(venv_dir: Path) -> Path:
    return venv_dir / "Scripts" / "python.exe"


async def get_channel_workspace(channel: str) -> dict:
    active = await project_manager.get_active_project(channel)
    repo_path = Path(active["path"]).resolve()
    if active.get("is_app_root"):
        return {
            "project": active["project"],
            "channel": channel,
            "repo": repo_path,
            "workspace": repo_path,
            "venv": None,
            "python": Path(sys.executable).resolve(),
        }

    workspace_dir = repo_path.parent
    venv_dir = workspace_dir / "venv"
    return {
        "project": active["project"],
        "channel": channel,
        "repo": repo_path,
        "workspace": workspace_dir,
        "venv": venv_dir,
        "python": _venv_python(venv_dir),
    }


async def ensure_workspace_venv(channel: str) -> Optional[Path]:
    info = await get_channel_workspace(channel)
    venv_dir = info.get("venv")
    if not venv_dir:
        return None

    python_exe = _venv_python(venv_dir)
    if python_exe.exists():
        return python_exe

    venv_dir.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [sys.executable, "-m", "venv", str(venv_dir)],
        check=True,
        env=build_runtime_env(),
    )
    return python_exe if python_exe.exists() else None


async def rewrite_command_for_workspace(channel: str, command: str) -> str:
    info = await get_channel_workspace(channel)
    repo_path = Path(info["repo"]).resolve()
    venv_python = await ensure_workspace_venv(channel)
    cmd = (command or "").strip()
    lower = cmd.lower()

    # Keep app-root behavior unchanged.
    if info.get("venv") is None or not venv_python:
        return cmd

    if lower.startswith("python "):
        return f"\"{venv_python}\" {cmd[7:]}"
    if lower.startswith("pip "):
        return f"\"{venv_python}\" -m pip {cmd[4:]}"
    if lower.startswith("python -m pip "):
        return f"\"{venv_python}\" -m pip {cmd[13:]}"

    # For direct script runs in workspace, ensure cwd remains inside repo.
    if lower.startswith("uvicorn ") or lower.startswith("flask run"):
        return cmd

    return cmd

