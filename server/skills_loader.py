"""Local plugin skill loader and dynamic tool registry."""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import json
import re
import time
from pathlib import Path
from typing import Any

from .runtime_paths import APP_ROOT

SKILLS_ROOT = APP_ROOT / "skills"
_TOOL_REGISTRY: dict[str, dict[str, Any]] = {}
_SKILL_STATE: dict[str, float] = {}
_WATCH_TASK: asyncio.Task | None = None
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,49}$")


def registered_tools() -> list[str]:
    return sorted(_TOOL_REGISTRY.keys())


def _skill_mtime(skill_dir: Path) -> float:
    latest = 0.0
    for candidate in (skill_dir / "manifest.json", skill_dir / "SKILL.md", skill_dir / "tools.py"):
        try:
            latest = max(latest, candidate.stat().st_mtime)
        except Exception:
            continue
    return latest


def _load_module(module_name: str, source_file: Path):
    spec = importlib.util.spec_from_file_location(module_name, str(source_file))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {source_file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _register_skill(skill_dir: Path) -> dict[str, Any]:
    manifest_path = skill_dir / "manifest.json"
    if not manifest_path.exists():
        return {"ok": False, "skill": skill_dir.name, "error": "manifest.json missing"}

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"ok": False, "skill": skill_dir.name, "error": f"manifest parse failed: {exc}"}

    tools = manifest.get("tools", [])
    if not isinstance(tools, list):
        return {"ok": False, "skill": skill_dir.name, "error": "manifest.tools must be a list"}

    entrypoint = (manifest.get("entrypoint") or "tools.py").strip()
    module_file = skill_dir / entrypoint
    if not module_file.exists():
        return {"ok": False, "skill": skill_dir.name, "error": f"entrypoint missing: {entrypoint}"}

    try:
        module = _load_module(f"ai_office_skill_{skill_dir.name}", module_file)
    except Exception as exc:
        return {"ok": False, "skill": skill_dir.name, "error": f"entrypoint load failed: {exc}"}

    added = []
    for item in tools:
        if not isinstance(item, dict):
            continue
        tool_name = str(item.get("name", "")).strip().lower()
        function_name = str(item.get("function", "")).strip()
        if not tool_name or not function_name:
            continue
        fn = getattr(module, function_name, None)
        if not callable(fn):
            continue
        _TOOL_REGISTRY[tool_name] = {
            "skill": skill_dir.name,
            "tool": tool_name,
            "function_name": function_name,
            "callable": fn,
            "permissions": item.get("permissions", []),
            "description": item.get("description", ""),
        }
        added.append(tool_name)

    _SKILL_STATE[skill_dir.name] = _skill_mtime(skill_dir)
    return {"ok": True, "skill": skill_dir.name, "tools": added}


def load_skills() -> dict[str, Any]:
    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    _TOOL_REGISTRY.clear()
    results = []
    for skill_dir in sorted(SKILLS_ROOT.iterdir(), key=lambda p: p.name.lower()):
        if not skill_dir.is_dir():
            continue
        results.append(_register_skill(skill_dir))
    return {
        "ok": True,
        "skills_root": str(SKILLS_ROOT),
        "loaded_tools": registered_tools(),
        "results": results,
    }


def reload_skills() -> dict[str, Any]:
    return load_skills()


async def invoke_tool(tool_name: str, arg: str, context: dict[str, Any]) -> dict[str, Any]:
    normalized = (tool_name or "").strip().lower()
    entry = _TOOL_REGISTRY.get(normalized)
    if not entry:
        return {"ok": False, "error": f"Plugin tool not found: {tool_name}"}

    fn = entry["callable"]
    try:
        result = fn(arg=arg, context=context)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, dict):
            payload = result
        else:
            payload = {"ok": True, "output": str(result)}
        payload.setdefault("ok", True)
        payload.setdefault("tool", normalized)
        payload.setdefault("skill", entry["skill"])
        return payload
    except Exception as exc:
        return {
            "ok": False,
            "tool": normalized,
            "skill": entry["skill"],
            "error": str(exc),
        }


def create_skill_scaffold(name: str) -> dict[str, Any]:
    skill_name = (name or "").strip().lower()
    if not _NAME_RE.match(skill_name):
        return {"ok": False, "error": "Invalid skill name. Use lowercase letters, numbers, hyphens (max 50 chars)."}

    SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
    skill_dir = SKILLS_ROOT / skill_name
    if skill_dir.exists():
        return {"ok": False, "error": f"Skill already exists: {skill_name}"}

    skill_dir.mkdir(parents=True, exist_ok=False)
    tests_dir = skill_dir / "tests"
    tests_dir.mkdir(parents=True, exist_ok=True)

    (skill_dir / "SKILL.md").write_text(
        f"# {skill_name}\n\n"
        "Describe what this skill does and when to use it.\n",
        encoding="utf-8",
    )
    (skill_dir / "manifest.json").write_text(
        json.dumps(
            {
                "name": skill_name,
                "entrypoint": "tools.py",
                "tools": [
                    {
                        "name": f"{skill_name}-echo",
                        "function": "echo_tool",
                        "description": "Echo input for scaffold verification.",
                        "permissions": ["read"],
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (skill_dir / "tools.py").write_text(
        "def echo_tool(arg: str, context: dict):\n"
        "    return {\n"
        "        'ok': True,\n"
        "        'output': f\"echo:{arg}\",\n"
        "        'context': {'channel': context.get('channel'), 'agent_id': context.get('agent_id')},\n"
        "    }\n",
        encoding="utf-8",
    )
    (tests_dir / "test_skill.py").write_text(
        "from pathlib import Path\n\n"
        "def test_skill_scaffold_files_exist():\n"
        "    root = Path(__file__).resolve().parents[1]\n"
        "    assert (root / 'SKILL.md').exists()\n"
        "    assert (root / 'manifest.json').exists()\n"
        "    assert (root / 'tools.py').exists()\n",
        encoding="utf-8",
    )

    summary = _register_skill(skill_dir)
    summary["path"] = str(skill_dir)
    return summary


async def watch_skills(interval_seconds: float = 2.5) -> None:
    while True:
        try:
            changed = False
            if not SKILLS_ROOT.exists():
                SKILLS_ROOT.mkdir(parents=True, exist_ok=True)
            for skill_dir in SKILLS_ROOT.iterdir():
                if not skill_dir.is_dir():
                    continue
                current = _skill_mtime(skill_dir)
                previous = _SKILL_STATE.get(skill_dir.name, 0.0)
                if current > previous:
                    changed = True
                    break
            if changed:
                load_skills()
        except Exception:
            pass
        await asyncio.sleep(interval_seconds)


def ensure_dev_watcher(enabled: bool) -> None:
    global _WATCH_TASK
    if not enabled:
        return
    if _WATCH_TASK and not _WATCH_TASK.done():
        return
    _WATCH_TASK = asyncio.create_task(watch_skills())
