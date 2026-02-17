"""Global pytest environment isolation for AI Office.

Ensures tests never write to a developer's real desktop app data.
"""

from __future__ import annotations

import atexit
import asyncio
import os
import shutil
from pathlib import Path

from helpers.temp_db import bootstrap_test_environment

_TEST_ENV = bootstrap_test_environment()
TEST_ROOT = _TEST_ENV["root"]
TEST_HOME = _TEST_ENV["home"]
TEST_PROJECTS = _TEST_ENV["workspace"]
TEST_MEMORY = _TEST_ENV["memory"]
TEST_DB = _TEST_ENV["db"]


def _assert_test_isolation() -> None:
    if os.environ.get("AI_OFFICE_TESTING") != "1":
        raise RuntimeError("AI_OFFICE_TESTING must be 1 during pytest runs.")
    db_path = Path(os.environ["AI_OFFICE_DB_PATH"]).resolve()
    memory_dir = Path(os.environ["AI_OFFICE_MEMORY_DIR"]).resolve()
    projects_dir = Path(os.environ["AI_OFFICE_PROJECTS_DIR"]).resolve()
    workspace_dir = Path(os.environ["AI_OFFICE_WORKSPACE_ROOT"]).resolve()
    if TEST_ROOT not in db_path.parents:
        raise RuntimeError(f"AI_OFFICE_DB_PATH escaped test root: {db_path}")
    if TEST_ROOT not in memory_dir.parents:
        raise RuntimeError(f"AI_OFFICE_MEMORY_DIR escaped test root: {memory_dir}")
    if TEST_ROOT not in projects_dir.parents:
        raise RuntimeError(f"AI_OFFICE_PROJECTS_DIR escaped test root: {projects_dir}")
    if TEST_ROOT not in workspace_dir.parents:
        raise RuntimeError(f"AI_OFFICE_WORKSPACE_ROOT escaped test root: {workspace_dir}")


def _bootstrap_test_runtime() -> None:
    _assert_test_isolation()
    from server.database import init_db

    asyncio.run(init_db())


_bootstrap_test_runtime()


def _cleanup_test_dirs():
    shutil.rmtree(TEST_ROOT, ignore_errors=True)


atexit.register(_cleanup_test_dirs)
