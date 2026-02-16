from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON_EXE = Path(r"C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe")


def wait_for_port(host: str, port: int, timeout: float = 60.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
        except OSError:
            infos = []
        for family, socktype, proto, _, sockaddr in infos:
            with socket.socket(family, socktype, proto) as sock:
                sock.settimeout(1)
                if sock.connect_ex(sockaddr) == 0:
                    return True
        time.sleep(0.4)
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

    proc = subprocess.Popen(
        [str(PYTHON_EXE), "start.py"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    ok_8000 = False
    try:
        ok_8000 = wait_for_port("localhost", 8000, timeout=50)
    finally:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )

    if ok_8000:
        print("STARTUP_SMOKE_PASS")
        return 0

    print("STARTUP_SMOKE_FAIL")
    print(f"PORT_8000_READY={ok_8000}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
