import asyncio
import time

from server import agent_engine as engine
from server.database import init_db


def test_turn_policy_profiles():
    simple = engine._turn_policy_for_message("hey team")
    assert simple["complexity"] == "simple"
    assert simple["max_initial_agents"] == 2
    assert simple["max_followup_rounds"] == 0

    medium = engine._turn_policy_for_message(
        "What do you think about improving our release process this week?"
    )
    assert medium["complexity"] == "medium"
    assert medium["max_initial_agents"] == 3
    assert medium["max_followup_rounds"] == 1

    complex_text = (
        "We need to design and implement a backend build validation pipeline for our project, "
        "covering schema updates, API routing, deployment safety checks, rollback behavior, test "
        "gating, release diagnostics, monitoring hooks, operational runbooks, migration safeguards, "
        "CI quality gates, staging verification, release checklists, and automated rollback triggers "
        "while keeping developer experience strong across tooling and documentation quality."
    )
    complex_policy = engine._turn_policy_for_message(complex_text)
    assert complex_policy["complexity"] == "complex"
    assert complex_policy["max_initial_agents"] == 4
    assert complex_policy["max_followup_rounds"] == 2


def test_process_message_limits_initial_agent_count(monkeypatch):
    captured: dict[str, list[str]] = {}

    async def fake_route(_message: str):
        return ["builder", "reviewer", "qa", "architect", "critic", "spark"]

    async def fake_conversation_loop(
        channel: str,
        initial_agents: list[str],
        *,
        max_messages: int = engine.MAX_MESSAGES,
        build_loop: bool = False,
    ):
        _ = (max_messages, build_loop)
        captured[channel] = list(initial_agents)

    monkeypatch.setattr(engine, "route", fake_route)
    monkeypatch.setattr(engine, "_conversation_loop", fake_conversation_loop)

    async def scenario():
        await init_db()

        simple_channel = f"test-simple-{int(time.time())}"
        await engine.process_message(simple_channel, "hey team")
        await asyncio.sleep(0.02)
        assert len(captured[simple_channel]) == 2

        medium_channel = f"test-medium-{int(time.time())}"
        await engine.process_message(
            medium_channel,
            "Can we talk through a reasonable approach for this milestone?",
        )
        await asyncio.sleep(0.02)
        assert len(captured[medium_channel]) == 3

        complex_channel = f"test-complex-{int(time.time())}"
        await engine.process_message(
            complex_channel,
            (
                "Please help design and implement a robust architecture, build, test, and deployment "
                "strategy for this codebase with risk controls, error handling, release automation, "
                "migration safeguards, observability requirements, rollback plans, integration test "
                "coverage, performance budgets, and delivery checklists so we can safely ship "
                "production changes with repeatable operations."
            ),
        )
        await asyncio.sleep(0.02)
        assert len(captured[complex_channel]) == 4

    asyncio.run(scenario())
