"""AI Office — Claude API Client. Calls Anthropic's API for premium agents."""

import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger("ai-office.claude")

# Load API key from .env or environment
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-20250514"
API_URL = "https://api.anthropic.com/v1/messages"

def _load_key():
    """Try to load key from .env file if not in environment."""
    global API_KEY
    if API_KEY:
        return
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                    logger.info("Loaded Anthropic API key from .env")
                    return

_load_key()


def is_available() -> bool:
    """Check if Claude API is configured."""
    return bool(API_KEY)


async def chat(
    messages: list[dict],
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = None,
) -> Optional[str]:
    """Call Claude API. Returns response text or None on error."""
    if not API_KEY:
        logger.error("No ANTHROPIC_API_KEY configured")
        return None

    use_model = model or MODEL

    # Convert messages format: Anthropic API expects role: user/assistant
    api_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        if role == "system":
            continue  # system goes in separate param
        # Anthropic only accepts "user" and "assistant"
        if role not in ("user", "assistant"):
            role = "user"
        api_messages.append({"role": role, "content": msg["content"]})

    # Ensure alternating roles (Anthropic requirement)
    cleaned = []
    for msg in api_messages:
        if cleaned and cleaned[-1]["role"] == msg["role"]:
            cleaned[-1]["content"] += "\n\n" + msg["content"]
        else:
            cleaned.append(msg)

    # Must start with user
    if cleaned and cleaned[0]["role"] != "user":
        cleaned.insert(0, {"role": "user", "content": "Continue."})

    body = {
        "model": use_model,
        "max_tokens": max_tokens,
        "messages": cleaned,
    }
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = temperature

    headers = {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(API_URL, json=body, headers=headers)
            if resp.status_code != 200:
                logger.error(f"Claude API error {resp.status_code}: {resp.text[:300]}")
                return None

            data = resp.json()
            content_blocks = data.get("content", [])
            text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
            return "\n".join(text_parts) if text_parts else None

    except Exception as e:
        logger.error(f"Claude API request failed: {e}")
        return None
