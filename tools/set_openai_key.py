from pathlib import Path
import sys


ENV_PATH = Path(__file__).resolve().parents[1] / ".env"


def main():
    if len(sys.argv) < 2:
        print("MISSING_KEY")
        raise SystemExit(1)

    raw = sys.argv[1].strip()
    clear_key = raw in {"--clear", "clear"}
    key = "" if clear_key else raw
    if not clear_key and not key:
        print("EMPTY_KEY")
        raise SystemExit(1)

    lines = []
    if ENV_PATH.exists():
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()

    updated = False
    out = []
    for line in lines:
        if line.startswith("OPENAI_API_KEY="):
            out.append(f"OPENAI_API_KEY={key}")
            updated = True
        else:
            out.append(line)

    if not updated:
        if out and out[-1].strip():
            out.append("")
        out.append(f"OPENAI_API_KEY={key}")

    ENV_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
    print("OPENAI_API_KEY_CLEARED" if clear_key else "OPENAI_API_KEY_SET")


if __name__ == "__main__":
    main()
