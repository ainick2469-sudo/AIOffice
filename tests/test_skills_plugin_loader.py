import asyncio
import json

from server import skills_loader


def _run(coro):
    return asyncio.run(coro)


def test_skills_loader_discovers_and_invokes_tool(tmp_path, monkeypatch):
    skills_root = tmp_path / "skills"
    demo = skills_root / "demo-skill"
    demo.mkdir(parents=True, exist_ok=True)

    (demo / "manifest.json").write_text(
        json.dumps(
            {
                "name": "demo-skill",
                "entrypoint": "tools.py",
                "tools": [
                    {
                        "name": "demo-echo",
                        "function": "demo_echo",
                        "permissions": ["read"],
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (demo / "SKILL.md").write_text("# demo-skill\n", encoding="utf-8")
    (demo / "tools.py").write_text(
        "def demo_echo(arg: str, context: dict):\n"
        "    return {'ok': True, 'output': f'demo:{arg}', 'context': context}\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(skills_loader, "SKILLS_ROOT", skills_root)
    skills_loader._TOOL_REGISTRY.clear()
    skills_loader._SKILL_STATE.clear()

    summary = skills_loader.load_skills()
    assert summary["ok"] is True
    assert "demo-echo" in summary["loaded_tools"]

    invoked = _run(
        skills_loader.invoke_tool(
            "demo-echo",
            "ping",
            {"channel": "main", "agent_id": "tester"},
        )
    )
    assert invoked["ok"] is True
    assert invoked["skill"] == "demo-skill"
    assert "demo:ping" in invoked.get("output", "")
