from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_SCRIPT = ROOT / "app.py"
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"
EXE_PATH = DIST_DIR / "AI Office" / "AI Office.exe"


def _run(command: list[str], cwd: Path | None = None) -> int:
    display = " ".join(f'"{part}"' if " " in part else part for part in command)
    print(f"[run] {display}")
    result = subprocess.run(command, cwd=str(cwd or ROOT), check=False)
    return int(result.returncode)


def _ensure_pyinstaller(python_exe: str) -> None:
    check_code = _run([python_exe, "-m", "PyInstaller", "--version"])
    if check_code == 0:
        return

    print("[info] PyInstaller not found. Installing...")
    install_code = _run([python_exe, "-m", "pip", "install", "pyinstaller>=6,<7"])
    if install_code != 0:
        raise RuntimeError("Failed to install PyInstaller.")


def _pyinstaller_command(python_exe: str) -> list[str]:
    add_data = [
        f"{ROOT / 'client-dist'};client-dist",
        f"{ROOT / 'agents'};agents",
        f"{ROOT / 'uploads'};uploads",
        f"{ROOT / 'memory'};memory",
        f"{ROOT / '.env.example'};.",
    ]
    command = [
        python_exe,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--windowed",
        "--onedir",
        "--name",
        "AI Office",
        "--paths",
        str(ROOT),
    ]
    for entry in add_data:
        command.extend(["--add-data", entry])
    command.append(str(APP_SCRIPT))
    return command


def _clean_output_dirs() -> None:
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR, ignore_errors=True)
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build standalone AI Office desktop executable.")
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable to use for build steps.",
    )
    parser.add_argument("--skip-install", action="store_true", help="Skip PyInstaller installation check.")
    parser.add_argument("--dry-run", action="store_true", help="Print command only; do not build.")
    args = parser.parse_args()

    python_exe = str(Path(args.python))
    if not Path(python_exe).exists():
        print(f"[error] Python executable not found: {python_exe}")
        return 1

    if not APP_SCRIPT.exists():
        print(f"[error] app.py not found at: {APP_SCRIPT}")
        return 1

    if not args.skip_install:
        try:
            _ensure_pyinstaller(python_exe)
        except RuntimeError as exc:
            print(f"[error] {exc}")
            return 1

    command = _pyinstaller_command(python_exe)
    if args.dry_run:
        display = " ".join(f'"{part}"' if " " in part else part for part in command)
        print(f"[dry-run] {display}")
        return 0

    _clean_output_dirs()
    code = _run(command)
    if code != 0:
        print("[error] PyInstaller build failed.")
        return code

    if not EXE_PATH.exists():
        print(f"[error] Build completed but executable was not found at: {EXE_PATH}")
        return 1

    print(f"[ok] Standalone desktop app built: {EXE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
