"""Project build/test/run configuration and execution helpers."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Optional

from .project_manager import APP_ROOT, get_project_root
from .runtime_paths import build_runtime_env

CONFIG_FILE = ".ai-office/config.json"
DEFAULT_TIMEOUT_SECONDS = 180

_latest_results: dict[str, dict] = {}


def _runtime_env() -> dict:
    return build_runtime_env()


def _project_root(project_name: str) -> Path:
    if project_name == "ai-office":
        return APP_ROOT
    return get_project_root(project_name)


def _config_path(project_name: str) -> Path:
    return _project_root(project_name) / CONFIG_FILE


def get_build_config(project_name: str) -> dict:
    path = _config_path(project_name)
    if not path.exists():
        return {"build_cmd": "", "test_cmd": "", "run_cmd": "", "detected": {}, "manual_overrides": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"build_cmd": "", "test_cmd": "", "run_cmd": "", "detected": {}, "manual_overrides": []}
    data.setdefault("build_cmd", "")
    data.setdefault("test_cmd", "")
    data.setdefault("run_cmd", "")
    data.setdefault("detected", {})
    data.setdefault("manual_overrides", [])
    return data


def set_build_config(project_name: str, updates: dict) -> dict:
    root = _project_root(project_name)
    if not root.exists():
        raise ValueError("Project does not exist.")

    path = _config_path(project_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    current = get_build_config(project_name)

    manual_overrides = set(current.get("manual_overrides", []))
    for key in ("build_cmd", "test_cmd", "run_cmd"):
        if key in updates and updates[key] is not None:
            current[key] = str(updates[key]).strip()
            manual_overrides.add(key)

    if "detected" in updates and isinstance(updates["detected"], dict):
        current["detected"] = updates["detected"]

    current["manual_overrides"] = sorted(manual_overrides)
    current["updated_at"] = int(time.time())
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current


def _detect_node(root: Path) -> Optional[dict]:
    package = root / "package.json"
    if not package.exists():
        return None
    build = "npm run build"
    test = "npm test"
    run = "npm run dev"
    try:
        data = json.loads(package.read_text(encoding="utf-8"))
        scripts = (data.get("scripts") or {}) if isinstance(data, dict) else {}
        if "build" not in scripts:
            build = ""
        if "test" not in scripts:
            test = ""
        if "dev" not in scripts and "start" in scripts:
            run = "npm run start"
        elif "dev" not in scripts and "start" not in scripts:
            run = ""
    except Exception:
        pass
    return {"kind": "node", "build_cmd": build, "test_cmd": test, "run_cmd": run}


def _detect_python(root: Path) -> Optional[dict]:
    pyproject = root / "pyproject.toml"
    req = root / "requirements.txt"
    main_py = root / "main.py"
    app_py = root / "app.py"
    if not pyproject.exists() and not req.exists() and not main_py.exists() and not app_py.exists():
        return None
    run_cmd = "python app.py" if app_py.exists() else ("python main.py" if main_py.exists() else "")
    return {"kind": "python", "build_cmd": "", "test_cmd": "python -m pytest", "run_cmd": run_cmd}


def _detect_rust(root: Path) -> Optional[dict]:
    if not (root / "Cargo.toml").exists():
        return None
    return {"kind": "rust", "build_cmd": "cargo build", "test_cmd": "cargo test", "run_cmd": "cargo run"}


def _detect_go(root: Path) -> Optional[dict]:
    if not (root / "go.mod").exists():
        return None
    return {"kind": "go", "build_cmd": "go build ./...", "test_cmd": "go test ./...", "run_cmd": "go run ."}


def _detect_cmake(root: Path) -> Optional[dict]:
    if not (root / "CMakeLists.txt").exists():
        return None
    return {
        "kind": "cmake",
        "build_cmd": "cmake -S . -B build && cmake --build build",
        "test_cmd": "ctest --test-dir build",
        "run_cmd": "",
    }


def detect_project_commands(project_name: str) -> dict:
    root = _project_root(project_name)
    if not root.exists():
        raise ValueError("Project does not exist.")

    detected = {}
    for detector in (_detect_node, _detect_python, _detect_rust, _detect_go, _detect_cmake):
        result = detector(root)
        if result:
            detected[result["kind"]] = {
                "build_cmd": result.get("build_cmd", ""),
                "test_cmd": result.get("test_cmd", ""),
                "run_cmd": result.get("run_cmd", ""),
            }

    merged = {"build_cmd": "", "test_cmd": "", "run_cmd": ""}
    for kind in ("node", "python", "rust", "go", "cmake"):
        if kind not in detected:
            continue
        for key in ("build_cmd", "test_cmd", "run_cmd"):
            if not merged[key] and detected[kind].get(key):
                merged[key] = detected[kind][key]
    return {"detected": detected, **merged}


async def detect_and_store_config(project_name: str) -> dict:
    detected = detect_project_commands(project_name)
    current = get_build_config(project_name)

    manual = set(current.get("manual_overrides", []))
    merged = dict(current)
    merged["detected"] = detected.get("detected", {})
    for key in ("build_cmd", "test_cmd", "run_cmd"):
        if key not in manual and detected.get(key):
            merged[key] = detected[key]
    merged["manual_overrides"] = sorted(manual)
    merged["updated_at"] = int(time.time())

    path = _config_path(project_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, indent=2), encoding="utf-8")
    return merged


def _run_command(project_name: str, command: str, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> dict:
    root = _project_root(project_name)
    if not root.exists():
        return {"ok": False, "error": "Project not found.", "exit_code": -1}
    if not command.strip():
        return {"ok": False, "error": "Command is empty.", "exit_code": -1}

    started = time.time()
    try:
        proc = subprocess.run(
            ["cmd", "/c", command],
            cwd=str(root),
            env=_runtime_env(),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        duration_ms = int((time.time() - started) * 1000)
        result = {
            "ok": proc.returncode == 0,
            "command": command,
            "project": project_name,
            "cwd": str(root),
            "stdout": (proc.stdout or "")[:12000],
            "stderr": (proc.stderr or "")[:6000],
            "exit_code": proc.returncode,
            "duration_ms": duration_ms,
            "timestamp": int(time.time()),
        }
        _latest_results[project_name] = result
        return result
    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - started) * 1000)
        result = {
            "ok": False,
            "command": command,
            "project": project_name,
            "cwd": str(root),
            "stdout": "",
            "stderr": f"Timed out after {timeout_seconds}s",
            "exit_code": -1,
            "duration_ms": duration_ms,
            "timestamp": int(time.time()),
        }
        _latest_results[project_name] = result
        return result
    except Exception as exc:
        duration_ms = int((time.time() - started) * 1000)
        result = {
            "ok": False,
            "command": command,
            "project": project_name,
            "cwd": str(root),
            "stdout": "",
            "stderr": str(exc),
            "exit_code": -1,
            "duration_ms": duration_ms,
            "timestamp": int(time.time()),
        }
        _latest_results[project_name] = result
        return result


def run_build(project_name: str) -> dict:
    cfg = get_build_config(project_name)
    cmd = (cfg.get("build_cmd") or "").strip()
    if not cmd:
        return {"ok": False, "error": "Build command not configured.", "project": project_name, "exit_code": -1}
    return _run_command(project_name, cmd, timeout_seconds=240)


def run_test(project_name: str) -> dict:
    cfg = get_build_config(project_name)
    cmd = (cfg.get("test_cmd") or "").strip()
    if not cmd:
        return {"ok": False, "error": "Test command not configured.", "project": project_name, "exit_code": -1}
    return _run_command(project_name, cmd, timeout_seconds=240)


def run_start(project_name: str) -> dict:
    cfg = get_build_config(project_name)
    cmd = (cfg.get("run_cmd") or "").strip()
    if not cmd:
        return {"ok": False, "error": "Run command not configured.", "project": project_name, "exit_code": -1}
    return _run_command(project_name, cmd, timeout_seconds=240)


def get_latest_result(project_name: str) -> dict:
    return _latest_results.get(project_name, {})
