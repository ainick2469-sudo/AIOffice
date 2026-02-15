from server import build_runner


def test_build_config_roundtrip_ai_office():
    original = build_runner.get_build_config("ai-office")
    updated = build_runner.set_build_config(
        "ai-office",
        {"build_cmd": "python -V", "test_cmd": "python -V", "run_cmd": "python -V"},
    )
    assert updated["build_cmd"] == "python -V"
    assert updated["test_cmd"] == "python -V"
    assert updated["run_cmd"] == "python -V"

    loaded = build_runner.get_build_config("ai-office")
    assert loaded["build_cmd"] == "python -V"
    assert loaded["test_cmd"] == "python -V"
    assert loaded["run_cmd"] == "python -V"

    # Restore prior local config to avoid test side effects.
    build_runner.set_build_config(
        "ai-office",
        {
            "build_cmd": original.get("build_cmd", ""),
            "test_cmd": original.get("test_cmd", ""),
            "run_cmd": original.get("run_cmd", ""),
        },
    )
