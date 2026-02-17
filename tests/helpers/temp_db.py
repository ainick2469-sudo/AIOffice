"""Helpers for isolated pytest runtime paths."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def bootstrap_test_environment() -> dict[str, Path]:
    test_root = Path(tempfile.mkdtemp(prefix="ai-office-tests-")).resolve()
    test_home = test_root / "home"
    test_workspace = test_root / "projects"
    test_memory = test_root / "memory"
    test_db = test_home / "data" / "office-test.db"

    os.environ["AI_OFFICE_TESTING"] = "1"
    os.environ["AI_OFFICE_HOME"] = str(test_home)
    os.environ["AI_OFFICE_WORKSPACE_ROOT"] = str(test_workspace)
    os.environ["AI_OFFICE_PROJECTS_DIR"] = str(test_workspace)
    os.environ["AI_OFFICE_MEMORY_DIR"] = str(test_memory)
    os.environ["AI_OFFICE_DB_PATH"] = str(test_db)

    test_home.mkdir(parents=True, exist_ok=True)
    test_workspace.mkdir(parents=True, exist_ok=True)
    test_memory.mkdir(parents=True, exist_ok=True)
    test_db.parent.mkdir(parents=True, exist_ok=True)

    return {
        "root": test_root,
        "home": test_home,
        "workspace": test_workspace,
        "memory": test_memory,
        "db": test_db,
    }

