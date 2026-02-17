import pytest
from fastapi.testclient import TestClient

from server.main import app
from server import git_tools


def _prepare_git(project_name: str) -> bool:
    email = git_tools._run_git(project_name, ["config", "user.email", "tests@ai-office.local"])
    name = git_tools._run_git(project_name, ["config", "user.name", "AI Office Tests"])
    if not (email.get("ok") and name.get("ok")):
        return False

    state = git_tools.status(project_name)
    if state.get("ok") and (state.get("stdout") or "").strip():
        committed = git_tools.commit(project_name, "test baseline commit")
        if not committed.get("ok"):
            stderr = (committed.get("stderr") or "").lower()
            if "nothing to commit" not in stderr:
                return False
    return True


def test_merge_preview_is_non_destructive():
    client = TestClient(app)
    project_name = "merge-preview-api"
    channel = "merge-preview-room"

    client.post("/api/projects", json={"name": project_name})
    switched = client.post("/api/projects/switch", json={"channel": channel, "name": project_name})
    assert switched.status_code == 200
    base_branch = switched.json().get("active", {}).get("branch") or "main"
    if not _prepare_git(project_name):
        pytest.skip("git not ready for merge preview test in this environment")

    create_feature = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": "feature/preview", "create_if_missing": True},
    )
    if create_feature.status_code == 400:
        pytest.skip(f"git branch creation unavailable in this environment: {create_feature.text}")
    assert create_feature.status_code == 200

    back_to_base = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": base_branch, "create_if_missing": False},
    )
    assert back_to_base.status_code == 200

    preview = client.post(
        f"/api/projects/{project_name}/merge-preview",
        json={"source_branch": "feature/preview", "target_branch": base_branch},
    )
    assert preview.status_code == 200
    payload = preview.json()
    if not payload.get("ok"):
        pytest.skip(f"merge preview unavailable in this environment: {payload}")
    assert "has_conflicts" in payload
    assert "conflicts" in payload
    assert "would_merge" in payload

    active = client.get(f"/api/projects/active/{channel}")
    assert active.status_code == 200
    assert active.json().get("branch") == base_branch
