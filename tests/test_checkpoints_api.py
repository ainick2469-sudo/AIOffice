from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from server.main import app


def test_checkpoints_create_list_restore_delete(tmp_path):
    client = TestClient(app)

    project_name = f"cp-{uuid.uuid4().hex[:8]}"
    create = client.post("/api/projects", json={"name": project_name})
    assert create.status_code == 200
    payload = create.json()
    assert payload.get("ok") is True

    project = payload["project"]
    project_root = Path(project["path"]).resolve()
    readme = project_root / "README.md"
    assert readme.exists()

    # Create initial checkpoint.
    cp1 = client.post(
        f"/api/projects/{project_name}/checkpoints",
        json={"name": "initial", "note": "first"},
    )
    assert cp1.status_code == 200
    cp1_payload = cp1.json()
    assert cp1_payload.get("ok") is True
    cp1_id = cp1_payload["checkpoint"]["id"]
    assert isinstance(cp1_id, str) and cp1_id.startswith("checkpoint/")

    listed = client.get(f"/api/projects/{project_name}/checkpoints")
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert listed_payload.get("ok") is True
    ids = [item.get("id") for item in listed_payload.get("checkpoints", [])]
    assert cp1_id in ids

    # Modify a tracked file, checkpoint again (commits dirty state).
    original = readme.read_text(encoding="utf-8")
    readme.write_text(original + "\ncheckpoint-change\n", encoding="utf-8")

    cp2 = client.post(
        f"/api/projects/{project_name}/checkpoints",
        json={"name": "changed"},
    )
    assert cp2.status_code == 200
    assert cp2.json().get("ok") is True
    assert "checkpoint" in cp2.json()

    # Restore requires explicit confirmation text.
    denied = client.post(
        f"/api/projects/{project_name}/checkpoints/restore",
        json={"checkpoint_id": cp1_id, "confirm": "nope"},
    )
    assert denied.status_code == 200
    assert denied.json().get("ok") is False

    restored = client.post(
        f"/api/projects/{project_name}/checkpoints/restore",
        json={"checkpoint_id": cp1_id, "confirm": "RESTORE"},
    )
    assert restored.status_code == 200
    assert restored.json().get("ok") is True
    assert readme.read_text(encoding="utf-8") == original

    deleted = client.delete(
        f"/api/projects/{project_name}/checkpoints/{cp1_id.replace('/', '%2F')}"
    )
    assert deleted.status_code == 200
    assert deleted.json().get("ok") is True

