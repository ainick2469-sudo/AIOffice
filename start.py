"""AI Office launcher (desktop-only)."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from server.runtime_config import APP_ROOT, build_runtime_env

SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = str(Path(SYSTEM_ROOT) / "System32" / "cmd.exe")
RUNTIME_WRAPPER = APP_ROOT / "with-runtime.cmd"


def main():
    parser = argparse.ArgumentParser(description="AI Office desktop launcher")
    parser.add_argument("--port", type=int, default=None, help="Preferred backend port")
    args, passthrough = parser.parse_known_args()

    print("AI Office starting in desktop mode...")
    cmd = [CMD_EXE, "/c", str(RUNTIME_WRAPPER), sys.executable, "app.py"]
    if isinstance(args.port, int) and args.port > 0:
        cmd.extend(["--port", str(args.port)])
    if passthrough:
        cmd.extend(passthrough)
    rc = subprocess.call(
        cmd,
        cwd=str(APP_ROOT),
        env=build_runtime_env(),
    )
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
