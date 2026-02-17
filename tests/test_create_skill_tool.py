import asyncio

from fastapi.testclient import TestClient

from server import skills_loader
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_create_skill_endpoint_scaffolds_and_invokes(tmp_path, monkeypatch):
    monkeypatch.setattr(skills_loader, "SKILLS_ROOT", tmp_path / "skills")
    skills_loader._TOOL_REGISTRY.clear()
    skills_loader._SKILL_STATE.clear()

    client = TestClient(app)
    created = client.post(
        "/api/tools/create-skill",
        json={"name": "unit-skill"},
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload.get("ok") is True
    assert payload.get("skill", {}).get("skill") == "unit-skill"

    reloaded = client.post("/api/skills/reload")
    assert reloaded.status_code == 200
    assert "unit-skill-echo" in reloaded.json().get("loaded_tools", [])

    result = _run(
        skills_loader.invoke_tool(
            "unit-skill-echo",
            "hello",
            {"channel": "main", "agent_id": "tester"},
        )
    )
    assert result["ok"] is True
    assert "echo:hello" in result.get("output", "")
