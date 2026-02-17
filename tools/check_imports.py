from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

print(f"Testing imports from: {ROOT}")

modules = [
    "database",
    "models",
    "tool_executor",
    "routes_api",
    "agent_engine",
    "build_runner",
    "project_manager",
]

for name in modules:
    try:
        __import__(f"server.{name}")
        print(f"  {name}.py: OK")
    except Exception as exc:
        print(f"  {name}.py: FAIL - {exc}")

print("\nDone.")
