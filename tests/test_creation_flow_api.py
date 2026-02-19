from fastapi.testclient import TestClient

from server.main import app


def test_creation_draft_round_trip_and_no_project_side_effects():
    client = TestClient(app)
    before = client.get("/api/projects")
    assert before.status_code == 200, before.text
    before_count = len(before.json().get("projects") or [])

    seed_prompt = "Build me a snake game.\nInclude keyboard controls and score tracking."
    created = client.post(
        "/api/creation/draft",
        json={
            "seed_prompt": seed_prompt,
            "template_id": "react",
            "project_name": "snake-office",
            "stack_hint": "react-web",
            "phase": "DISCUSS",
            "brainstorm_messages": [{"role": "user", "content": seed_prompt}],
        },
    )
    assert created.status_code == 200, created.text
    payload = created.json()
    draft_id = payload["draft_id"]
    assert payload["seed_prompt"] == seed_prompt
    assert payload["phase"] == "DISCUSS"

    fetched = client.get(f"/api/creation/draft/{draft_id}")
    assert fetched.status_code == 200, fetched.text
    fetched_payload = fetched.json()
    assert fetched_payload["seed_prompt"] == seed_prompt
    assert fetched_payload["project_name"] == "snake-office"

    updated = client.put(
        f"/api/creation/draft/{draft_id}",
        json={
            "phase": "READY_TO_BUILD",
            "spec_draft": "# Spec\n\n## Goal\nShip snake game.\n",
        },
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["phase"] == "READY_TO_BUILD"
    assert "Ship snake game." in updated_payload["spec_draft"]

    after = client.get("/api/projects")
    assert after.status_code == 200, after.text
    after_count = len(after.json().get("projects") or [])
    assert after_count == before_count


def test_creation_brainstorm_and_spec_generation():
    client = TestClient(app)
    seed_prompt = "Make a beginner-friendly to-do app with reminders."

    brainstorm = client.post(
        "/api/creation/brainstorm",
        json={
            "seed_prompt": seed_prompt,
            "template_id": "react",
            "project_name": "todo-beginner",
            "stack_hint": "react-web",
        },
    )
    assert brainstorm.status_code == 200, brainstorm.text
    brainstorm_payload = brainstorm.json()
    assert brainstorm_payload["scope"]
    assert isinstance(brainstorm_payload.get("clarifying_questions"), list)
    assert isinstance(brainstorm_payload.get("risks"), list)
    assert brainstorm_payload.get("suggested_stack")

    spec = client.post(
        "/api/creation/spec",
        json={
            "seed_prompt": seed_prompt,
            "template_id": "react",
            "project_name": "todo-beginner",
            "stack_hint": "react-web",
            "brainstorm": brainstorm_payload,
        },
    )
    assert spec.status_code == 200, spec.text
    spec_payload = spec.json()
    markdown = spec_payload.get("spec_markdown") or ""
    assert "## Goal" in markdown
    assert "## Milestones" in markdown
    assert "## Definition of Done" in markdown
    assert "to-do app" in markdown.lower()
