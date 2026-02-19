"""AI Office OpenAI API client."""

import os
import logging
from typing import Optional
import time
import httpx
from . import provider_config
from . import openai_responses

logger = logging.getLogger("ai-office.openai")
_last_error: str = ""

DEFAULT_MODEL = "gpt-5.2"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
MODEL_RATES_PER_1K = {
    "gpt-5.2": {"input": 0.0, "output": 0.0},
    "gpt-5.2-codex": {"input": 0.0, "output": 0.0},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o": {"input": 0.005, "output": 0.015},
}


def _read_key_from_env_file() -> str:
    if (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1":
        return ""
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


def _set_last_error(message: str = "") -> None:
    global _last_error
    _last_error = (message or "").strip()


def get_last_error() -> str:
    return _last_error


def _extract_openai_error(payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    err = payload.get("error")
    if isinstance(err, dict):
        msg = str(err.get("message") or "").strip()
        err_type = str(err.get("type") or "").strip()
        code = str(err.get("code") or "").strip()
        details = [item for item in [msg, err_type, code] if item]
        return " | ".join(details)
    return str(payload.get("message") or "").strip()


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
    rates = MODEL_RATES_PER_1K.get(model or "", MODEL_RATES_PER_1K[DEFAULT_MODEL])
    return (
        (prompt_tokens / 1000.0) * rates["input"]
        + (completion_tokens / 1000.0) * rates["output"]
    )


def _is_gpt5_model(model: str) -> bool:
    return (model or "").strip().lower().startswith("gpt-5")


def _friendly_http_error(status_code: int, detail: str, model: str) -> str:
    if status_code in {401, 403}:
        return "OpenAI key missing/invalid."
    if status_code == 404:
        return f"Model not available: {model}."
    if status_code == 429:
        return "OpenAI rate limit reached."
    if status_code >= 500:
        return "OpenAI service error."
    return f"OpenAI HTTP {status_code}: {detail or 'Unknown API error'}"


async def _log_backend_error(
    *,
    channel: Optional[str],
    project_name: Optional[str],
    model: str,
    status_code: Optional[int],
    error: str,
    transport: str,
) -> None:
    if not channel:
        return
    try:
        from . import database as db

        await db.log_console_event(
            channel=channel,
            project_name=project_name,
            event_type="provider_error",
            source="openai_client",
            severity="warning",
            message=f"openai request failed ({transport})",
            data={
                "provider": "openai",
                "model": model,
                "status_code": status_code,
                "error": (error or "")[:600],
                "transport": transport,
            },
        )
    except Exception:
        pass


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
    _set_last_error("")
    runtime = await provider_config.resolve_provider_runtime(
        "openai",
        api_key_override=api_key,
        base_url_override=base_url,
        model_override=model,
    )
    resolved_key = (runtime.get("api_key") or "").strip()
    if not resolved_key:
        _set_last_error("No OPENAI API key configured.")
        logger.error("No OpenAI key configured in settings, provider vault, or environment")
        return None
    resolved_base_url = (runtime.get("base_url") or "").strip() or get_base_url()
    reasoning_effort = (runtime.get("reasoning_effort") or "high").strip().lower() or "high"

    use_model = (runtime.get("model_default") or "").strip() or get_model()
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

    if _is_gpt5_model(use_model):
        response_payload = await openai_responses.responses_generate(
            messages=api_messages,
            model=use_model,
            api_key=resolved_key,
            base_url=resolved_base_url,
            reasoning_effort=reasoning_effort,
            temperature=temperature,
            max_output_tokens=max_tokens,
            timeout_seconds=120,
        )
        if not response_payload.get("ok"):
            detail = response_payload.get("error") or "OpenAI request failed."
            _set_last_error(detail)
            await _log_backend_error(
                channel=channel,
                project_name=project_name,
                model=use_model,
                status_code=response_payload.get("status_code"),
                error=detail,
                transport="responses",
            )
            return None

        usage = response_payload.get("usage") or {}
        try:
            from . import database as db

            prompt_tokens = int(
                usage.get("prompt_tokens")
                or usage.get("input_tokens")
                or usage.get("input_tokens_total")
                or 0
            )
            completion_tokens = int(
                usage.get("completion_tokens")
                or usage.get("output_tokens")
                or usage.get("output_tokens_total")
                or 0
            )
            await db.log_api_usage(
                provider="openai",
                model=use_model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=int(usage.get("total_tokens") or (prompt_tokens + completion_tokens)),
                estimated_cost=_estimate_cost(use_model, prompt_tokens, completion_tokens),
                channel=channel,
                project_name=project_name,
            )
        except Exception:
            pass
        text = str(response_payload.get("text") or "").strip()
        if not text:
            _set_last_error("OpenAI returned an empty completion.")
            return None
        _set_last_error("")
        return text

    body = {
        "model": use_model,
        "messages": api_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }

    url = f"{resolved_base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=body)
            if resp.status_code != 200:
                detail = ""
                try:
                    detail = _extract_openai_error(resp.json())
                except Exception:
                    detail = str(resp.text or "").strip()[:280]
                friendly = _friendly_http_error(resp.status_code, detail, use_model)
                _set_last_error(friendly)
                await _log_backend_error(
                    channel=channel,
                    project_name=project_name,
                    model=use_model,
                    status_code=resp.status_code,
                    error=friendly,
                    transport="chat_completions",
                )
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
                _set_last_error("OpenAI returned no choices.")
                return None

            content = choices[0].get("message", {}).get("content", "")
            normalized = _normalize_content(content) or None
            if not normalized:
                _set_last_error("OpenAI returned an empty completion.")
                return None
            _set_last_error("")
            return normalized
    except Exception as exc:
        _set_last_error(f"OpenAI request failed: {exc}")
        await _log_backend_error(
            channel=channel,
            project_name=project_name,
            model=use_model,
            status_code=None,
            error=str(exc),
            transport="chat_completions",
        )
        logger.error("OpenAI API request failed: %s", exc)
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
        "openai",
        api_key_override=api_key,
        base_url_override=base_url,
        model_override=model,
        refresh=True,
    )
    resolved_key = (runtime.get("api_key") or "").strip()
    resolved_base_url = (runtime.get("base_url") or "").strip() or get_base_url()
    model_hint = (runtime.get("model_default") or get_model() or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if not resolved_key:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": "No OpenAI API key configured.",
            "details": {
                "hint": "Set key in Settings -> API Keys, then run Test OpenAI.",
                "key_source": runtime.get("key_source"),
            },
        }

    if _is_gpt5_model(model_hint):
        result = await openai_responses.responses_generate(
            messages=[{"role": "user", "content": "Reply with pong."}],
            model=model_hint,
            api_key=resolved_key,
            base_url=resolved_base_url,
            reasoning_effort="low",
            temperature=0,
            max_output_tokens=16,
            timeout_seconds=timeout_seconds,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        if not result.get("ok"):
            return {
                "ok": False,
                "model_hint": model_hint,
                "latency_ms": latency_ms,
                "error": result.get("error") or "OpenAI request failed.",
                "details": {
                    "status_code": result.get("status_code"),
                    "url": (result.get("details") or {}).get("url"),
                    "response": (result.get("details") or {}).get("response"),
                },
            }
        return {
            "ok": True,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": None,
            "details": {"status_code": result.get("status_code"), "url": (result.get("details") or {}).get("url")},
        }

    body = {
        "model": model_hint,
        "messages": [{"role": "user", "content": "Reply with pong."}],
        "temperature": 0,
        "max_tokens": 8,
    }
    headers = {
        "Authorization": f"Bearer {resolved_key}",
        "Content-Type": "application/json",
    }
    url = f"{resolved_base_url.rstrip('/')}/chat/completions"

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            resp = await client.post(url, headers=headers, json=body)
    except httpx.TimeoutException:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"OpenAI timeout after {timeout_seconds}s.",
            "details": {"url": url, "timeout_seconds": timeout_seconds},
        }
    except Exception as exc:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": f"OpenAI request failed: {exc}",
            "details": {"url": url},
        }

    latency_ms = int((time.perf_counter() - started) * 1000)
    if resp.status_code != 200:
        detail = ""
        parsed = None
        try:
            parsed = resp.json()
            detail = _extract_openai_error(parsed)
        except Exception:
            detail = str(resp.text or "").strip()[:280]
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": _friendly_http_error(resp.status_code, detail, model_hint),
            "details": {"status_code": resp.status_code, "url": url, "response": parsed or detail},
        }

    try:
        payload = resp.json()
    except Exception:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": "OpenAI returned invalid JSON.",
            "details": {"status_code": resp.status_code, "url": url},
        }

    choices = payload.get("choices") or []
    if not choices:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": "OpenAI returned no choices.",
            "details": {"status_code": resp.status_code, "url": url},
        }

    content = _normalize_content(choices[0].get("message", {}).get("content", ""))
    if not content:
        return {
            "ok": False,
            "model_hint": model_hint,
            "latency_ms": latency_ms,
            "error": "OpenAI returned empty completion content.",
            "details": {"status_code": resp.status_code, "url": url},
        }

    return {
        "ok": True,
        "model_hint": model_hint,
        "latency_ms": latency_ms,
        "error": None,
        "details": {"status_code": resp.status_code, "url": url},
    }
