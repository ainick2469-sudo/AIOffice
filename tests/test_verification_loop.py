import asyncio

from server import verification_loop


def _run(coro):
    return asyncio.run(coro)


def _agent():
    return {"id": "builder", "display_name": "Max"}


def test_verification_loop_retries_then_passes(monkeypatch):
    events = {"fixes": 0, "agent_msgs": 0, "system_msgs": 0}
    build_results = iter(
        [
            {"ok": False, "exit_code": 1, "stderr": "syntax error", "command": "python -m py_compile src/main.py"},
            {"ok": True, "exit_code": 0, "stdout": "ok", "command": "python -m py_compile src/main.py"},
        ]
    )

    async def fake_active_project(_channel):
        return {"project": "verify-proj", "path": "."}

    monkeypatch.setattr(verification_loop.project_manager, "get_active_project", fake_active_project)
    monkeypatch.setattr(
        verification_loop.build_runner,
        "get_build_config",
        lambda _project: {"build_cmd": "python -m py_compile src/main.py", "test_cmd": ""},
    )
    monkeypatch.setattr(verification_loop.build_runner, "run_build", lambda _project, **_kwargs: next(build_results))

    async def noop_db(**_kwargs):
        return None

    async def noop_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(verification_loop.db, "log_build_result", noop_db)
    monkeypatch.setattr(verification_loop.db, "log_console_event", noop_db)
    monkeypatch.setattr(verification_loop.manager, "broadcast", noop_broadcast)

    async def send_system_message(_channel, _message, _msg_type):
        events["system_msgs"] += 1

    async def generate_fix_response(_agent, _channel):
        events["fixes"] += 1
        return "Applied fix."

    async def send_agent_message(_agent, _channel, _content):
        events["agent_msgs"] += 1

    def reset_agent_failure(_channel, _agent_id):
        return None

    async def maybe_escalate(_channel, _agent_id, _reason, _context):
        return False

    async def enter_war_room(_channel, _issue, _trigger):
        raise AssertionError("War room should not activate in retry-pass scenario.")

    async def exit_war_room(_channel, _reason, _resolved_by):
        return None

    result = _run(
        verification_loop.run_post_write_verification(
            agent=_agent(),
            channel="main",
            max_attempts=3,
            format_result=lambda stage, payload: f"{stage}:{payload.get('ok')}",
            send_system_message=send_system_message,
            generate_fix_response=generate_fix_response,
            send_agent_message=send_agent_message,
            reset_agent_failure=reset_agent_failure,
            maybe_escalate_to_nova=maybe_escalate,
            enter_war_room=enter_war_room,
            exit_war_room=exit_war_room,
            war_room_active=lambda _channel: False,
        )
    )

    assert result["ok"] is True
    assert result["stage"] == "build"
    assert events["fixes"] == 1
    assert events["agent_msgs"] == 1
    assert events["system_msgs"] >= 2


def test_verification_loop_escalates_after_repeated_failure(monkeypatch):
    state = {"entered_war_room": 0, "escalated": 0}

    async def fake_active_project(_channel):
        return {"project": "verify-fail-proj", "path": "."}

    monkeypatch.setattr(verification_loop.project_manager, "get_active_project", fake_active_project)
    monkeypatch.setattr(
        verification_loop.build_runner,
        "get_build_config",
        lambda _project: {"build_cmd": "python -m py_compile src/main.py", "test_cmd": ""},
    )
    monkeypatch.setattr(
        verification_loop.build_runner,
        "run_build",
        lambda _project, **_kwargs: {
            "ok": False,
            "exit_code": 1,
            "stderr": "still broken",
            "command": "python -m py_compile src/main.py",
        },
    )

    async def noop_db(**_kwargs):
        return None

    async def noop_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(verification_loop.db, "log_build_result", noop_db)
    monkeypatch.setattr(verification_loop.db, "log_console_event", noop_db)
    monkeypatch.setattr(verification_loop.manager, "broadcast", noop_broadcast)

    async def send_system_message(_channel, _message, _msg_type):
        return None

    async def generate_fix_response(_agent, _channel):
        return "Try another fix."

    async def send_agent_message(_agent, _channel, _content):
        return None

    def reset_agent_failure(_channel, _agent_id):
        return None

    async def maybe_escalate(_channel, _agent_id, _reason, _context):
        state["escalated"] += 1
        return True

    async def enter_war_room(_channel, _issue, _trigger):
        state["entered_war_room"] += 1

    async def exit_war_room(_channel, _reason, _resolved_by):
        return None

    result = _run(
        verification_loop.run_post_write_verification(
            agent=_agent(),
            channel="main",
            max_attempts=2,
            format_result=lambda stage, payload: f"{stage}:{payload.get('ok')}",
            send_system_message=send_system_message,
            generate_fix_response=generate_fix_response,
            send_agent_message=send_agent_message,
            reset_agent_failure=reset_agent_failure,
            maybe_escalate_to_nova=maybe_escalate,
            enter_war_room=enter_war_room,
            exit_war_room=exit_war_room,
            war_room_active=lambda _channel: False,
        )
    )

    assert result["ok"] is False
    assert result["stage"] == "build"
    assert state["entered_war_room"] == 1
    assert state["escalated"] == 1
