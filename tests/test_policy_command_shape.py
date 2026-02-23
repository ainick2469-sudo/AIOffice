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


def test_quote_aware_shell_meta_detection():
    assert policy.find_unquoted_shell_meta('python -c "print(1;2)"') is None
    assert policy.find_unquoted_shell_meta("python -c print(1);") == ";"
    assert policy.find_unquoted_shell_meta('echo "a && b"') is None
    assert policy.find_unquoted_shell_meta("echo a && b") == "&&"


def test_safe_mode_allows_practical_dev_command_after_approval():
    project_name = "policy-safe-dev-cmd"
    _ensure_project(project_name)
    _run(db.set_project_autonomy_mode(project_name, "SAFE"))
    _run(
        db.set_permission_policy(
            "main",
            mode="ask",
            scopes=["read", "search", "run"],
            command_allowlist_profile="safe",
        )
    )

    decision = _run(
        policy.evaluate_tool_policy(
            channel="main",
            tool_type="run",
            agent_id="builder",
            command="mkdir build",
            target_path=".",
            approved=True,
        )
    )

    assert decision["allowed"] is True
    assert decision["mode"] == "SAFE"

