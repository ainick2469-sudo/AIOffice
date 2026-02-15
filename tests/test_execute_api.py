from fastapi.testclient import TestClient

from server.main import app


def test_execute_python_snippet():
    client = TestClient(app)
    resp = client.post(
        "/api/execute",
        json={"language": "python", "code": "print('ok-exec')"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["exit_code"] == 0
    assert "ok-exec" in payload["stdout"]
