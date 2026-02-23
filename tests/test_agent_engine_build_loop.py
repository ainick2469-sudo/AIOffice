import asyncio
import time

from server import agent_engine as engine


def _run(coro):
    return asyncio.run(coro)


async def _always_false(*_args, **_kwargs):
    return False


def test_process_message_bootstraps_build_loop(monkeypatch):
    channel = f"test-build-loop-{int(time.time())}"
    recorded: list[dict] = []
    created_tasks: list[dict] = []

    async def fake_auto_name(_channel: str):
        return None

    async def fake_project(_channel: str):
        return {"project": "ai-office", "path": "C:/AI_WORKSPACE/ai-office", "branch": "main"}

    async def fake_decompose(_message: str, _channel: str, _project: str):
        return [
            {
                "title": "Plan architecture",
                "description": "Define components",
                "assigned_to": "architect",
                "priority": 3,
                "status": "backlog",
            },
            {
                "title": "Implement feature",
                "description": "Write core files",
                "assigned_to": "builder",
                "priority": 3,
                "status": "backlog",
            },
            {
                "title": "Add tests",
                "description": "Verify behavior",
                "assigned_to": "qa",
                "priority": 2,
                "status": "backlog",
            },
        ]

    async def fake_create_task(task: dict, channel: str | None = None, project_name: str | None = None):
        row = dict(task)
        row["id"] = len(created_tasks) + 1
        row["channel"] = channel
        row["project_name"] = project_name
        created_tasks.append(row)
        return row

    async def fake_agents(active_only: bool = True):
        _ = active_only
        return [
            {"id": "architect", "active": True},
            {"id": "builder", "active": True},
            {"id": "codex", "active": True},
            {"id": "qa", "active": True},
        ]

    async def fake_emit_console_event(**_kwargs):
        return None

    async def fake_send_system_message(_channel: str, _content: str, msg_type: str = "system"):
        _ = msg_type
        return None

    async def fake_loop(channel: str, initial_agents: list[str], *, max_messages: int, build_loop: bool):
        recorded.append(
            {
                "channel": channel,
                "initial_agents": list(initial_agents),
                "max_messages": max_messages,
                "build_loop": build_loop,
            }
        )

    async def fake_broadcast(_channel: str, _payload: dict):
        return None

    for handler_name in (
        "_handle_project_command",
        "_handle_build_command",
        "_handle_work_command",
        "_handle_sprint_command",
        "_handle_git_command",
        "_handle_branch_merge_command",
        "_handle_export_command",
        "_handle_review_command",
        "_handle_warroom_command",
        "_handle_brainstorm_command",
        "_handle_oracle_command",
        "_handle_meeting_or_vote",
    ):
        monkeypatch.setattr(engine, handler_name, _always_false)

    monkeypatch.setattr(engine, "_auto_name_channel", fake_auto_name)
    monkeypatch.setattr(engine.project_manager, "get_active_project", fake_project)
    monkeypatch.setattr(engine.task_decomposer, "decompose_request", fake_decompose)
    monkeypatch.setattr(engine, "create_task_record", fake_create_task)
    monkeypatch.setattr(engine, "get_agents", fake_agents)
    monkeypatch.setattr(engine, "emit_console_event", fake_emit_console_event)
    monkeypatch.setattr(engine, "_send_system_message", fake_send_system_message)
    monkeypatch.setattr(engine, "_conversation_loop", fake_loop)
    monkeypatch.setattr(engine.manager, "broadcast", fake_broadcast)

    try:
        async def scenario():
            await engine.process_message(channel, "Build me a reliable API and test suite")
            await asyncio.sleep(0.05)

        _run(scenario())
        assert created_tasks
        assert recorded
        call = recorded[0]
        assert call["channel"] == channel
        assert call["build_loop"] is True
        assert call["max_messages"] == engine.MAX_BUILD_MESSAGES
        assert "builder" in call["initial_agents"]
        state = engine._build_loop_state(channel)
        assert state is not None
        assert len(state.get("task_ids") or []) == len(created_tasks)
        assert state.get("allowed_agents") == ["builder", "codex"]
    finally:
        engine._active.pop(channel, None)
        engine._msg_count.pop(channel, None)
        engine._channel_turn_policy.pop(channel, None)
        engine._user_interrupt.pop(channel, None)
        engine._clear_build_loop_state(channel)


def test_process_message_auto_creates_isolated_project(monkeypatch):
    channel = f"test-build-isolation-{int(time.time())}"
    created: list[str] = []

    async def fake_auto_name(_channel: str):
        return None

    async def fake_project(_channel: str):
        return {"project": "ai-office", "path": "C:/AI_WORKSPACE/ai-office", "branch": "main", "is_app_root": True}

    async def fake_create_project(name: str, template: str | None = None):
        _ = template
        created.append(name)
        return {"name": name}

    async def fake_switch_project(_channel: str, name: str):
        return {"project": name, "path": f"C:/workspaces/{name}", "branch": "main", "is_app_root": False}

    async def fake_decompose(_message: str, _channel: str, _project: str):
        return []

    async def fake_emit_console_event(**_kwargs):
        return None

    async def fake_send_system_message(_channel: str, _content: str, msg_type: str = "system"):
        _ = msg_type
        return None

    async def fake_loop(_channel: str, _initial_agents: list[str], *, max_messages: int, build_loop: bool):
        _ = (max_messages, build_loop)
        return None

    for handler_name in (
        "_handle_project_command",
        "_handle_build_command",
        "_handle_work_command",
        "_handle_sprint_command",
        "_handle_git_command",
        "_handle_branch_merge_command",
        "_handle_export_command",
        "_handle_review_command",
        "_handle_warroom_command",
        "_handle_brainstorm_command",
        "_handle_oracle_command",
        "_handle_meeting_or_vote",
    ):
        monkeypatch.setattr(engine, handler_name, _always_false)

    monkeypatch.setattr(engine, "_auto_name_channel", fake_auto_name)
    monkeypatch.setattr(engine.project_manager, "get_active_project", fake_project)
    monkeypatch.setattr(engine.project_manager, "create_project", fake_create_project)
    monkeypatch.setattr(engine.project_manager, "switch_project", fake_switch_project)
    monkeypatch.setattr(engine.task_decomposer, "_looks_action_request", lambda _message: True)
    monkeypatch.setattr(engine.task_decomposer, "decompose_request", fake_decompose)
    monkeypatch.setattr(engine, "emit_console_event", fake_emit_console_event)
    monkeypatch.setattr(engine, "_send_system_message", fake_send_system_message)
    monkeypatch.setattr(engine, "_conversation_loop", fake_loop)

    try:
        async def scenario():
            await engine.process_message(channel, "build a snake game")
            await asyncio.sleep(0.01)

        _run(scenario())
        assert created
        assert created[0].startswith("snake")
    finally:
        engine._active.pop(channel, None)
        engine._msg_count.pop(channel, None)
        engine._channel_turn_policy.pop(channel, None)
        engine._user_interrupt.pop(channel, None)
        engine._clear_build_loop_state(channel)
