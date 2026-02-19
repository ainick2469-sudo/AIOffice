"""OpenAI Responses API helper for GPT-5 model families."""

from __future__ import annotations

import json
from typing import Optional

from . import openai_transport


def _normalize_base_url(base_url: Optional[str]) -> str:
    value = (base_url or "").strip() or "https://api.openai.com"
    value = value.rstrip("/")
    if value.endswith("/v1"):
        value = value[:-3]
    return value.rstrip("/")


def _to_input_messages(messages: list[dict]) -> list[dict]:
    prepared: list[dict] = []
    for item in messages or []:
        role = str(item.get("role") or "user").strip().lower()
        if role not in {"system", "user", "assistant"}:
            role = "user"
        content = item.get("content")
        if isinstance(content, list):
            text_parts: list[str] = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text" and block.get("text"):
                        text_parts.append(str(block.get("text")))
                    elif block.get("content"):
                        text_parts.append(str(block.get("content")))
                elif isinstance(block, str):
                    text_parts.append(block)
            text = "\n".join(part for part in text_parts if part).strip()
        else:
            text = str(content or "").strip()
        prepared.append({"role": role, "content": text})
    return prepared


def _collect_text_from_output_blocks(payload: dict) -> str:
    collected: list[str] = []
    output = payload.get("output")
    if not isinstance(output, list):
        return ""
    for block in output:
        if not isinstance(block, dict):
            continue
        # Typical shape: {"content":[{"type":"output_text","text":"..."}]}
        content = block.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                part_type = str(part.get("type") or "").strip().lower()
                if part_type in {"output_text", "text"} and part.get("text"):
                    collected.append(str(part.get("text")))
                elif part.get("content"):
                    collected.append(str(part.get("content")))
        if block.get("text"):
            collected.append(str(block.get("text")))
        if block.get("output_text"):
            collected.append(str(block.get("output_text")))
    return "\n".join(part for part in collected if part).strip()


def extract_output_text(payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    top = payload.get("output_text")
    if isinstance(top, str) and top.strip():
        return top.strip()
    text = _collect_text_from_output_blocks(payload)
    if text:
        return text
    return ""


def _extract_error_detail(payload: dict) -> str:
    if not isinstance(payload, dict):
        return ""
    err = payload.get("error")
    if isinstance(err, dict):
        message = str(err.get("message") or "").strip()
        err_type = str(err.get("type") or "").strip()
        code = str(err.get("code") or "").strip()
        parts = [part for part in [message, err_type, code] if part]
        return " | ".join(parts)
    if payload.get("message"):
        return str(payload.get("message")).strip()
    return ""


def _friendly_openai_error(status_code: int, detail: str, model: str) -> str:
    if status_code in {401, 403}:
        return "OpenAI key missing/invalid."
    if status_code == 404:
        return f"Model not available: {model}."
    if status_code == 429:
        return "OpenAI rate limit reached."
    if status_code >= 500:
        return "OpenAI service error."
    return f"OpenAI HTTP {status_code}: {detail or 'Request failed.'}"


async def responses_generate(
    *,
    messages: list[dict],
    model: str,
    api_key: str,
    base_url: Optional[str] = None,
    reasoning_effort: str = "high",
    temperature: Optional[float] = None,
    max_output_tokens: Optional[int] = None,
    timeout_seconds: int = 120,
) -> dict:
    endpoint_root = _normalize_base_url(base_url)
    url = f"{endpoint_root}/v1/responses"
    body = {
        "model": model,
        "input": _to_input_messages(messages),
        "reasoning": {"effort": (reasoning_effort or "high").strip().lower() or "high"},
    }
    if temperature is not None:
        body["temperature"] = temperature
    if max_output_tokens:
        body["max_output_tokens"] = int(max_output_tokens)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    attempt = await openai_transport.post_json_with_backoff(
        url=url,
        headers=headers,
        body=body,
        timeout_seconds=timeout_seconds,
    )
    if attempt.get("status_code") == 408:
        return {
            "ok": False,
            "error": "OpenAI timeout.",
            "status_code": 408,
            "request_id": attempt.get("request_id"),
            "ratelimit": attempt.get("ratelimit") or {},
            "details": {"url": url, "timeout_seconds": timeout_seconds},
        }
    if attempt.get("error"):
        return {
            "ok": False,
            "error": f"OpenAI request failed: {attempt.get('error')}",
            "status_code": attempt.get("status_code"),
            "request_id": attempt.get("request_id"),
            "ratelimit": attempt.get("ratelimit") or {},
            "details": {"url": url},
        }
    payload = attempt.get("payload")
    status_code = attempt.get("status_code")
    request_id = attempt.get("request_id")
    ratelimit = attempt.get("ratelimit") or {}
    if status_code != 200:
        detail = _extract_error_detail(payload) if isinstance(payload, dict) else str(attempt.get("text") or "").strip()[:300]
        err = payload.get("error") if isinstance(payload, dict) and isinstance(payload.get("error"), dict) else {}
        return {
            "ok": False,
            "error": _friendly_openai_error(int(status_code or 0), detail, model),
            "status_code": status_code,
            "request_id": request_id,
            "ratelimit": ratelimit,
            "details": {
                "url": url,
                "response": payload if isinstance(payload, dict) else str(attempt.get("text") or "")[:800],
                "detail": detail,
                "error": {
                    "type": str(err.get("type") or "").strip() or None,
                    "code": str(err.get("code") or "").strip() or None,
                    "message": str(err.get("message") or "").strip() or detail or None,
                },
            },
        }

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "error": "OpenAI returned invalid JSON.",
            "status_code": status_code,
            "request_id": request_id,
            "ratelimit": ratelimit,
            "details": {"url": url},
        }

    text = extract_output_text(payload)
    if not text:
        snippet = json.dumps(payload)[:500]
        return {
            "ok": False,
            "error": f"OpenAI Responses returned no parseable text. Payload snippet: {snippet}",
            "status_code": status_code,
            "request_id": request_id,
            "ratelimit": ratelimit,
            "details": {"url": url},
        }

    return {
        "ok": True,
        "text": text,
        "status_code": status_code,
        "request_id": request_id,
        "ratelimit": ratelimit,
        "usage": payload.get("usage") or {},
        "details": {"url": url},
    }
