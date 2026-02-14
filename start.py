"""AI Office — Single-file launcher. Double-click or run: python start.py"""

import subprocess
import sys
import os
import time
import signal
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(ROOT, "client")
procs = []


def cleanup(*_):
    print("\n🏢 Shutting down AI Office...")
    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    sys.exit(0)


signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)


def main():
    print("🏢 AI Office — Starting up...")
    print()

    # 1) Start backend
    print("  [1/2] Starting backend (FastAPI)...")
    backend = subprocess.Popen(
        [sys.executable, "run.py"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    procs.append(backend)
    time.sleep(2)

    # 2) Start frontend
    print("  [2/2] Starting frontend (Vite)...")
    env = os.environ.copy()
    env["NODE_ENV"] = "development"
    frontend = subprocess.Popen(
        ["npx", "vite"],
        cwd=CLIENT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=True,
    )
    procs.append(frontend)
    time.sleep(3)

    print()
    print("  ✅ AI Office is running!")
    print("  🌐 Open: http://localhost:5173")
    print("  Press Ctrl+C to stop.")
    print()

    webbrowser.open("http://localhost:5173")

    # Keep alive
    try:
        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print("⚠️  Backend stopped. Shutting down.")
                break
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
