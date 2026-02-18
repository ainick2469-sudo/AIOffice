"""Checkpoint helpers for safe snapshot + rollback flows.

Goal: "Checkpoint -> experiment -> restore" without requiring git expertise.

Strategy:
- Prefer git-backed checkpoints when a project root has `.git`.
- Otherwise fall back to zip snapshots stored under AI_OFFICE_HOME.

All destructive restore operations require explicit confirmation text.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .project_manager import APP_ROOT, get_project_root
from .runtime_config import AI_OFFICE_HOME, build_runtime_env

CHECKPOINT_PREFIX = "checkpoint/"
RESTORE_CONFIRM_TEXT = "RESTORE"

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _project_root(name: str) -> Path:
    if name == "ai-office":
        return APP_ROOT
    return get_project_root(name)


def _now_id() -> str:
    # UTC timestamp for stable sorting across machines/timezones.
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())


def _slugify(value: str, fallback: str = "checkpoint") -> str:
    raw = (value or "").strip().lower()
    slug = _SLUG_RE.sub("-", raw).strip("-")
    if not slug:
        slug = fallback
    return slug[:48]


def _git_env() -> dict:
    env = build_runtime_env()
    # Avoid failures when user.name/email aren't configured; do not persist config.
    env.setdefault("GIT_AUTHOR_NAME", "AI Office")
    env.setdefault("GIT_AUTHOR_EMAIL", "ai-office@local")
    env.setdefault("GIT_COMMITTER_NAME", "AI Office")
    env.setdefault("GIT_COMMITTER_EMAIL", "ai-office@local")
    return env


def _run_git(root: Path, args: list[str], timeout: int = 60) -> dict:
    started = time.time()
    try:
        proc = subprocess.run(
            ["cmd", "/c", "git", *args],
            cwd=str(root),
            env=_git_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return {
            "ok": proc.returncode == 0,
            "args": args,
            "stdout": (proc.stdout or "")[:12000],
            "stderr": (proc.stderr or "")[:6000],
            "exit_code": proc.returncode,
            "duration_ms": int((time.time() - started) * 1000),
        }
    except Exception as exc:
        return {
            "ok": False,
            "args": args,
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
            "duration_ms": int((time.time() - started) * 1000),
        }


def _is_git_repo(root: Path) -> bool:
    return (root / ".git").exists()


def _git_is_dirty(root: Path) -> tuple[bool, dict]:
    result = _run_git(root, ["status", "--porcelain"], timeout=20)
    if not result.get("ok"):
        return False, result
    dirty = bool((result.get("stdout") or "").strip())
    return dirty, result


def _parse_annotated_tag_message(cat_output: str) -> tuple[str, str]:
    """Return (subject, body) from `git cat-file -p <tag>` output."""
    parts = cat_output.split("\n\n", 1)
    if len(parts) != 2:
        return "", ""
    message = parts[1]
    lines = message.splitlines()
    subject = lines[0].strip() if lines else ""
    body = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
    return subject, body


@dataclass
class Checkpoint:
    checkpoint_id: str
    name: str
    note: str
    created_at: str
    kind: str  # "git" | "zip"
    ref: str  # commit sha or zip path

    def to_dict(self) -> dict:
        return {
            "id": self.checkpoint_id,
            "name": self.name,
            "note": self.note,
            "created_at": self.created_at,
            "kind": self.kind,
            "ref": self.ref,
        }


def _snapshots_dir(project_name: str) -> Path:
    return (AI_OFFICE_HOME / "snapshots" / project_name).resolve()


def _load_snapshot_manifest(path: Path) -> list[dict]:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def _save_snapshot_manifest(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(items, indent=2), encoding="utf-8")


def list_checkpoints(project_name: str) -> dict:
    root = _project_root(project_name)
    if not root.exists():
        return {"ok": False, "error": "Project not found.", "checkpoints": []}

    if _is_git_repo(root):
        tags = _run_git(root, ["tag", "--list", "checkpoint/*", "--sort=-creatordate"], timeout=20)
        if not tags.get("ok"):
            return {"ok": False, "error": tags.get("stderr") or "Failed to list checkpoints.", "details": tags}

        checkpoints: list[dict] = []
        for tag in [line.strip() for line in (tags.get("stdout") or "").splitlines() if line.strip()]:
            # Avoid caret/brace revspecs to keep Windows cmd parsing predictable.
            commit_res = _run_git(root, ["rev-list", "-n", "1", tag], timeout=15)
            commit = (commit_res.get("stdout") or "").strip().splitlines()[:1]
            commit_sha = commit[0].strip() if commit else ""

            created_res = _run_git(
                root,
                ["for-each-ref", f"refs/tags/{tag}", "--format=%(creatordate:iso8601)"],
                timeout=10,
            )
            created_at = (created_res.get("stdout") or "").strip() or ""

            cat_res = _run_git(root, ["cat-file", "-p", tag], timeout=10)
            subject = ""
            note = ""
            if cat_res.get("ok") and (cat_res.get("stdout") or "").startswith("object "):
                subject, note = _parse_annotated_tag_message(cat_res.get("stdout") or "")
            if not subject:
                subj_res = _run_git(root, ["show", "-s", "--format=%s", tag], timeout=10)
                subject = (subj_res.get("stdout") or "").strip()

            name = subject.replace("checkpoint:", "", 1).strip() if subject.lower().startswith("checkpoint:") else subject.strip()
            if not name:
                name = tag.split("/", 1)[-1]

            checkpoints.append(
                Checkpoint(
                    checkpoint_id=tag,
                    name=name,
                    note=note,
                    created_at=created_at,
                    kind="git",
                    ref=commit_sha,
                ).to_dict()
            )

        return {"ok": True, "project": project_name, "checkpoints": checkpoints}

    snapshots_dir = _snapshots_dir(project_name)
    manifest_path = snapshots_dir / "manifest.json"
    items = _load_snapshot_manifest(manifest_path)
    checkpoints: list[dict] = []
    for item in items:
        try:
            zip_path = Path(item.get("zip_path", ""))
            if not zip_path.is_absolute():
                zip_path = (snapshots_dir / zip_path).resolve()
            if not zip_path.exists():
                continue
            checkpoints.append(
                Checkpoint(
                    checkpoint_id=str(item.get("id", "")),
                    name=str(item.get("name", "")),
                    note=str(item.get("note", "")),
                    created_at=str(item.get("created_at", "")),
                    kind="zip",
                    ref=str(zip_path),
                ).to_dict()
            )
        except Exception:
            continue
    checkpoints.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"ok": True, "project": project_name, "checkpoints": checkpoints}


def create_checkpoint(project_name: str, name: str, note: str = "") -> dict:
    root = _project_root(project_name)
    if not root.exists():
        return {"ok": False, "error": "Project not found."}

    title = (name or "").strip()
    if not title:
        return {"ok": False, "error": "Checkpoint name is required."}
    note_text = (note or "").strip()

    created_id = _now_id()
    slug = _slugify(title)

    if _is_git_repo(root):
        tag = f"{CHECKPOINT_PREFIX}{created_id}-{slug}"

        dirty, dirty_res = _git_is_dirty(root)
        if isinstance(dirty_res, dict) and not dirty_res.get("ok"):
            return {"ok": False, "error": dirty_res.get("stderr") or "Failed to inspect git status.", "details": dirty_res}

        commit_sha = ""
        if dirty:
            add_res = _run_git(root, ["add", "-A"], timeout=45)
            if not add_res.get("ok"):
                return {"ok": False, "error": add_res.get("stderr") or "Failed to stage changes.", "details": add_res}

            commit_args = ["commit", "-m", f"checkpoint: {title}"]
            if note_text:
                commit_args += ["-m", note_text]
            commit_res = _run_git(root, commit_args, timeout=90)
            if not commit_res.get("ok"):
                return {"ok": False, "error": commit_res.get("stderr") or "Failed to create checkpoint commit.", "details": commit_res}

        sha_res = _run_git(root, ["rev-parse", "HEAD"], timeout=15)
        if sha_res.get("ok"):
            head = (sha_res.get("stdout") or "").strip().splitlines()[:1]
            commit_sha = head[0].strip() if head else ""

        tag_args = ["tag", "-a", tag, "-m", f"checkpoint: {title}"]
        if note_text:
            tag_args += ["-m", note_text]
        tag_res = _run_git(root, tag_args, timeout=20)
        if not tag_res.get("ok"):
            return {"ok": False, "error": tag_res.get("stderr") or "Failed to tag checkpoint.", "details": tag_res}

        return {
            "ok": True,
            "project": project_name,
            "checkpoint": Checkpoint(
                checkpoint_id=tag,
                name=title,
                note=note_text,
                created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                kind="git",
                ref=commit_sha,
            ).to_dict(),
        }

    snapshots_dir = _snapshots_dir(project_name)
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_id = f"{created_id}-{slug}"
    zip_path = snapshots_dir / f"{checkpoint_id}.zip"

    excluded = {".git", "node_modules", "venv", ".venv", "__pycache__", "client-dist"}
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirnames, filenames in os.walk(root):
            rel_dir = Path(dirpath).resolve().relative_to(root.resolve())
            if rel_dir.parts and rel_dir.parts[0] in excluded:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if d not in excluded]
            for filename in filenames:
                rel_path = rel_dir / filename
                if rel_path.parts and rel_path.parts[0] in excluded:
                    continue
                full_path = Path(dirpath) / filename
                try:
                    zf.write(full_path, str(rel_path))
                except Exception:
                    continue

    manifest_path = snapshots_dir / "manifest.json"
    items = _load_snapshot_manifest(manifest_path)
    items.insert(
        0,
        {
            "id": checkpoint_id,
            "name": title,
            "note": note_text,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "zip_path": zip_path.name,
        },
    )
    _save_snapshot_manifest(manifest_path, items[:200])

    return {
        "ok": True,
        "project": project_name,
        "checkpoint": Checkpoint(
            checkpoint_id=checkpoint_id,
            name=title,
            note=note_text,
            created_at=items[0]["created_at"],
            kind="zip",
            ref=str(zip_path),
        ).to_dict(),
    }


def restore_checkpoint(project_name: str, checkpoint_id: str, confirm: str) -> dict:
    if (confirm or "").strip().upper() != RESTORE_CONFIRM_TEXT:
        return {"ok": False, "error": f"Restore requires confirm='{RESTORE_CONFIRM_TEXT}'."}

    root = _project_root(project_name)
    if not root.exists():
        return {"ok": False, "error": "Project not found."}

    if _is_git_repo(root):
        tag = (checkpoint_id or "").strip()
        if not tag.startswith(CHECKPOINT_PREFIX) or any(token in tag for token in (" ", "\t", "\n", "..", "~", "^", ":", "\\", "@{")):
            return {"ok": False, "error": "Invalid checkpoint id."}

        dirty, status_res = _git_is_dirty(root)
        if isinstance(status_res, dict) and not status_res.get("ok"):
            return {"ok": False, "error": status_res.get("stderr") or "Failed to inspect git status.", "details": status_res}
        if dirty:
            return {"ok": False, "error": "Working tree is dirty. Commit or stash changes before restore.", "status": status_res.get("stdout", "")}

        commit_res = _run_git(root, ["rev-list", "-n", "1", tag], timeout=15)
        if not commit_res.get("ok"):
            return {"ok": False, "error": "Checkpoint tag not found.", "details": commit_res}
        commit_sha = (commit_res.get("stdout") or "").strip().splitlines()[:1]
        commit_sha = commit_sha[0].strip() if commit_sha else ""

        reset_res = _run_git(root, ["reset", "--hard", commit_sha], timeout=90)
        if not reset_res.get("ok"):
            return {"ok": False, "error": reset_res.get("stderr") or "Failed to reset.", "details": reset_res}

        clean_res = _run_git(root, ["clean", "-fd"], timeout=60)
        if not clean_res.get("ok"):
            return {"ok": False, "error": clean_res.get("stderr") or "Failed to clean untracked files.", "details": clean_res}

        return {"ok": True, "project": project_name, "checkpoint_id": tag, "restored": True}

    snapshots_dir = _snapshots_dir(project_name)
    zip_path = (snapshots_dir / f"{checkpoint_id}.zip").resolve()
    if not zip_path.exists():
        return {"ok": False, "error": "Checkpoint snapshot not found."}

    for entry in root.iterdir():
        try:
            if entry.name in {".git"}:
                continue
            if entry.is_dir():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                entry.unlink(missing_ok=True)
        except Exception:
            continue

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(root)

    return {"ok": True, "project": project_name, "checkpoint_id": checkpoint_id, "restored": True}


def delete_checkpoint(project_name: str, checkpoint_id: str) -> dict:
    root = _project_root(project_name)
    if not root.exists():
        return {"ok": False, "error": "Project not found."}

    if _is_git_repo(root):
        tag = (checkpoint_id or "").strip()
        if not tag.startswith(CHECKPOINT_PREFIX) or any(token in tag for token in (" ", "\t", "\n", "..", "~", "^", ":", "\\", "@{")):
            return {"ok": False, "error": "Invalid checkpoint id."}
        res = _run_git(root, ["tag", "-d", tag], timeout=20)
        if not res.get("ok"):
            return {"ok": False, "error": res.get("stderr") or "Failed to delete tag.", "details": res}
        return {"ok": True, "project": project_name, "deleted": True, "checkpoint_id": tag}

    snapshots_dir = _snapshots_dir(project_name)
    zip_path = (snapshots_dir / f"{checkpoint_id}.zip").resolve()
    if zip_path.exists():
        try:
            zip_path.unlink(missing_ok=True)
        except Exception:
            pass

    manifest_path = snapshots_dir / "manifest.json"
    items = [item for item in _load_snapshot_manifest(manifest_path) if str(item.get("id", "")) != str(checkpoint_id)]
    _save_snapshot_manifest(manifest_path, items)
    return {"ok": True, "project": project_name, "deleted": True, "checkpoint_id": checkpoint_id}
