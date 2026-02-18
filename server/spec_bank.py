"""Project-scoped Spec + Idea bank storage (markdown on disk, versioned)."""

from __future__ import annotations

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


def _current_spec_file(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "current_spec.md"


def _idea_bank_file(project_name: Optional[str]) -> Path:
    return _project_root(project_name) / "idea_bank.md"


def _ensure_dirs(project_name: Optional[str]) -> None:
    SPECS_ROOT.mkdir(parents=True, exist_ok=True)
    root = _project_root(project_name)
    root.mkdir(parents=True, exist_ok=True)
    _history_dir(project_name).mkdir(parents=True, exist_ok=True)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content or "", encoding="utf-8")


def _stamp() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return now.strftime("%Y%m%d-%H%M%S")


@dataclass(frozen=True)
class SpecSnapshot:
    project: str
    spec_md: str
    idea_bank_md: str
    spec_path: str
    idea_bank_path: str


def get_current(project_name: Optional[str]) -> SpecSnapshot:
    project = _project_name(project_name)
    _ensure_dirs(project)
    spec_path = _current_spec_file(project)
    idea_path = _idea_bank_file(project)
    return SpecSnapshot(
        project=project,
        spec_md=_read_text(spec_path),
        idea_bank_md=_read_text(idea_path),
        spec_path=str(spec_path),
        idea_bank_path=str(idea_path),
    )


def save_current(
    project_name: Optional[str],
    *,
    spec_md: str,
    idea_bank_md: Optional[str] = None,
) -> dict:
    project = _project_name(project_name)
    _ensure_dirs(project)

    version = _stamp()
    spec_path = _current_spec_file(project)
    spec_history = _history_dir(project) / f"spec-{version}.md"

    _write_text(spec_path, spec_md or "")
    _write_text(spec_history, spec_md or "")

    saved_ideas = None
    if idea_bank_md is not None:
        idea_path = _idea_bank_file(project)
        idea_history = _history_dir(project) / f"ideas-{version}.md"
        _write_text(idea_path, idea_bank_md or "")
        _write_text(idea_history, idea_bank_md or "")
        saved_ideas = str(idea_history)

    snap = get_current(project)
    return {
        "ok": True,
        "project": project,
        "version": version,
        "spec_path": snap.spec_path,
        "idea_bank_path": snap.idea_bank_path,
        "history_spec_path": str(spec_history),
        "history_ideas_path": saved_ideas,
    }


def list_history(project_name: Optional[str], limit: int = 50) -> list[dict]:
    project = _project_name(project_name)
    _ensure_dirs(project)
    history = _history_dir(project)
    items = []
    for path in sorted(history.glob("*.md"), reverse=True):
        items.append(
            {
                "name": path.name,
                "path": str(path),
                "bytes": int(path.stat().st_size) if path.exists() else 0,
                "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )
    return items[: max(1, min(int(limit or 50), 200))]

