import asyncio

from server import tool_executor


def _run(coro):
    return asyncio.run(coro)


def test_write_denied_does_not_reinvoke_with_approved_true(monkeypatch):
    write_calls: list[bool] = []

    async def fake_get_agent(_agent_id):
        return {"id": "builder", "role": "builder"}

    async def fake_active_project(_channel):
        return {"project": "ai-office", "branch": "main"}

    async def fake_insert_message(**kwargs):
        return {"id": 1, **kwargs}

    async def fake_broadcast(_channel, _payload):
        return None

    async def fake_console_event(**_kwargs):
        return None

    async def fake_tool_write_file(_agent_id, _path, _content, approved=False, channel="main"):
        write_calls.append(bool(approved))
        return {"ok": False, "error": "policy denied"}

    monkeypatch.setattr(tool_executor, "get_agent", fake_get_agent)
    monkeypatch.setattr(tool_executor.project_manager, "get_active_project", fake_active_project)
    monkeypatch.setattr(tool_executor, "insert_message", fake_insert_message)
    monkeypatch.setattr(tool_executor.manager, "broadcast", fake_broadcast)
    monkeypatch.setattr(tool_executor, "emit_console_event", fake_console_event)
    monkeypatch.setattr(tool_executor, "tool_write_file", fake_tool_write_file)

    async def scenario():
        results = await tool_executor.execute_tool_calls(
            "builder",
            [{"type": "write", "path": "src/blocked.py", "content": "print('x')\n"}],
            "main",
        )
        assert results and results[0]["result"]["ok"] is False

    _run(scenario())
    assert write_calls == [False]


def test_write_needs_approval_then_runs_once_when_approved(monkeypatch):
    write_calls: list[bool] = []

    async def fake_get_agent(_agent_id):
        return {"id": "builder", "role": "builder"}

    async def fake_active_project(_channel):
        return {"project": "ai-office", "branch": "main"}

    async def fake_insert_message(**kwargs):
        return {"id": 2, **kwargs}

    async def fake_broadcast(_channel, _payload):
        return None

    async def fake_console_event(**_kwargs):
        return None

    async def fake_tool_write_file(_agent_id, _path, _content, approved=False, channel="main"):
        write_calls.append(bool(approved))
        if not approved:
            return {"status": "needs_approval", "request": {"id": "req-123"}}
        return {"ok": True, "action": "written", "size": 10, "diff": "+ok\n"}

    async def fake_wait_for_approval(_request_id, timeout_seconds=600):
        return True

    monkeypatch.setattr(tool_executor, "get_agent", fake_get_agent)
    monkeypatch.setattr(tool_executor.project_manager, "get_active_project", fake_active_project)
    monkeypatch.setattr(tool_executor, "insert_message", fake_insert_message)
    monkeypatch.setattr(tool_executor.manager, "broadcast", fake_broadcast)
    monkeypatch.setattr(tool_executor, "emit_console_event", fake_console_event)
    monkeypatch.setattr(tool_executor, "tool_write_file", fake_tool_write_file)
    monkeypatch.setattr(tool_executor, "wait_for_approval_response", fake_wait_for_approval)

    async def scenario():
        results = await tool_executor.execute_tool_calls(
            "builder",
            [{"type": "write", "path": "src/approved.py", "content": "print('ok')\n"}],
            "main",
        )
        assert results and results[0]["result"]["ok"] is True

    _run(scenario())
    assert write_calls == [False, True]


def test_manifest_paths_trigger_build_config_refresh():
    assert tool_executor._should_refresh_build_config("package.json") is True
    assert tool_executor._should_refresh_build_config("client/package-lock.json") is True
    assert tool_executor._should_refresh_build_config("apps/web/pyproject.toml") is True
    assert tool_executor._should_refresh_build_config("src/main.py") is False
