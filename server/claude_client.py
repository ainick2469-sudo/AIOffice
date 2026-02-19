"""AI Office — Claude API client (Anthropic).

Supports env-based configuration plus per-request key/base_url overrides for per-agent credentials.
"""

from __future__ import annotations

import os
import logging
import time
from typing import Optional

import httpx
from . import provider_config

logger = logging.getLogger("ai-office.claude")
_last_error: str = ""

DEFAULT_MODEL = "claude-opus-4-6"
DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
MODEL_RATES_PER_1K = {
    "claude-opus-4-6": {"input": 0.0, "output": 0.0},
    "claude-sonnet-4-6": {"input": 0.0, "output": 0.0},
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


def _set_last_error(message: str = "") -> None:
    global _last_error
    _last_error = (message or "").strip()


def get_last_error() -> str:
    return _last_error


def _extract_claude_error(payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    err = payload.get("error")
    if isinstance(err, dict):
        msg = str(err.get("message") or "").strip()
        err_type = str(err.get("type") or "").strip()
        return " | ".join([item for item in [msg, err_type] if item])
    return str(payload.get("message") or "").strip()


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
    _set_last_error("")
    runtime = await provider_config.resolve_provider_runtime(
        "claude",
        api_key_override=api_key,
        base_url_override=base_url,
        model_override=model,
    )
    resolved_key = (runtime.get("api_key") or "").strip()
    if not resolved_key:
        _set_last_error("No Anthropic API key configured.")
        logger.error("No Claude key configured in settings, provider vault, or environment")
        return None

    use_model = (runtime.get("model_default") or "").strip() or DEFAULT_MODEL
    api_url = (runtime.get("base_url") or "").strip() or get_api_url()

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
                detail = ""
                try:
                    detail = _extract_claude_error(resp.json())
                except Exception:
                    detail = str(resp.text or "").strip()[:280]
                _set_last_error(f"Claude HTTP {resp.status_code}: {detail or 'Unknown API error'}")
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
            if not text_parts:
                _set_last_error("Claude returned no text content.")
                return None
            _set_last_error("")
            return "\n".join(text_parts)
    except Exception as exc:
        _set_last_error(f"Claude request failed: {exc}")
        logger.error("Claude API request failed: %s", exc)
        return None


async def probe_connection(
    *,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout_seconds: int = 15,
) -> dict:
    started = time.perf_counter()
    runtime = await provider_config.resolve_provider_runtime(
        "claude",
        api_key_override=api_key,
        base_url_override=base_url,
        model_override=model,
        refresh=True,
    )
    resolved_key = (runtime.get("api_key") or "").strip()
    model_hint = (runtime.get("model_default") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    api_url = (runtime.get("base_url") or "").strip() or get_api_url()
    if not resolved_key:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": "No Anthropic API key configured.",
            "details": {
                "hint": "Set key in Settings -> API Keys, then run Test Claude.",
                "key_source": runtime.get("key_source"),
            },
        }

    body = {
        "model": model_hint,
        "max_tokens": 8,
        "messages": [{"role": "user", "content": "Reply with pong."}],
        "temperature": 0,
    }
    headers = {
        "x-api-key": resolved_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.post(api_url, json=body, headers=headers)
    except httpx.TimeoutException:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"Claude timeout after {timeout_seconds}s.",
            "details": {"url": api_url, "timeout_seconds": timeout_seconds},
        }
    except Exception as exc:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"Claude request failed: {exc}",
            "details": {"url": api_url},
        }

    latency_ms = int((time.perf_counter() - started) * 1000)
    if resp.status_code != 200:
        detail = ""
        parsed = None
        try:
            parsed = resp.json()
            detail = _extract_claude_error(parsed)
        except Exception:
            detail = str(resp.text or "").strip()[:280]
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": f"Claude HTTP {resp.status_code}: {detail or 'Unknown API error'}",
            "details": {"status_code": resp.status_code, "url": api_url, "response": parsed or detail},
        }

    try:
        payload = resp.json()
    except Exception:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": "Claude returned invalid JSON.",
            "details": {"status_code": resp.status_code, "url": api_url},
        }

    content_blocks = payload.get("content") or []
    text_parts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
    content = "\n".join([part for part in text_parts if part]).strip()
    if not content:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": "Claude returned no text content.",
            "details": {"status_code": resp.status_code, "url": api_url},
        }

    return {
        "ok": True,
        "model_hint": model_hint,
        "latency_ms": latency_ms,
        "error": None,
        "details": {"status_code": resp.status_code, "url": api_url},
    }
