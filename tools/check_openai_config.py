import os
import sys
from pathlib import Path

ROOT = Path("C:/AI_WORKSPACE/ai-office")
sys.path.insert(0, str(ROOT))

from server import openai_client  # noqa: E402


def mask_key(value: str) -> str:
    if not value:
        return "missing"
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def main():
    key = openai_client.get_api_key()
    print(f"OPENAI_CONFIG_AVAILABLE={openai_client.is_available()}")
    print(f"OPENAI_KEY_MASKED={mask_key(key)}")
    print(f"OPENAI_MODEL={openai_client.get_model()}")


if __name__ == "__main__":
    main()
