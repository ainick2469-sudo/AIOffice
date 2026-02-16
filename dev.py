"""Developer launcher (backend + Vite dev server)."""

import os
import signal
import subprocess
import sys
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(ROOT, "client")
SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = os.path.join(SYSTEM_ROOT, "System32", "cmd.exe")
RUNTIME_WRAPPER = os.path.join(ROOT, "with-runtime.cmd")
CLIENT_WITH_NODE = os.path.join(CLIENT, "tools", "with-node.cmd")
PROCS = []


def _build_runtime_env():
    env = os.environ.copy()
    path_parts = [
        os.path.join(SYSTEM_ROOT, "System32"),
        SYSTEM_ROOT,
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
    ]
    env["PATH"] = ";".join(path_parts + [env.get("PATH", "")])
    env["NODE_ENV"] = "development"
    return env


def _cleanup(*_):
    for proc in PROCS:
        try:
            proc.terminate()
        except Exception:
            pass
    for proc in PROCS:
        try:
            proc.wait(timeout=3)
        except Exception:
            pass
    raise SystemExit(0)


signal.signal(signal.SIGINT, _cleanup)
signal.signal(signal.SIGTERM, _cleanup)


def main():
    print("AI Office dev mode starting...")
    env = _build_runtime_env()

    backend = subprocess.Popen(
        [CMD_EXE, "/c", RUNTIME_WRAPPER, sys.executable, "run.py"],
        cwd=ROOT,
        env=env,
    )
    PROCS.append(backend)
    time.sleep(2)

    frontend = subprocess.Popen(
        [CMD_EXE, "/c", RUNTIME_WRAPPER, CLIENT_WITH_NODE, "npm", "run", "dev"],
        cwd=ROOT,
        env=env,
    )
    PROCS.append(frontend)
    time.sleep(3)

    webbrowser.open("http://localhost:5173")
    print("Dev server: http://localhost:5173")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(1)
            if backend.poll() is not None or frontend.poll() is not None:
                break
    finally:
        _cleanup()


if __name__ == "__main__":
    main()
