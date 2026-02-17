import asyncio
import io
import json
import zipfile

from fastapi.testclient import TestClient

from server import database as db
from server.main import app


def _run(coro):
    return asyncio.run(coro)


def test_debug_bundle_exports_zip_with_redaction():
    async def seed():
        await db.log_console_event(
            channel="main",
            event_type="router_decision",
            source="test-suite",
            message="seed console",
            data={"note": "hello"},
        )
        await db.create_task_record(
            {
                "title": "Seed Task",
                "description": "Seed description",
                "status": "backlog",
                "created_by": "user",
                "priority": 2,
            },
            channel="main",
            project_name="ai-office",
        )

        conn = await db.get_db()
        try:
            await conn.execute(
                """INSERT INTO tool_logs (
                       agent_id, tool_type, command, args, output, exit_code, channel, approved_by
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "tester",
                    "run",
                    "python -c \"print('hi')\"",
                    json.dumps({"cmd": ["python", "-c", "print('hi')"]}),
                    "secret=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    0,
                    "main",
                    "user",
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

    _run(seed())
    client = TestClient(app)

    response = client.post(
        "/api/debug/bundle",
        json={"channel": "main", "minutes": 60, "include_prompts": False, "redact_secrets": True},
    )
    assert response.status_code == 200
    assert "application/zip" in response.headers.get("content-type", "")
    assert response.content

    zf = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(zf.namelist())
    assert "meta.json" in names
    assert "console_events.json" in names
    assert "tool_logs.json" in names
    assert "tasks.json" in names
    assert "processes.json" in names

    tool_logs = json.loads(zf.read("tool_logs.json").decode("utf-8"))
    combined = json.dumps(tool_logs)
    assert "sk-proj-" not in combined
    assert "[REDACTED]" in combined

