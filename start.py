"""AI Office single-file launcher. Double-click or run: python start.py"""

import subprocess
import sys
import os
import time
import signal
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(ROOT, "client")
SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = os.path.join(SYSTEM_ROOT, "System32", "cmd.exe")
RUNTIME_WRAPPER = os.path.join(ROOT, "with-runtime.cmd")
CLIENT_WITH_NODE = os.path.join(CLIENT, "tools", "with-node.cmd")
procs = []


def cleanup(*_):
    print("\nAI Office shutting down...")
    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    for p in procs:
        try:
            p.wait(timeout=3)
        except Exception:
            pass
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def _build_runtime_env():
    env = os.environ.copy()
    path_parts = [
        os.path.join(SYSTEM_ROOT, "System32"),
        SYSTEM_ROOT,
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
    ]
    existing = env.get("PATH", "")
    env["PATH"] = ";".join(path_parts + [existing])
    env["NODE_ENV"] = "development"
    return env


def _select_mode() -> str:
    arg_mode = ""
    if len(sys.argv) > 1:
        for idx, token in enumerate(sys.argv[1:], start=1):
            if token == "--mode" and idx + 1 < len(sys.argv):
                arg_mode = sys.argv[idx + 1].strip().lower()
                break
            if token.startswith("--mode="):
                arg_mode = token.split("=", 1)[1].strip().lower()
                break
    if arg_mode in {"web", "desktop"}:
        return arg_mode

    env_mode = os.environ.get("AI_OFFICE_START_MODE", "").strip().lower()
    if env_mode in {"web", "desktop"}:
        return env_mode

    if sys.stdin.isatty():
        try:
            print("Select startup mode: [1] Web (dev server)  [2] Desktop app")
            choice = input("Mode (default 1): ").strip().lower()
            if choice in {"2", "desktop", "d"}:
                return "desktop"
        except Exception:
            pass
    return "web"


def main():
    print("AI Office starting up...")
    print()
    env = _build_runtime_env()
    mode = _select_mode()

    if mode == "desktop":
        print("  Launching desktop mode...")
        rc = subprocess.call(
            [CMD_EXE, "/c", RUNTIME_WRAPPER, sys.executable, "app.py"],
            cwd=ROOT,
            env=env,
        )
        raise SystemExit(rc)

    # 1) Start backend
    print("  [1/2] Starting backend (FastAPI)...")
    backend = subprocess.Popen(
        [CMD_EXE, "/c", RUNTIME_WRAPPER, sys.executable, "run.py"],
        cwd=ROOT,
        env=env,
    )
    procs.append(backend)
    time.sleep(2)

    # 2) Start frontend
    print("  [2/2] Starting frontend (Vite)...")
    frontend = subprocess.Popen(
        [CMD_EXE, "/c", RUNTIME_WRAPPER, CLIENT_WITH_NODE, "npm", "run", "dev"],
        cwd=ROOT,
        env=env,
    )
    procs.append(frontend)
    time.sleep(3)

    print()
    print("  AI Office is running.")
    print("  Open: http://localhost:5173")
    print("  Press Ctrl+C to stop.")
    print()

    webbrowser.open("http://localhost:5173")

    # Keep alive
    try:
        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print("WARNING: Backend stopped. Shutting down.")
                break
            if frontend.poll() is not None:
                print("WARNING: Frontend stopped. Shutting down.")
                break
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
