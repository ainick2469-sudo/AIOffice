from pathlib import Path

from server.agent_engine import _build_system


def test_agent_system_prompt_includes_active_branch():
    agent = {
        "id": "builder",
        "display_name": "Max",
        "permissions": "write",
        "system_prompt": "You build production-ready code.",
    }
    prompt = _build_system(
        agent=agent,
        channel="main",
        is_followup=False,
        project_root=Path(__file__).resolve().parents[1],
        project_name="demo-project",
        branch_name="feature/prompt-context",
        file_context="",
        assigned_tasks=[
            {
                "id": 42,
                "status": "backlog",
                "title": "Implement branch-aware flow",
                "priority": 2,
            }
        ],
        memory_entries=[],
    )

    assert "Current git branch: `feature/prompt-context`." in prompt
    assert "=== ASSIGNED TASKS (non-done) ===" in prompt
