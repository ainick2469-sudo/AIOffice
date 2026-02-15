from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]
PYTHON_EXE = Path(r"C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe")
RUN_CMD = [
    str(PYTHON_EXE),
    "-m",
    "uvicorn",
    "server.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--log-level",
    "warning",
]


def wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.3)
    return False


def get_with_retry(client: httpx.Client, path: str, attempts: int = 4) -> httpx.Response:
    last_exc: Exception | None = None
    for _ in range(attempts):
        try:
            return client.get(path)
        except httpx.HTTPError as exc:
            last_exc = exc
            time.sleep(0.5)
    if last_exc:
        raise last_exc
    raise RuntimeError("request failed")


async def websocket_echo_check(marker: str) -> bool:
    uri = "ws://127.0.0.1:8000/ws/main"
    try:
        async with websockets.connect(uri, open_timeout=8, close_timeout=3) as ws:
            await ws.send(json.dumps({
                "type": "chat",
                "channel": "main",
                "content": marker,
                "msg_type": "message",
                "parent_id": None,
            }))
            end = time.time() + 12
            while time.time() < end:
                payload = await asyncio.wait_for(ws.recv(), timeout=8)
                data = json.loads(payload)
                msg = data.get("message", {})
                if data.get("type") == "chat" and msg.get("sender") == "user" and msg.get("content") == marker:
                    return True
    except Exception:
        return False
    return False


def main() -> int:
    env = os.environ.copy()
    env["PATH"] = ";".join([
        r"C:\Windows\System32",
        r"C:\Windows",
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
        env.get("PATH", ""),
    ])

    server = subprocess.Popen(
        RUN_CMD,
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    failures: list[str] = []
    uploaded_file: Path | None = None
    try:
        if not wait_for_port("127.0.0.1", 8000, timeout=40):
            failures.append("server_port_8000_not_ready")
            return 1

        with httpx.Client(base_url="http://127.0.0.1:8000", timeout=10) as client:
            health = get_with_retry(client, "/api/health")
            if health.status_code != 200:
                failures.append("health_failed")

            agents = get_with_retry(client, "/api/agents?active_only=false")
            if agents.status_code != 200 or not any(a.get("id") == "codex" for a in agents.json()):
                failures.append("agents_or_codex_failed")

            patch_bad = client.patch("/api/agents/codex", json={"backend": "bad-backend"})
            if patch_bad.status_code != 422:
                failures.append("invalid_backend_not_rejected")

            patch_ok = client.patch("/api/agents/codex", json={"role": "Implementation Overseer"})
            if patch_ok.status_code != 200:
                failures.append("valid_agent_patch_failed")

            app_builder = client.post("/api/app-builder/start", json={
                "channel": "main",
                "app_name": "Runtime Smoke App",
                "goal": "Build a tiny smoke app stub with one endpoint and one UI page.",
                "stack": "react-fastapi",
                "target_dir": "apps/runtime-smoke-app",
                "include_tests": False,
            })
            if app_builder.status_code != 200:
                failures.append("app_builder_start_failed")
            else:
                payload = app_builder.json()
                if payload.get("status") != "started":
                    failures.append("app_builder_status_not_started")

            for endpoint in ("/api/ollama/status", "/api/claude/status", "/api/openai/status"):
                status = get_with_retry(client, endpoint)
                if status.status_code != 200 or "available" not in status.json():
                    failures.append(f"status_endpoint_failed:{endpoint}")

            recommendations = get_with_retry(client, "/api/ollama/models/recommendations")
            if recommendations.status_code != 200:
                failures.append("ollama_recommendations_failed")
            else:
                payload = recommendations.json()
                if "recommended_models" not in payload:
                    failures.append("ollama_recommendations_missing_payload")

            upload = client.post(
                "/api/files/upload",
                files={"file": ("runtime-smoke.txt", b"runtime smoke", "text/plain")},
            )
            if upload.status_code != 200:
                failures.append("file_upload_failed")
            else:
                payload = upload.json()
                rel = payload.get("path")
                if not rel:
                    failures.append("file_upload_missing_path")
                else:
                    uploaded_file = ROOT / rel
                    if not uploaded_file.exists():
                        failures.append("uploaded_file_missing_on_disk")

        marker = f"[runtime-smoke-{int(time.time())}]"
        ws_ok = asyncio.run(websocket_echo_check(marker))
        if not ws_ok:
            failures.append("websocket_echo_failed")

    finally:
        if uploaded_file and uploaded_file.exists():
            try:
                uploaded_file.unlink()
            except Exception:
                pass

        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()

    if failures:
        print("RUNTIME_SMOKE_FAIL")
        for item in failures:
            print(f"- {item}")
        return 1

    print("RUNTIME_SMOKE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
