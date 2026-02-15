from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GENERATED_TOOL = ROOT / "tools" / "generated_tool_smoke.py"
sys.path.insert(0, str(ROOT))

from server import database as db
from server.tool_executor import execute_tool_calls, parse_tool_calls


async def _latest_task_title() -> str:
    conn = await db.get_db()
    try:
        row = await conn.execute("SELECT title FROM tasks ORDER BY id DESC LIMIT 1")
        result = await row.fetchone()
        return result["title"] if result else ""
    finally:
        await conn.close()


async def main() -> int:
    await db.init_db()
    failures: list[str] = []

    sample = (
        "[TOOL:read] README.md\n"
        "[TOOL:search] *.py\n"
        "[TOOL:run] @client npm -v\n"
        "[TOOL:write] tools/generated_tool_smoke.py\n"
        "```python\n"
        "print('generated smoke tool ok')\n"
        "```\n"
        "[TOOL:task] Tool smoke task | builder | 1\n"
    )

    calls = parse_tool_calls(sample)
    if len(calls) < 5:
        failures.append("parse_tool_calls_missing_entries")

    results = await execute_tool_calls("builder", calls, "main")
    by_type = {r.get("type"): r for r in results}

    for required in ("read", "search", "run", "write", "task"):
        if required not in by_type:
            failures.append(f"missing_result:{required}")

    run_result = by_type.get("run", {}).get("result", {})
    if run_result and run_result.get("ok") is not True:
        failures.append("run_tool_failed")

    write_result = by_type.get("write", {}).get("result", {})
    if write_result and write_result.get("ok") is not True:
        failures.append("write_tool_failed")

    if not GENERATED_TOOL.exists():
        failures.append("generated_tool_missing")

    latest_title = await _latest_task_title()
    if latest_title != "Tool smoke task":
        failures.append("task_tool_failed")

    if GENERATED_TOOL.exists():
        GENERATED_TOOL.unlink()

    if failures:
        print("TOOLCHAIN_SMOKE_FAIL")
        for item in failures:
            print(f"- {item}")
        return 1

    print("TOOLCHAIN_SMOKE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
