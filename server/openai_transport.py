"""Shared OpenAI HTTP transport with backoff and concurrency limiting."""

from __future__ import annotations

import asyncio
import os
import random
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx

OPENAI_MAX_CONCURRENCY = max(
    1,
    int((os.environ.get("AI_OFFICE_OPENAI_MAX_CONCURRENCY") or "4").strip() or "4"),
)
OPENAI_MAX_ATTEMPTS = max(
    1,
    int((os.environ.get("AI_OFFICE_OPENAI_MAX_ATTEMPTS") or "3").strip() or "3"),
)
OPENAI_BASE_BACKOFF_SECONDS = float(
    (os.environ.get("AI_OFFICE_OPENAI_BACKOFF_BASE_SECONDS") or "0.8").strip() or "0.8"
)
OPENAI_MAX_BACKOFF_SECONDS = float(
    (os.environ.get("AI_OFFICE_OPENAI_BACKOFF_MAX_SECONDS") or "12").strip() or "12"
)

_OPENAI_SEMAPHORE = asyncio.Semaphore(OPENAI_MAX_CONCURRENCY)


def _extract_request_id(headers: httpx.Headers) -> Optional[str]:
    if not headers:
        return None
    for key in ("x-request-id", "request-id", "openai-request-id"):
        value = (headers.get(key) or "").strip()
        if value:
            return value
    return None


def _extract_ratelimit(headers: httpx.Headers) -> dict:
    if not headers:
        return {}
    out = {}
    keys = [
        "retry-after",
        "x-ratelimit-limit-requests",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-reset-requests",
        "x-ratelimit-limit-tokens",
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-reset-tokens",
    ]
    for key in keys:
        value = (headers.get(key) or "").strip()
        if value:
            out[key] = value
    return out


def _parse_retry_after_seconds(value: Optional[str]) -> Optional[float]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = float(raw)
        return max(0.0, parsed)
    except Exception:
        pass
    try:
        stamp = parsedate_to_datetime(raw)
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        delta = (stamp - datetime.now(timezone.utc)).total_seconds()
        return max(0.0, delta)
    except Exception:
        return None


def _backoff_delay_seconds(attempt_index: int, retry_after: Optional[float]) -> float:
    if retry_after is not None and retry_after > 0:
        return min(OPENAI_MAX_BACKOFF_SECONDS, retry_after)
    base = OPENAI_BASE_BACKOFF_SECONDS * (2 ** max(0, attempt_index))
    jitter = random.uniform(0.0, max(0.08, base * 0.25))
    return min(OPENAI_MAX_BACKOFF_SECONDS, base + jitter)


async def post_json_with_backoff(
    *,
    url: str,
    headers: dict,
    body: dict,
    timeout_seconds: int,
    max_attempts: Optional[int] = None,
) -> dict:
    attempts_limit = max_attempts or OPENAI_MAX_ATTEMPTS
    attempts_limit = max(1, int(attempts_limit))
    last_attempt = {
        "ok": False,
        "status_code": None,
        "payload": None,
        "text": "",
        "request_id": None,
        "ratelimit": {},
        "attempts": 0,
        "error": None,
    }

    for attempt in range(attempts_limit):
        try:
            async with _OPENAI_SEMAPHORE:
                async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                    response = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException:
            return {
                **last_attempt,
                "ok": False,
                "status_code": 408,
                "attempts": attempt + 1,
                "error": "timeout",
            }
        except Exception as exc:
            return {
                **last_attempt,
                "ok": False,
                "status_code": None,
                "attempts": attempt + 1,
                "error": str(exc),
            }

        payload = None
        text = ""
        try:
            payload = response.json()
        except Exception:
            text = str(response.text or "")

        request_id = _extract_request_id(response.headers)
        ratelimit = _extract_ratelimit(response.headers)
        last_attempt = {
            "ok": response.status_code == 200,
            "status_code": response.status_code,
            "payload": payload,
            "text": text,
            "request_id": request_id,
            "ratelimit": ratelimit,
            "attempts": attempt + 1,
            "error": None,
        }

        if response.status_code == 429 and attempt + 1 < attempts_limit:
            retry_after = _parse_retry_after_seconds(response.headers.get("retry-after"))
            await asyncio.sleep(_backoff_delay_seconds(attempt, retry_after))
            continue

        return last_attempt

    return last_attempt

