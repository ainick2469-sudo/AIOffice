import asyncio

from server import task_decomposer


def _run(coro):
    return asyncio.run(coro)


def test_decompose_request_returns_actionable_tasks_for_build_prompt():
    tasks = _run(
        task_decomposer.decompose_request(
            "Build a React todo app with authentication, tests, and deployment checks.",
            channel="main",
            project_name="ai-office",
        )
    )
    assert 3 <= len(tasks) <= 8
    assert any("Scaffold implementation baseline" in task["title"] for task in tasks)
    assert any(task.get("assigned_to") == "qa" for task in tasks)


def test_decompose_request_ignores_discussion_only_prompt():
    tasks = _run(
        task_decomposer.decompose_request(
            "Can we brainstorm ideas for a product name and discuss possible options?",
            channel="main",
            project_name="ai-office",
        )
    )
    assert tasks == []
