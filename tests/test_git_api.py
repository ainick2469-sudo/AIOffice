from fastapi.testclient import TestClient

from server.main import app


def test_git_endpoints_shape():
    client = TestClient(app)
    for endpoint in (
        "/api/projects/ai-office/git/status",
        "/api/projects/ai-office/git/log",
        "/api/projects/ai-office/git/diff",
    ):
        resp = client.get(endpoint)
        assert resp.status_code == 200
        payload = resp.json()
        assert "ok" in payload
        assert "exit_code" in payload
