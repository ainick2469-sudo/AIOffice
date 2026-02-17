from server import memory


def test_project_scoped_memory_is_isolated():
    memory.write_memory(
        None,
        {"type": "decision", "content": "Use sqlite for local metadata.", "timestamp": "2026-02-17T01:00:00"},
        project_name="proj-a",
    )
    memory.write_memory(
        None,
        {"type": "decision", "content": "Use postgres for analytics.", "timestamp": "2026-02-17T01:01:00"},
        project_name="proj-b",
    )

    a_entries = memory.read_memory(None, limit=50, project_name="proj-a")
    b_entries = memory.read_memory(None, limit=50, project_name="proj-b")

    a_text = " ".join(entry.get("content", "").lower() for entry in a_entries)
    b_text = " ".join(entry.get("content", "").lower() for entry in b_entries)

    assert "sqlite" in a_text
    assert "postgres" not in a_text
    assert "postgres" in b_text
    assert "sqlite" not in b_text


def test_known_context_uses_project_specific_search():
    memory.write_memory(
        "architect",
        {"type": "fact", "content": "Router retry limit is 3.", "timestamp": "2026-02-17T02:00:00"},
        project_name="proj-context",
    )
    memory.write_memory(
        "architect",
        {"type": "fact", "content": "Payments API timeout is 10 seconds.", "timestamp": "2026-02-17T02:01:00"},
        project_name="other-context",
    )

    context = memory.get_known_context("proj-context", "architect", query_hint="router retry limit", limit=10)
    joined = " ".join(item.get("content", "").lower() for item in context)

    assert "router retry limit is 3" in joined
    assert "payments api timeout" not in joined
