"""Project workspace manager for channel-scoped execution."""

from __future__ import annotations

import json
import re
import secrets
import shutil
import subprocess
import time
import stat
from pathlib import Path
from typing import Optional

from . import database as db

APP_ROOT = Path("C:/AI_WORKSPACE/ai-office").resolve()
PROJECTS_ROOT = Path("C:/AI_WORKSPACE/projects").resolve()
PROJECT_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")

DELETE_CONFIRM_TTL_SECONDS = 60
_pending_delete_tokens: dict[str, dict] = {}


def _runtime_env() -> dict:
    env = dict(**__import__("os").environ)
    system_root = env.get("SystemRoot", r"C:\Windows")
    path_parts = [
        str(Path(system_root) / "System32"),
        system_root,
        r"C:\Program Files\Git\cmd",
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
    ]
    env["PATH"] = ";".join(path_parts + [env.get("PATH", "")])
    return env


def validate_project_name(name: str) -> bool:
    return bool(PROJECT_NAME_RE.match((name or "").strip()))


def get_project_root(name: str) -> Path:
    return (PROJECTS_ROOT / name).resolve()


def _cleanup_expired_tokens():
    now = time.time()
    expired = [name for name, payload in _pending_delete_tokens.items() if payload["expires_at"] < now]
    for name in expired:
        _pending_delete_tokens.pop(name, None)


def _ensure_inside_projects(path: Path) -> bool:
    try:
        return str(path.resolve()).startswith(str(PROJECTS_ROOT))
    except Exception:
        return False


def _handle_remove_readonly(func, path, _exc_info):
    try:
        __import__("os").chmod(path, stat.S_IWRITE)
        func(path)
    except Exception:
        pass


def _ensure_project_layout(project_root: Path):
    (project_root / "src").mkdir(parents=True, exist_ok=True)
    (project_root / "tests").mkdir(parents=True, exist_ok=True)
    (project_root / "docs").mkdir(parents=True, exist_ok=True)
    (project_root / "config").mkdir(parents=True, exist_ok=True)
    (project_root / ".ai-office").mkdir(parents=True, exist_ok=True)

    readme = project_root / "README.md"
    if not readme.exists():
        readme.write_text(
            f"# {project_root.name}\n\n"
            "Workspace created by AI Office.\n\n"
            "## Structure\n"
            "- `src/`\n"
            "- `tests/`\n"
            "- `docs/`\n"
            "- `config/`\n",
            encoding="utf-8",
        )


