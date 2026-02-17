"""AI Office launcher (desktop-only)."""

import os
import subprocess
import sys
from pathlib import Path

from server.runtime_config import APP_ROOT, build_runtime_env

SYSTEM_ROOT = os.environ.get("SystemRoot", r"C:\Windows")
CMD_EXE = str(Path(SYSTEM_ROOT) / "System32" / "cmd.exe")
RUNTIME_WRAPPER = APP_ROOT / "with-runtime.cmd"


def main():
    print("AI Office starting in desktop mode...")
    rc = subprocess.call(
        [CMD_EXE, "/c", str(RUNTIME_WRAPPER), sys.executable, "app.py"],
        cwd=str(APP_ROOT),
        env=build_runtime_env(),
    )
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
