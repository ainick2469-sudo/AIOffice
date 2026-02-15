"""AI Office OpenAI API client."""

import os
import logging
from typing import Optional
import httpx

logger = logging.getLogger("ai-office.openai")

DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
MODEL_RATES_PER_1K = {
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o": {"input": 0.005, "output": 0.015},
}


def _read_key_from_env_file() -> str:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return ""

    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def get_api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    return _read_key_from_env_file()


def get_model() -> str:
    return os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)


def get_base_url() -> str:
    return os.environ.get("OPENAI_BASE_URL", DEFAULT_BASE_URL)


def is_available() -> bool:
    return bool(get_api_key())


def _normalize_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and "text" in block:
                    parts.append(str(block["text"]))
                elif "content" in block:
                    parts.append(str(block["content"]))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts).strip()
    return str(content or "").strip()


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = MODEL_RATES_PER_1K.get(model or "", MODEL_RATES_PER_1K["gpt-4o-mini"])
    return (
        (prompt_tokens / 1000.0) * rates["input"]
        + (completion_tokens / 1000.0) * rates["output"]
    )


async def chat(
    messages: list[dict],
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
) -> Optional[str]:
    api_key = get_api_key()
    if not api_key:
        logger.error("No OPENAI_API_KEY configured")
        return None

    use_model = model or get_model()
    api_messages = []
    if system:
        api_messages.append({"role": "system", "content": system})

    for msg in messages:
        role = msg.get("role", "user")
        if role not in ("system", "user", "assistant"):
            role = "user"
        api_messages.append({
            "role": role,
            "content": _normalize_content(msg.get("content", "")),
        })

    body = {
        "model": use_model,
        "messages": api_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    url = f"{get_base_url().rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code != 200:
                logger.error("OpenAI API error %s: %s", resp.status_code, resp.text[:300])
                return None

            data = resp.json()
            usage = data.get("usage") or {}
            try:
                from . import database as db
                await db.log_api_usage(
                    provider="openai",
                    model=use_model,
                    prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
                    completion_tokens=int(usage.get("completion_tokens", 0) or 0),
                    total_tokens=int(usage.get("total_tokens", 0) or 0),
                    estimated_cost=_estimate_cost(
                        use_model,
                        int(usage.get("prompt_tokens", 0) or 0),
                        int(usage.get("completion_tokens", 0) or 0),
                    ),
                    channel=channel,
                    project_name=project_name,
                )
            except Exception:
                pass
            choices = data.get("choices", [])
            if not choices:
                return None

            content = choices[0].get("message", {}).get("content", "")
            return _normalize_content(content) or None
    except Exception as exc:
        logger.error("OpenAI API request failed: %s", exc)
        return None
