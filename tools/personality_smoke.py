"""Smoke checks for personality diversity + dissent guardrails."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import router_agent  # noqa: E402


def _must(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def _agent_map() -> dict[str, dict]:
    registry_path = ROOT / "agents" / "registry.json"
    data = json.loads(registry_path.read_text(encoding="utf-8"))
    agents = data.get("agents", [])
    return {a["id"]: a for a in agents}


def _check_registry_diversity(agent_by_id: dict[str, dict]):
    active_agents = [a for a in agent_by_id.values() if a.get("active", True)]
    _must(len(active_agents) >= 10, "Expected at least 10 active agents.")

    display_names = [a.get("display_name", "").strip() for a in active_agents]
    _must(len(display_names) == len(set(display_names)), "Duplicate display_name values found.")

    roles = [a.get("role", "").strip().lower() for a in active_agents]
    _must(len(set(roles)) >= 8, "Roles are not diverse enough (need at least 8 distinct roles).")

    for agent_id in ("reviewer", "sage", "codex"):
        prompt = agent_by_id[agent_id].get("system_prompt", "").lower()
        _must(
            any(word in prompt for word in ("dissent", "disagree", "challenge", "call it out")),
            f"{agent_id} prompt is missing explicit dissent language.",
        )

    for required in ("ops", "scribe", "critic"):
        _must(required in agent_by_id, f"Expected staff member missing: {required}")


def _check_router_guardrails() -> tuple[list[str], list[str]]:
    risky_message = "Let's just ship now, skip tests, and disable auth until later."
    risky_panel = router_agent._ensure_diverse_panel(  # pylint: disable=protected-access
        risky_message,
        router_agent._keyword_route(risky_message),  # pylint: disable=protected-access
    )
    _must(len(risky_panel) >= 2, "Risky panel has too few agents.")
    _must(len(risky_panel) <= 4, "Risky panel has too many agents.")
    _must(any(a in risky_panel for a in ("reviewer", "sage")), "Risky panel missing dissent voice.")
    _must("codex" in risky_panel, "Risky panel missing codex implementation check.")

    decision_message = "We need to decide and sign off on the final launch approach."
    decision_panel = router_agent._ensure_diverse_panel(  # pylint: disable=protected-access
        decision_message,
        router_agent._keyword_route(decision_message),  # pylint: disable=protected-access
    )
    _must("director" in decision_panel, "Decision panel missing director.")
    _must(any(a in decision_panel for a in ("reviewer", "sage")), "Decision panel missing dissent-capable agent.")
    return risky_panel, decision_panel


def main():
    agent_by_id = _agent_map()
    _check_registry_diversity(agent_by_id)
    risky_panel, decision_panel = _check_router_guardrails()
    print(f"Risky message panel: {risky_panel}")
    print(f"Decision message panel: {decision_panel}")
    print("PASS personality smoke")


if __name__ == "__main__":
    main()