def _run_git_bootstrap(project_root: Path):
    env = _runtime_env()
    try:
        subprocess.run(
            ["cmd", "/c", "git", "init"],
            cwd=str(project_root),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        subprocess.run(
            ["cmd", "/c", "git", "add", "."],
            cwd=str(project_root),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        subprocess.run(
            ["cmd", "/c", "git", "commit", "-m", "Initial workspace scaffold"],
            cwd=str(project_root),
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception:
        # Git may be unavailable on some local installs; keep workspace usable regardless.
        pass


def _workspace_metadata(project_root: Path) -> dict:
    readme = project_root / "README.md"
    config = project_root / ".ai-office" / "config.json"
    return {
        "name": project_root.name,
        "path": str(project_root),
        "exists": project_root.exists(),
        "has_readme": readme.exists(),
        "has_build_config": config.exists(),
        "updated_at": int(project_root.stat().st_mtime) if project_root.exists() else 0,
    }


def _apply_template(project_root: Path, template: Optional[str]):
    if not template:
        return
    t = template.strip().lower()
    if t == "react":
        (project_root / "src" / "App.jsx").write_text(
            "export default function App() {\n"
            "  return <main><h1>React Template</h1></main>;\n"
            "}\n",
            encoding="utf-8",
        )
        (project_root / "package.json").write_text(
            json.dumps(
                {
                    "name": project_root.name,
                    "private": True,
                    "scripts": {"dev": "vite", "build": "vite build", "test": "echo \"no tests\""},
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    elif t == "python":
        (project_root / "src" / "main.py").write_text(
            "def main():\n"
            "    print('Python template project')\n\n"
            "if __name__ == '__main__':\n"
            "    main()\n",
            encoding="utf-8",
        )
        (project_root / "requirements.txt").write_text("pytest\n", encoding="utf-8")
    elif t == "rust":
        (project_root / "Cargo.toml").write_text(
            "[package]\n"
            f"name = \"{project_root.name}\"\n"
            "version = \"0.1.0\"\n"
            "edition = \"2021\"\n",
            encoding="utf-8",
        )
        (project_root / "src" / "main.rs").write_text(
            "fn main() {\n"
            "    println!(\"Rust template project\");\n"
            "}\n",
            encoding="utf-8",
        )


async def create_project(name: str, template: Optional[str] = None) -> dict:
    normalized = (name or "").strip().lower()
    if not validate_project_name(normalized):
        raise ValueError("Invalid project name. Use lowercase letters, numbers, and hyphens (max 50 chars).")

    PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
    root = get_project_root(normalized)
    if not _ensure_inside_projects(root):
        raise ValueError("Project path would escape projects root.")
    if root.exists():
        raise ValueError("Project already exists.")

    root.mkdir(parents=True, exist_ok=False)
    _ensure_project_layout(root)
    _apply_template(root, template)
    _run_git_bootstrap(root)

    info = _workspace_metadata(root)
    info["template"] = template or ""
    return info


async def list_projects() -> list[dict]:
    if not PROJECTS_ROOT.exists():
        return []
    projects = []
    for entry in sorted(PROJECTS_ROOT.iterdir(), key=lambda p: p.name.lower()):
        if entry.is_dir():
            projects.append(_workspace_metadata(entry))
    return projects


async def delete_project(name: str, confirm_token: Optional[str] = None) -> dict:
    normalized = (name or "").strip().lower()
    if not validate_project_name(normalized):
        raise ValueError("Invalid project name.")

    project_root = get_project_root(normalized)
    if not project_root.exists():
        raise ValueError("Project not found.")

    _cleanup_expired_tokens()
    pending = _pending_delete_tokens.get(normalized)
    if not confirm_token:
        token = secrets.token_urlsafe(8)
        _pending_delete_tokens[normalized] = {
            "token": token,
            "expires_at": time.time() + DELETE_CONFIRM_TTL_SECONDS,
        }
        return {
            "ok": False,
            "requires_confirmation": True,
            "project": normalized,
            "confirm_token": token,
            "expires_in_seconds": DELETE_CONFIRM_TTL_SECONDS,
            "warning": (
                f"Delete is destructive. Re-run with confirm token within {DELETE_CONFIRM_TTL_SECONDS}s."
            ),
        }

    if not pending or pending.get("token") != confirm_token:
        raise ValueError("Invalid or expired confirmation token.")
    if pending.get("expires_at", 0) < time.time():
        _pending_delete_tokens.pop(normalized, None)
        raise ValueError("Confirmation token expired.")

    shutil.rmtree(project_root, ignore_errors=False, onerror=_handle_remove_readonly)
    _pending_delete_tokens.pop(normalized, None)

    channels = await db.list_channel_projects()
    for row in channels:
        if row.get("project_name") == normalized:
            await db.set_channel_active_project(row["channel"], "ai-office")

    return {"ok": True, "deleted": normalized}


async def switch_project(channel: str, name: str) -> dict:
    normalized = (name or "").strip().lower()
    if normalized in {"app", "root", "ai-office"}:
        await db.set_channel_active_project(channel, "ai-office")
        return {
            "channel": channel,
            "project": "ai-office",
            "path": str(APP_ROOT),
            "is_app_root": True,
        }

    if not validate_project_name(normalized):
        raise ValueError("Invalid project name.")
    project_root = get_project_root(normalized)
    if not project_root.exists() or not project_root.is_dir():
        raise ValueError("Project not found.")

    await db.set_channel_active_project(channel, normalized)
    return {
        "channel": channel,
        "project": normalized,
        "path": str(project_root),
        "is_app_root": False,
    }


async def get_active_project(channel: str) -> dict:
    active = await db.get_channel_active_project(channel)
    if not active or active == "ai-office":
        return {"channel": channel, "project": "ai-office", "path": str(APP_ROOT), "is_app_root": True}

    root = get_project_root(active)
    if not root.exists():
        await db.set_channel_active_project(channel, "ai-office")
        return {"channel": channel, "project": "ai-office", "path": str(APP_ROOT), "is_app_root": True}
    return {"channel": channel, "project": active, "path": str(root), "is_app_root": False}


async def get_project_status(channel: str) -> dict:
    active = await get_active_project(channel)
    projects = await list_projects()
    return {
        "active": active,
        "projects_count": len(projects),
        "projects_root": str(PROJECTS_ROOT),
        "known_projects": [p["name"] for p in projects],
    }


async def get_sandbox_root(channel: str) -> Path:
    active = await get_active_project(channel)
    return Path(active["path"]).resolve()


async def maybe_detect_build_config(channel: str):
    active = await get_active_project(channel)
    if active["is_app_root"]:
        return None
    from .build_runner import detect_and_store_config

    return await detect_and_store_config(active["project"])


def project_config_path(project_name: str) -> Path:
    if project_name == "ai-office":
        root = APP_ROOT
    else:
        root = get_project_root(project_name)
    return root / ".ai-office" / "config.json"


def read_project_config(project_name: str) -> dict:
    path = project_config_path(project_name)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
