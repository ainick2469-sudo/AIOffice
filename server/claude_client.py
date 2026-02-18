"""AI Office — Claude API client (Anthropic).

Supports env-based configuration plus per-request key/base_url overrides for per-agent credentials.
"""

from __future__ import annotations

import os
import logging
from typing import Optional

import httpx

logger = logging.getLogger("ai-office.claude")

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
MODEL_RATES_PER_1K = {
    "claude-sonnet-4-20250514": {"input": 0.003, "output": 0.015},
    "claude-3-5-sonnet": {"input": 0.003, "output": 0.015},
}


def _read_key_from_env_file() -> str:
    if (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1":
        return ""
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return ""

    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return ""
    return ""


def get_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key
    return _read_key_from_env_file()


def get_api_url() -> str:
    return os.environ.get("ANTHROPIC_API_URL", DEFAULT_API_URL)


def is_available() -> bool:
    return bool(get_api_key())


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = MODEL_RATES_PER_1K.get(model or "", MODEL_RATES_PER_1K[DEFAULT_MODEL])
    return (input_tokens / 1000.0) * rates["input"] + (output_tokens / 1000.0) * rates["output"]


async def chat(
    messages: list[dict],
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> Optional[str]:
    """Call Claude API. Returns response text or None on error."""
    resolved_key = (api_key or "").strip() or get_api_key()
    if not resolved_key:
        logger.error("No ANTHROPIC_API_KEY configured")
        return None

    use_model = model or DEFAULT_MODEL
    api_url = (base_url or "").strip() or get_api_url()

    # Convert messages format: Anthropic API expects role: user/assistant
    api_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        if role == "system":
            continue  # system goes in separate param
        if role not in ("user", "assistant"):
            role = "user"
        api_messages.append({"role": role, "content": msg.get("content", "")})

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
        "x-api-key": resolved_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(api_url, json=body, headers=headers)
            if resp.status_code != 200:
                logger.error("Claude API error %s: %s", resp.status_code, resp.text[:300])
                return None

            data = resp.json()
            usage = data.get("usage") or {}
            try:
                from . import database as db

                input_tokens = int(usage.get("input_tokens", 0) or 0)
                output_tokens = int(usage.get("output_tokens", 0) or 0)
                await db.log_api_usage(
                    provider="claude",
                    model=use_model,
                    prompt_tokens=input_tokens,
                    completion_tokens=output_tokens,
                    total_tokens=input_tokens + output_tokens,
                    estimated_cost=_estimate_cost(use_model, input_tokens, output_tokens),
                    channel=channel,
                    project_name=project_name,
                )
            except Exception:
                pass
            content_blocks = data.get("content", [])
            text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
            return "\n".join(text_parts) if text_parts else None
    except Exception as exc:
        logger.error("Claude API request failed: %s", exc)
        return None
