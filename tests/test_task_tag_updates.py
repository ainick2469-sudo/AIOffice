import asyncio

from server import database as db
from server.tool_executor import parse_tool_calls


def test_parse_task_tags():
    text = "[TASK:start] #12\n[TASK:done] #12 - finished\n[TASK:blocked] #13 - waiting on API key"
    calls = parse_tool_calls(text)
    tags = [c for c in calls if c["type"] == "task_tag"]
    assert len(tags) == 3
    assert tags[0]["status"] == "start"
    assert tags[1]["status"] == "done"
    assert tags[2]["status"] == "blocked"


def test_update_task_from_tag_roundtrip():
    async def _run():
        await db.init_db()
        conn = await db.get_db()
        try:
            cursor = await conn.execute(
                "INSERT INTO tasks (title, status, assigned_to, priority) VALUES (?, ?, ?, ?)",
                ("Task tag test", "backlog", "builder", 1),
            )
            await conn.commit()
            task_id = cursor.lastrowid
        finally:
            await conn.close()

        updated = await db.update_task_from_tag(task_id, "blocked", "builder", "waiting for dependency")
        assert updated is not None
        assert updated["status"] == "blocked"

    asyncio.run(_run())
