import json

from server import build_runner
from server import project_manager


def _project_root(name: str):
    root = project_manager.get_project_root(name)
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_detect_node_commands_with_preview_defaults():
    project_name = "detect-node-preview"
    root = _project_root(project_name)
    package_json = {
        "name": "detect-node-preview",
        "scripts": {"dev": "vite", "build": "vite build", "test": "vitest"},
        "devDependencies": {"vite": "^5.0.0"},
    }
    (root / "package.json").write_text(json.dumps(package_json), encoding="utf-8")

    detected = build_runner.detect_project_commands(project_name)
    assert "node" in detected["detected"]
    assert detected["build_cmd"] == "npm run build"
    assert detected["test_cmd"] == "npm test"
    assert detected["preview_cmd"] == "npm run dev"
    assert detected["preview_port"] == 5173


def test_detect_python_commands_with_preview_defaults():
    project_name = "detect-python-preview"
    root = _project_root(project_name)
    (root / "app.py").write_text("print('ok')\n", encoding="utf-8")

    detected = build_runner.detect_project_commands(project_name)
    assert "python" in detected["detected"]
    assert detected["test_cmd"] == "python -m pytest"
    assert detected["preview_cmd"] == "python app.py"
    assert detected["preview_port"] == 8000
