"""AI Office launcher (desktop-only)."""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = os.path.join(SYSTEM_ROOT, "System32", "cmd.exe")
RUNTIME_WRAPPER = os.path.join(ROOT, "with-runtime.cmd")


def _build_runtime_env():
    env = os.environ.copy()
    path_parts = [
        os.path.join(SYSTEM_ROOT, "System32"),
        SYSTEM_ROOT,
        r"C:\Program Files\nodejs",
        r"C:\Users\nickb\AppData\Local\Programs\Python\Python312",
    ]
    env["PATH"] = ";".join(path_parts + [env.get("PATH", "")])
    return env


def main():
    print("AI Office starting in desktop mode...")
    rc = subprocess.call(
        [CMD_EXE, "/c", RUNTIME_WRAPPER, sys.executable, "app.py"],
        cwd=ROOT,
        env=_build_runtime_env(),
    )
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
