import asyncio

from server import database as db
from server import policy
from server import project_manager as pm


def _run(coro):
    return asyncio.run(coro)


def _ensure_project(name: str):
    try:
        _run(pm.create_project(name))
    except ValueError:
        pass
    _run(pm.switch_project("main", name))


def test_safe_mode_requires_approval_for_mutating_run():
    name = "autonomy-safe"
    _ensure_project(name)
    _run(db.set_permission_policy("main", mode="ask"))
    _run(db.set_project_autonomy_mode(name, "SAFE"))

    decision = _run(
        policy.evaluate_tool_policy(
            channel="main",
            tool_type="run",
            agent_id="builder",
            command="python -m py_compile src/main.py",
            target_path=".",
            approved=False,
        )
    )

    assert decision["allowed"] is False
    assert decision["requires_approval"] is True
    assert decision["mode"] == "SAFE"


def test_trusted_mode_allows_valid_command_without_per_call_approval():
    name = "autonomy-trusted"
    _ensure_project(name)
    _run(db.set_permission_policy("main", mode="trusted"))
    _run(db.set_project_autonomy_mode(name, "TRUSTED"))

    decision = _run(
        policy.evaluate_tool_policy(
            channel="main",
            tool_type="run",
            agent_id="builder",
            command="python -m py_compile src/main.py",
            target_path=".",
            approved=False,
        )
    )

    assert decision["allowed"] is True
    assert decision["mode"] == "TRUSTED"
    assert decision["reason"] == "allowed"


def test_policy_blocks_dangerous_command_and_path_escape():
    name = "autonomy-guardrails"
    _ensure_project(name)
    _run(db.set_permission_policy("main", mode="trusted"))
    _run(db.set_project_autonomy_mode(name, "ELEVATED"))

    blocked_cmd = _run(
        policy.evaluate_tool_policy(
            channel="main",
            tool_type="run",
            agent_id="builder",
            command="rm -rf src",
            target_path=".",
            approved=True,
        )
    )
    assert blocked_cmd["allowed"] is False

    blocked_path = _run(
        policy.evaluate_tool_policy(
            channel="main",
            tool_type="write",
            agent_id="builder",
            target_path="..\\outside.txt",
            approved=True,
        )
    )
    assert blocked_path["allowed"] is False
    assert "escapes" in blocked_path["reason"].lower()
