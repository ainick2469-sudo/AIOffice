"""Global pytest environment isolation for AI Office.

Ensures tests never write to a developer's real desktop app data.
"""

from __future__ import annotations

import atexit
import asyncio
import os
import shutil
import tempfile
from pathlib import Path

TEST_ROOT = Path(tempfile.mkdtemp(prefix="ai-office-tests-")).resolve()
TEST_HOME = TEST_ROOT / "home"
TEST_PROJECTS = TEST_ROOT / "projects"
TEST_MEMORY = TEST_ROOT / "memory"
TEST_DB = TEST_HOME / "data" / "office-test.db"

os.environ["AI_OFFICE_HOME"] = str(TEST_HOME)
os.environ["AI_OFFICE_PROJECTS_DIR"] = str(TEST_PROJECTS)
os.environ["AI_OFFICE_MEMORY_DIR"] = str(TEST_MEMORY)
os.environ["AI_OFFICE_DB_PATH"] = str(TEST_DB)

TEST_HOME.mkdir(parents=True, exist_ok=True)
TEST_PROJECTS.mkdir(parents=True, exist_ok=True)
TEST_MEMORY.mkdir(parents=True, exist_ok=True)
TEST_DB.parent.mkdir(parents=True, exist_ok=True)


def _assert_test_isolation() -> None:
    db_path = Path(os.environ["AI_OFFICE_DB_PATH"]).resolve()
    memory_dir = Path(os.environ["AI_OFFICE_MEMORY_DIR"]).resolve()
    projects_dir = Path(os.environ["AI_OFFICE_PROJECTS_DIR"]).resolve()
    if TEST_ROOT not in db_path.parents:
        raise RuntimeError(f"AI_OFFICE_DB_PATH escaped test root: {db_path}")
    if TEST_ROOT not in memory_dir.parents:
        raise RuntimeError(f"AI_OFFICE_MEMORY_DIR escaped test root: {memory_dir}")
    if TEST_ROOT not in projects_dir.parents:
        raise RuntimeError(f"AI_OFFICE_PROJECTS_DIR escaped test root: {projects_dir}")


def _bootstrap_test_runtime() -> None:
    _assert_test_isolation()
    from server.database import init_db

    asyncio.run(init_db())


_bootstrap_test_runtime()


def _cleanup_test_dirs():
    shutil.rmtree(TEST_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_dirs)
