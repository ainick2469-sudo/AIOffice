"""Canonical runtime configuration exports.

This module intentionally re-exports runtime path/environment helpers so new
code can import from `server.runtime_config` while older imports from
`server.runtime_paths` remain backward compatible.
"""

from .runtime_paths import (  # noqa: F401
    APP_NAME,
    APP_ROOT,
    AI_OFFICE_HOME,
    WORKSPACE_ROOT,
    PROJECTS_ROOT,
    DB_PATH,
    MEMORY_DIR,
    LOGS_DIR,
    ensure_runtime_dirs,
    runtime_path_prefix,
    build_runtime_env,
    executable_candidates,
    resolve_executable,
)

