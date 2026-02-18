from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from server.main import app


def test_oracle_search_scoped_to_active_project(tmp_path):
    client = TestClient(app)

    project_name = f"oracle-{uuid.uuid4().hex[:8]}"
    created = client.post("/api/projects", json={"name": project_name})
    assert created.status_code == 200
    assert created.json().get("ok") is True

    switched = client.post("/api/projects/switch", json={"channel": "main", "name": project_name})
    assert switched.status_code == 200
    assert switched.json().get("ok") is True

    active = switched.json()["active"]
    repo_root = Path(active["path"]).resolve()

    target = repo_root / "src" / "oracle_sentinel.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("hello oracle search\n", encoding="utf-8")

    resp = client.get(
        "/api/oracle/search",
        params={"channel": "main", "q": "oracle search", "limit": 20},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ok") is True
    assert any(item.get("path") == "src/oracle_sentinel.txt" for item in data.get("results", []))

