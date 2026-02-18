import io
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from server.main import app
from server.runtime_config import WORKSPACE_ROOT


def test_project_import_zip_extracts_into_channel_repo():
    client = TestClient(app)
    name = f"import-proj-{int(time.time())}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("repo-root/README.md", "# Imported Repo\n")
        zf.writestr("repo-root/src/main.py", "print('hello')\n")
    payload = buf.getvalue()

    resp = client.post(
        f"/api/projects/import?project_name={name}",
        files={"zip_file": ("repo.zip", payload, "application/zip")},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    assert data["project"] == name
    assert data["channel"] == f"proj-{name}"
    assert int(data.get("extracted_files") or 0) >= 2

    repo_root = Path(WORKSPACE_ROOT) / name / f"proj-{name}" / "repo"
    assert (repo_root / "README.md").exists()
    assert (repo_root / "src" / "main.py").exists()
