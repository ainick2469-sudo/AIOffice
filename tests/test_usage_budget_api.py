import asyncio
import time
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from server.main import app
from server import database as db
from server import agent_engine


def test_usage_budget_threshold_summary():
    client = TestClient(app)
    channel = f"budget-test-{int(time.time())}"
    project = "ai-office"

    previous = asyncio.run(db.get_setting("api_budget_usd"))
    try:
        put_budget = client.put("/api/usage/budget", json={"budget_usd": 1.0})
        assert put_budget.status_code == 200
        assert float(put_budget.json()["budget_usd"]) == 1.0

        asyncio.run(
            db.log_api_usage(
                provider="openai",
                model="gpt-4o-mini",
                prompt_tokens=1000,
                completion_tokens=1000,
                total_tokens=2000,
                estimated_cost=1.2,
                channel=channel,
                project_name=project,
            )
        )

        summary = client.get(f"/api/usage/summary?channel={channel}&project={project}")
        assert summary.status_code == 200
        payload = summary.json()
        assert payload["budget_usd"] == 1.0
        assert payload["budget_warning"] is True
        assert payload["budget_exceeded"] is True
        assert payload["total_estimated_cost"] >= 1.2
    finally:
        restored = previous if previous is not None else "0"
        asyncio.run(db.set_setting("api_budget_usd", restored))


def test_budget_exceeded_blocks_hosted_generation():
    channel = f"budget-stop-{int(time.time())}"
    previous = asyncio.run(db.get_setting("api_budget_usd"))

    async def _run():
        await db.set_setting("api_budget_usd", "0.5")
        await db.log_api_usage(
            provider="openai",
            model="gpt-4o-mini",
            prompt_tokens=1000,
            completion_tokens=1000,
            total_tokens=2000,
            estimated_cost=0.6,
            channel=channel,
            project_name="ai-office",
        )

        agent = {
            "id": "codex",
            "display_name": "Codex",
            "backend": "openai",
            "model": "gpt-4o-mini",
            "permissions": "read",
            "system_prompt": "Test prompt",
        }

        with (
            patch("server.agent_engine._build_context", new=AsyncMock(return_value="User: hi")),
            patch("server.agent_engine.project_manager.get_active_project", new=AsyncMock(return_value={
                "project": "ai-office",
                "path": "C:/AI_WORKSPACE/ai-office",
                "is_app_root": True,
            })),
            patch("server.agent_engine._build_file_context", new=AsyncMock(return_value="")),
            patch("server.agent_engine.get_tasks_for_agent", new=AsyncMock(return_value=[])),
            patch("server.agent_engine.get_messages", new=AsyncMock(return_value=[{"sender": "user", "content": "hello"}])),
            patch("server.agent_engine.openai_adapter.generate", new=AsyncMock(return_value="should-not-run")) as mocked_openai,
        ):
            response = await agent_engine._generate(agent, channel)
            assert response is not None
            assert "API budget cap reached" in response
            assert mocked_openai.await_count == 0

    try:
        asyncio.run(_run())
    finally:
        restored = previous if previous is not None else "0"
        asyncio.run(db.set_setting("api_budget_usd", restored))
