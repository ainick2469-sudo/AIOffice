"""Runtime path and environment helpers.

This module centralizes file-system locations so local runs, tests, and packaged
desktop builds share one source of truth without hardcoded machine paths.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Iterable

from platformdirs import user_data_dir

APP_NAME = "AIOffice"
APP_ROOT = Path(__file__).resolve().parent.parent


def _resolve_existing(paths: Iterable[str | Path]) -> list[str]:
    resolved: list[str] = []
    for raw in paths:
        path = Path(raw)
        try:
            if path.exists():
                resolved.append(str(path))
        except Exception:
            continue
    return resolved


def _default_home() -> Path:
    return Path(user_data_dir(APP_NAME, appauthor=False))


AI_OFFICE_HOME = Path(
    os.environ.get("AI_OFFICE_HOME", str(_default_home()))
).expanduser().resolve()
PROJECTS_ROOT = Path(
    os.environ.get("AI_OFFICE_PROJECTS_DIR", str(AI_OFFICE_HOME / "projects"))
).expanduser().resolve()
DB_PATH = Path(
    os.environ.get("AI_OFFICE_DB_PATH", str(AI_OFFICE_HOME / "data" / "office.db"))
).expanduser().resolve()
MEMORY_DIR = Path(
    os.environ.get("AI_OFFICE_MEMORY_DIR", str(AI_OFFICE_HOME / "memory"))
).expanduser().resolve()
LOGS_DIR = Path(
    os.environ.get("AI_OFFICE_LOGS_DIR", str(AI_OFFICE_HOME / "logs"))
).expanduser().resolve()


def ensure_runtime_dirs() -> None:
    AI_OFFICE_HOME.mkdir(parents=True, exist_ok=True)
    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


def runtime_path_prefix() -> list[str]:
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    python_dir = Path(sys.executable).resolve().parent
    candidates = [
        system_root / "System32",
        system_root,
        program_files / "Git" / "cmd",
        program_files / "Git" / "bin",
        program_files / "nodejs",
        python_dir,
    ]
    return _resolve_existing(candidates)


def build_runtime_env(
    base_env: dict[str, str] | None = None,
    prepend_paths: Iterable[str | Path] | None = None,
) -> dict[str, str]:
    env = dict(base_env or os.environ)
    prefix = []
    if prepend_paths:
        prefix.extend(_resolve_existing(prepend_paths))
    prefix.extend(runtime_path_prefix())

    existing = env.get("PATH", "")
    if existing:
        env["PATH"] = ";".join(prefix + [existing])
    else:
        env["PATH"] = ";".join(prefix)
    return env


def executable_candidates(name: str) -> list[str]:
    lower = (name or "").strip().lower()
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    system_root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    if lower == "python":
        return [str(Path(sys.executable).resolve()), "python", "py"]
    if lower == "node":
        return [str(program_files / "nodejs" / "node.exe"), "node"]
    if lower == "npm":
        return [str(program_files / "nodejs" / "npm.cmd"), "npm"]
    if lower == "bash":
        return [
            str(program_files / "Git" / "bin" / "bash.exe"),
            str(system_root / "System32" / "bash.exe"),
            "bash",
        ]
    if lower == "git":
        return [str(program_files / "Git" / "cmd" / "git.exe"), "git"]
    return [name]


def resolve_executable(name: str, candidates: Iterable[str] | None = None) -> str:
    found = shutil.which(name)
    if found:
        return found
    for candidate in list(candidates or executable_candidates(name)):
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists():
            return str(path)
    return name
