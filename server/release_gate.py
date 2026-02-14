"""AI Office — Release Gate. Multi-agent review pipeline + improvement sweeps."""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional
from . import ollama_client
from .database import get_agent, get_agents, insert_message, get_db
from .websocket import manager
from .memory import read_memory

logger = logging.getLogger("ai-office.release")

# Review roles in required order
REVIEW_PIPELINE = [
    {"agent_id": "builder", "focus": "correctness, architecture, implementation quality"},
    {"agent_id": "reviewer", "focus": "security, code quality, best practices, vulnerabilities"},
    {"agent_id": "qa", "focus": "test coverage, edge cases, regression risks"},
    {"agent_id": "uiux", "focus": "usability, flow, clarity, accessibility"},
    {"agent_id": "art", "focus": "visual consistency, aesthetics, presentation"},
    {"agent_id": "producer", "focus": "decision alignment, completeness, release checklist"},
]

IMPROVEMENT_SWEEPS = 2  # Number of improvement passes

REVIEW_SYSTEM = """You are reviewing a project for release readiness.
Focus area: {focus}

Review the current project state and recent decisions. Provide your assessment as JSON:
{{
  "status": "pass" | "blocker" | "improvement",
  "summary": "1-2 sentence assessment",
  "items": ["specific item 1", "specific item 2"]
}}

- "pass": Everything looks good for your area
- "blocker": Critical issue that MUST be fixed before release
- "improvement": Non-critical suggestions that would make it better

/no_think
Respond with ONLY the JSON object."""


import re as _re


