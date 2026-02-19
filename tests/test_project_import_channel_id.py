import io
import time
import zipfile

from fastapi.testclient import TestClient

from server.main import app


def test_project_import_returns_channel_id_alias():
    client = TestClient(app)
    name = f"import-channel-id-{int(time.time())}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("demo/README.md", "# Demo\n")
    payload = buf.getvalue()

    resp = client.post(
        f"/api/projects/import?project_name={name}",
        files={"zip_file": ("demo.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["channel"] == f"proj-{name}"
    assert data["channel_id"] == f"proj-{name}"
