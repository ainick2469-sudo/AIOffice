"""Segment 3 deterministic E2E runner for calculator project flow."""

from __future__ import annotations

import asyncio
import sqlite3
import time
from pathlib import Path

from server import build_runner, ollama_client, project_manager
from server.agent_engine import get_conversation_status, process_message
from server.database import DB_PATH, init_db, insert_message

ROOT = Path(__file__).resolve().parents[1]

PROJECT_NAME = "test-calculator"
CHANNEL = "main"
PROMPT = (
    "Team, build a Python calculator with add/subtract/multiply/divide. "
    "Max write the code, Quinn write tests."
)


def _project_root() -> Path:
    return project_manager.get_project_root(PROJECT_NAME)


def _write_placeholder_test():
    root = _project_root()
    tests_dir = root / "tests"
    tests_dir.mkdir(parents=True, exist_ok=True)
    (tests_dir / "test_placeholder.py").write_text(
        "def test_placeholder():\n"
        "    assert True\n",
        encoding="utf-8",
    )


def _log_failures_md() -> Path:
    out = ROOT / "tests" / "e2e_test_log.md"
    out.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        "# Segment 3 E2E Test Log",
        "",
        f"- Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- Project: `{PROJECT_NAME}`",
        f"- Prompt: `{PROMPT}`",
        "",
        "## Failure Log",
    ]

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT stage, success, exit_code, summary, created_at
            FROM build_results
            WHERE project_name = ?
            ORDER BY id
            """,
            (PROJECT_NAME,),
        ).fetchall()
    finally:
        conn.close()

    failures = [row for row in rows if int(row["success"] or 0) == 0]
    if not failures:
        lines.append("- No failures were recorded in `build_results` for this run.")
    else:
        for row in failures:
            lines.append(
                f"- [{row['created_at']}] stage=`{row['stage']}` exit={row['exit_code']} summary={row['summary']}"
            )

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


async def _ensure_project():
    try:
        first = await project_manager.delete_project(PROJECT_NAME)
        if first.get("requires_confirmation"):
            await project_manager.delete_project(PROJECT_NAME, confirm_token=first["confirm_token"])
    except Exception:
        pass

    await project_manager.create_project(PROJECT_NAME)
    await project_manager.switch_project(CHANNEL, PROJECT_NAME)
    _write_placeholder_test()

    build_runner.set_build_config(
        PROJECT_NAME,
        {
            "build_cmd": "python -m py_compile main.py",
            "test_cmd": "python -m pytest tests/ -v",
            "run_cmd": "python main.py",
        },
    )


async def _run_chat_build():
    original_generate = ollama_client.generate

    async def fake_generate(*args, **kwargs):
        system = str(kwargs.get("system", "") or "")
        prompt = str(kwargs.get("prompt", "") or "")
        if "Respond ONLY with JSON" in system:
            return '{"agents":["builder","qa"]}'
        if "Now respond as Max" in prompt:
            return (
                "[TOOL:write] main.py\n"
                "```python\n"
                "def add(a, b):\n"
                "    return a + b\n\n"
                "def subtract(a, b):\n"
                "    return a - b\n\n"
                "def multiply(a, b):\n"
                "    return a * b\n\n"
                "def divide(a, b):\n"
                "    if b == 0:\n"
                "        raise ValueError('Cannot divide by zero')\n"
                "    return a / b\n\n"
                "if __name__ == '__main__':\n"
                "    print('Calculator ready')\n"
                "```\n"
            )
        if "Now respond as Quinn" in prompt:
            return (
                "[TOOL:write] tests/test_calculator.py\n"
                "```python\n"
                "import pytest\n"
                "from main import add, subtract, multiply, divide\n\n"
                "def test_add():\n"
                "    assert add(2, 3) == 5\n\n"
                "def test_subtract():\n"
                "    assert subtract(7, 4) == 3\n\n"
                "def test_multiply():\n"
                "    assert multiply(6, 3) == 18\n\n"
                "def test_divide():\n"
                "    assert divide(8, 2) == 4\n\n"
                "def test_divide_by_zero():\n"
                "    with pytest.raises(ValueError):\n"
                "        divide(1, 0)\n"
                "```\n"
            )
        if "=== FOLLOWUP RULES ===" in system:
            return "PASS"
        return "PASS"

    ollama_client.generate = fake_generate
    try:
        await insert_message(channel=CHANNEL, sender="user", content=PROMPT, msg_type="message")
        await process_message(CHANNEL, PROMPT)

        saw_active = False
        for _ in range(45):
            status = get_conversation_status(CHANNEL)
            if status.get("active"):
                saw_active = True
            if saw_active and not status.get("active"):
                break
            await asyncio.sleep(1)
    finally:
        ollama_client.generate = original_generate


async def main():
    await init_db()
    await _ensure_project()
    await _run_chat_build()

    build_result = build_runner.run_build(PROJECT_NAME)
    test_result = build_runner.run_test(PROJECT_NAME)

    log_path = _log_failures_md()
    print("E2E_LOG", log_path)
    print("FINAL_BUILD_OK", build_result.get("ok"))
    print("FINAL_TEST_OK", test_result.get("ok"))
    if not build_result.get("ok"):
        print("FINAL_BUILD_ERROR", build_result.get("error") or build_result.get("stderr"))
    if not test_result.get("ok"):
        print("FINAL_TEST_ERROR", test_result.get("error") or test_result.get("stderr"))


if __name__ == "__main__":
    asyncio.run(main())
