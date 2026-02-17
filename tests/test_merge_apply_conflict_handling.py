import pytest
from fastapi.testclient import TestClient

from server.main import app
from server import git_tools
from server.project_manager import get_project_root


def _configure_git_identity(project_name: str) -> bool:
    email = git_tools._run_git(project_name, ["config", "user.email", "tests@ai-office.local"])
    name = git_tools._run_git(project_name, ["config", "user.name", "AI Office Tests"])
    return bool(email.get("ok") and name.get("ok"))


def test_merge_apply_returns_structured_conflicts():
    client = TestClient(app)
    project_name = "merge-conflict-api"
    channel = "merge-conflict-room"

    client.post("/api/projects", json={"name": project_name})
    switched = client.post("/api/projects/switch", json={"channel": channel, "name": project_name})
    assert switched.status_code == 200
    base_branch = switched.json().get("active", {}).get("branch") or "main"

    if not _configure_git_identity(project_name):
        pytest.skip("git identity could not be configured in this environment")
    state = git_tools.status(project_name)
    if state.get("ok") and (state.get("stdout") or "").strip():
        baseline = git_tools.commit(project_name, "test baseline commit")
        if not baseline.get("ok"):
            pytest.skip(f"git baseline commit unavailable in this environment: {baseline.get('stderr') or baseline.get('error')}")

    create_feature = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": "feature/conflict", "create_if_missing": True},
    )
    if create_feature.status_code == 400:
        pytest.skip(f"git branch creation unavailable in this environment: {create_feature.text}")
    assert create_feature.status_code == 200

    root = get_project_root(project_name)
    conflict_file = root / "src" / "conflict.txt"
    conflict_file.parent.mkdir(parents=True, exist_ok=True)

    conflict_file.write_text("line from feature branch\n", encoding="utf-8")
    feature_commit = git_tools.commit(project_name, "feature branch change")
    if not feature_commit.get("ok"):
        pytest.skip(f"git commit unavailable in this environment: {feature_commit.get('stderr') or feature_commit.get('error')}")

    to_base = client.post(
        f"/api/projects/{project_name}/branches/switch",
        json={"channel": channel, "branch": base_branch, "create_if_missing": False},
    )
    assert to_base.status_code == 200

    conflict_file.parent.mkdir(parents=True, exist_ok=True)
    conflict_file.write_text("line from base branch\n", encoding="utf-8")
    base_commit = git_tools.commit(project_name, "base branch conflicting change")
    if not base_commit.get("ok"):
        pytest.skip(f"git commit unavailable in this environment: {base_commit.get('stderr') or base_commit.get('error')}")

    merged = client.post(
        f"/api/projects/{project_name}/merge-apply",
        json={"source_branch": "feature/conflict", "target_branch": base_branch},
    )
    assert merged.status_code == 200
    payload = merged.json()
    assert payload.get("ok") is False
    assert isinstance(payload.get("conflicts"), list)
    assert payload.get("conflicts")