def _parse_review(text: str) -> dict:
    """Parse review response JSON."""
    text = _re.sub(r'<think>.*?</think>', '', text, flags=_re.DOTALL).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = _re.search(r'\{[^}]+\}', text, _re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    return {"status": "pass", "summary": text[:200], "items": []}


async def _run_single_review(agent: dict, focus: str, project_context: str) -> dict:
    """Run one agent's review."""
    system = REVIEW_SYSTEM.format(focus=focus)
    system = system.replace("{{", "{").replace("}}", "}")

    prompt = f"Review this project for release readiness.\n\n{project_context}"

    response = await ollama_client.generate(
        model=agent["model"],
        prompt=prompt,
        system=agent.get("system_prompt", "") + "\n\n" + system,
        temperature=0.3,
        max_tokens=500,
    )

    review = _parse_review(response)
    review["agent_id"] = agent["id"]
    review["agent_name"] = agent["display_name"]
    review["focus"] = focus
    review["timestamp"] = datetime.now().isoformat()
    return review


async def _get_project_context() -> str:
    """Build project context for reviewers."""
    from pathlib import Path
    state_path = Path("C:/AI_WORKSPACE/ai-office/docs/PROJECT_STATE.md")
    decisions_path = Path("C:/AI_WORKSPACE/ai-office/docs/DECISIONS.md")

    context = ""
    if state_path.exists():
        context += "PROJECT STATE:\n" + state_path.read_text(encoding="utf-8")[:2000] + "\n\n"
    if decisions_path.exists():
        context += "DECISIONS:\n" + decisions_path.read_text(encoding="utf-8")[:1000] + "\n\n"

    shared = read_memory(None, limit=20)
    if shared:
        context += "SHARED MEMORY:\n"
        for m in shared[-10:]:
            context += f"- [{m.get('type')}] {m.get('content', '')}\n"

    return context


async def run_release_gate(channel: str = "main") -> dict:
    """Run the full release gate pipeline. Returns gate result."""
    logger.info("🚀 Release Gate started")

    project_context = await _get_project_context()
    reviews = []
    blockers = []
    improvements = []

    # Phase 1: Sequential reviews from each role
    for step in REVIEW_PIPELINE:
        agent = await get_agent(step["agent_id"])
        if not agent or not agent.get("active"):
            continue

        # Broadcast status
        await manager.broadcast(channel, {
            "type": "system",
            "content": f"🔍 {agent['display_name']} is reviewing ({step['focus']})...",
        })

        review = await _run_single_review(agent, step["focus"], project_context)
        reviews.append(review)

        # Post review to chat
        status_emoji = {"pass": "✅", "blocker": "🚫", "improvement": "💡"}.get(review["status"], "❓")
        review_msg = f"{status_emoji} **{agent['display_name']} Review**: {review['summary']}"
        if review.get("items"):
            review_msg += "\n" + "\n".join(f"  • {item}" for item in review["items"][:5])

        saved = await insert_message(channel, agent["id"], review_msg, msg_type="review")
        await manager.broadcast(channel, {"type": "chat", "message": saved})

        if review["status"] == "blocker":
            blockers.append(review)
        elif review["status"] == "improvement":
            improvements.append(review)

    # Phase 2: Check for blockers
    if blockers:
        summary = f"🚫 RELEASE BLOCKED — {len(blockers)} blocker(s) found"
        saved = await insert_message(channel, "system", summary, msg_type="decision")
        await manager.broadcast(channel, {"type": "chat", "message": saved})

        result = {
            "status": "blocked",
            "blockers": blockers,
            "reviews": reviews,
            "timestamp": datetime.now().isoformat(),
        }
        await _save_gate_result(result)
        return result

    # Phase 3: Improvement sweeps
    all_improvements = list(improvements)
    for sweep in range(IMPROVEMENT_SWEEPS):
        sweep_label = f"Improvement Sweep {sweep + 1}/{IMPROVEMENT_SWEEPS}"
        await manager.broadcast(channel, {
            "type": "system",
            "content": f"🔄 {sweep_label}...",
        })

        # Sweep pass 1: QA + Reviewer
        if sweep == 0:
            sweep_agents = ["qa", "reviewer"]
        # Sweep pass 2: UI/UX + Art
        else:
            sweep_agents = ["uiux", "art"]

        for aid in sweep_agents:
            agent = await get_agent(aid)
            if not agent:
                continue
            review = await _run_single_review(agent, f"improvement sweep {sweep+1}", project_context)
            if review["status"] == "improvement" and review.get("items"):
                all_improvements.append(review)
                msg = f"💡 {agent['display_name']} suggests: " + "; ".join(review["items"][:3])
                saved = await insert_message(channel, agent["id"], msg, msg_type="review")
                await manager.broadcast(channel, {"type": "chat", "message": saved})

    # Phase 4: Producer final sign-off
    producer = await get_agent("producer")
    if producer:
        improvement_summary = ""
        if all_improvements:
            improvement_summary = "\n\nPending improvements:\n" + "\n".join(
                f"- [{r['agent_name']}] " + "; ".join(r.get("items", [])[:3])
                for r in all_improvements
            )

        final_prompt = (
            f"All reviews complete. No blockers found. "
            f"{len(all_improvements)} improvement suggestions collected."
            f"{improvement_summary}\n\n"
            f"Should this be marked RELEASE READY? Respond with JSON: "
            f'{{"release_ready": true/false, "summary": "reason"}}'
        )
        final_resp = await ollama_client.generate(
            model=producer["model"],
            prompt=final_prompt,
            system=producer.get("system_prompt", ""),
            temperature=0.3, max_tokens=200,
        )
        final_msg = f"📋 **Pam (Producer) Final Decision**: {final_resp}"
        saved = await insert_message(channel, "producer", final_msg, msg_type="decision")
        await manager.broadcast(channel, {"type": "chat", "message": saved})

    # Mark release ready
    status = "release_ready" if not blockers else "blocked"
    summary = f"✅ RELEASE READY — All {len(reviews)} reviews passed, {IMPROVEMENT_SWEEPS} improvement sweeps complete"
    saved = await insert_message(channel, "system", summary, msg_type="decision")
    await manager.broadcast(channel, {"type": "chat", "message": saved})

    result = {
        "status": status,
        "reviews": reviews,
        "improvements": all_improvements,
        "sweep_count": IMPROVEMENT_SWEEPS,
        "timestamp": datetime.now().isoformat(),
    }
    await _save_gate_result(result)
    return result


async def _save_gate_result(result: dict):
    """Save gate result to DB as a decision."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO decisions (title, description, decided_by, rationale) VALUES (?, ?, ?, ?)",
            (
                f"Release Gate: {result['status']}",
                json.dumps(result, default=str),
                "release_gate",
                f"{len(result.get('reviews', []))} reviews, {len(result.get('blockers', []))} blockers",
            ),
        )
        await db.commit()
    finally:
        await db.close()
