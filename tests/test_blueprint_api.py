from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from server.main import app


def test_blueprint_regenerate_and_get_current():
    client = TestClient(app)

    project_name = f"bp-{uuid.uuid4().hex[:8]}"
    created = client.post("/api/projects", json={"name": project_name})
    assert created.status_code == 200
    assert created.json().get("ok") is True

    switched = client.post("/api/projects/switch", json={"channel": "main", "name": project_name})
    assert switched.status_code == 200
    assert switched.json().get("ok") is True

    spec_md = (
        "# Build Spec\n\n"
        "## Modules\n"
        "- API: FastAPI routes\n"
        "- UI: React app\n\n"
        "## Data Flow\n"
        "- UI -> API\n"
    )
    saved = client.post("/api/spec/current", json={"channel": "main", "spec_md": spec_md})
    assert saved.status_code == 200
    assert saved.json().get("ok") is True

    regen = client.post("/api/blueprint/regenerate", params={"channel": "main"})
    assert regen.status_code == 200
    regen_payload = regen.json()
    assert regen_payload.get("ok") is True
    bp = regen_payload.get("blueprint") or {}
    assert isinstance(bp.get("nodes"), list)
    assert len(bp.get("nodes")) >= 2

    current = client.get("/api/blueprint/current", params={"channel": "main"})
    assert current.status_code == 200
    current_payload = current.json()
    assert current_payload.get("ok") is True
    current_bp = current_payload.get("blueprint") or {}
    assert isinstance(current_bp.get("nodes"), list)
    assert len(current_bp.get("nodes")) >= 2

