from server.tool_executor import parse_tool_calls, validate_tool_call_format


def test_write_requires_fenced_block():
    ok, reason = validate_tool_call_format({"type": "write_noblock", "path": "src/app.py"})
    assert ok is False
    assert "fenced" in reason.lower()


def test_create_skill_tool_format_is_valid():
    calls = parse_tool_calls("[TOOL:create-skill] demo-skill")
    assert calls
    assert calls[0]["type"] == "create_skill"

    ok, reason = validate_tool_call_format(calls[0])
    assert ok is True
    assert reason == ""


def test_plugin_tool_requires_name():
    ok, reason = validate_tool_call_format({"type": "plugin", "tool_name": "", "arg": "x"})
    assert ok is False
    assert "name" in reason.lower()
