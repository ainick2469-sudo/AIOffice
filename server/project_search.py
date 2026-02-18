"""Project-scoped text search utilities (Oracle UI).

This is intentionally simple and dependency-free:
- Walk a project root directory
- Ignore common large/vendor dirs
- Scan text files line-by-line with size caps
"""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_IGNORE_DIRS = {
    ".git",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    "client-dist",
    "dist",
    "build",
    "data",
}

MAX_FILE_BYTES = 1_200_000  # ~1.2MB
MAX_LINE_CHARS = 300


def _looks_binary(sample: bytes) -> bool:
    if not sample:
        return False
    if b"\x00" in sample:
        return True
    # Heuristic: lots of high bytes tends to be binary-ish.
    high = sum(1 for b in sample if b >= 0x80)
    return high / max(1, len(sample)) > 0.3


def search_text(root: Path, query: str, limit: int = 50) -> list[dict]:
    q = (query or "").strip()
    if not q:
        return []
    lim = max(1, min(int(limit or 50), 500))
    needle = q.lower()

    results: list[dict] = []
    root = Path(root).resolve()

    for dirpath, dirnames, filenames in os.walk(root):
        # Mutate dirnames in-place to prune traversal.
        dirnames[:] = [
            d for d in dirnames
            if d not in DEFAULT_IGNORE_DIRS and not d.startswith(".")
        ]

        for filename in filenames:
            if len(results) >= lim:
                return results

            if filename.startswith("."):
                continue

            full_path = Path(dirpath) / filename
            try:
                if full_path.is_symlink():
                    continue
                size = full_path.stat().st_size
            except Exception:
                continue

            if size > MAX_FILE_BYTES:
                continue

            try:
                with full_path.open("rb") as fh:
                    sample = fh.read(2048)
                if _looks_binary(sample):
                    continue
            except Exception:
                continue

            try:
                with full_path.open("r", encoding="utf-8", errors="ignore") as fh:
                    for lineno, line in enumerate(fh, start=1):
                        idx = line.lower().find(needle)
                        if idx == -1:
                            continue
                        rel = str(full_path.resolve().relative_to(root)).replace("\\", "/")
                        preview = (line.rstrip("\n")[:MAX_LINE_CHARS]).strip()
                        results.append(
                            {
                                "path": rel,
                                "line": lineno,
                                "col": idx + 1,
                                "preview": preview,
                            }
                        )
                        if len(results) >= lim:
                            return results
            except Exception:
                continue

    return results

