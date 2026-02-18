"""Blueprint storage + generation (spec -> lightweight architecture map).

Blueprints are stored alongside specs under AI_OFFICE_HOME/specs/<project>/.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .runtime_config import AI_OFFICE_HOME

SPECS_ROOT = AI_OFFICE_HOME / "specs"
DEFAULT_PROJECT = "ai-office"


def _project_name(value: Optional[str]) -> str:
    text = (value or DEFAULT_PROJECT).strip()
    return text or DEFAULT_PROJECT


def _project_root(project_name: Optional[str]) -> Path:
    return SPECS_ROOT / _project_name(project_name)


def _history_dir(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "history"


def _current_blueprint_file(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "blueprint-current.json"


def _ensure_dirs(project_name: Optional[str]) -> None:
    SPECS_ROOT.mkdir(parents=True, exist_ok=True)
    root = _project_root(project_name)
    root.mkdir(parents=True, exist_ok=True)
    _history_dir(project_name).mkdir(parents=True, exist_ok=True)


def _stamp() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return now.strftime("%Y%m%d-%H%M%S")


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


@dataclass(frozen=True)
class BlueprintSnapshot:
    project: str
    blueprint: dict
    blueprint_path: str


def get_current(project_name: Optional[str]) -> BlueprintSnapshot:
    project = _project_name(project_name)
    _ensure_dirs(project)
    path = _current_blueprint_file(project)
    return BlueprintSnapshot(
        project=project,
        blueprint=_read_json(path) if path.exists() else {},
        blueprint_path=str(path),
    )


def save_current(project_name: Optional[str], blueprint: dict) -> dict:
    project = _project_name(project_name)
    _ensure_dirs(project)

    version = _stamp()
    current_path = _current_blueprint_file(project)
    history_path = _history_dir(project) / f"blueprint-{version}.json"

    payload = dict(blueprint or {})
    payload.setdefault("version", version)
    payload.setdefault("generated_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

    _write_json(current_path, payload)
    _write_json(history_path, payload)

    snap = get_current(project)
    return {
        "ok": True,
        "project": project,
        "version": version,
        "blueprint_path": snap.blueprint_path,
        "history_path": str(history_path),
    }


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    text = (value or "").strip().lower()
    slug = _SLUG_RE.sub("-", text).strip("-")
    return slug or "item"


def generate_from_spec(spec_md: str) -> dict:
    """Best-effort parsing: headings become cluster nodes, bullets become child nodes."""
    text = spec_md or ""
    lines = text.splitlines()

    nodes: list[dict] = []
    edges: list[dict] = []
    node_ids: set[str] = set()

    def add_node(node_id: str, label: str, search_terms: Optional[list[str]] = None):
        if node_id in node_ids:
            return
        node_ids.add(node_id)
        nodes.append({"id": node_id, "label": label, "search_terms": search_terms or []})

    current_section = None
    current_section_id = None

    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        if line.startswith("#"):
            title = line.lstrip("#").strip()
            if not title:
                continue
            current_section = title
            current_section_id = f"sec-{_slug(title)}"
            add_node(current_section_id, title, search_terms=[title])
            continue

        if line.startswith(("-", "*")) and current_section_id:
            item = line.lstrip("-*").strip()
            if not item:
                continue
            base = item.split(":", 1)[0].strip()
            item_id = f"mod-{_slug(current_section)}-{_slug(base)}"
            add_node(item_id, base, search_terms=[base, item])
            edges.append({"from": current_section_id, "to": item_id, "label": "includes"})

            if "->" in item:
                parts = [p.strip() for p in item.split("->") if p.strip()]
                if len(parts) >= 2:
                    a = parts[0]
                    b = parts[1]
                    a_id = f"mod-{_slug(a)}"
                    b_id = f"mod-{_slug(b)}"
                    add_node(a_id, a, search_terms=[a])
                    add_node(b_id, b, search_terms=[b])
                    edges.append({"from": a_id, "to": b_id, "label": "flows to"})

        if len(nodes) >= 60:
            break

    return {
        "nodes": nodes,
        "edges": edges[:200],
    }

