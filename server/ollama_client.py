"""AI Office — Ollama HTTP client."""

import httpx
import json
import logging
from typing import Optional

logger = logging.getLogger("ai-office.ollama")

OLLAMA_BASE = "http://127.0.0.1:11434"
TIMEOUT = 120.0


async def generate(
    model: str,
    prompt: str,
    system: str = "",
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Generate a completion from Ollama."""
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_BASE}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "").strip()
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama. Is it running?")
        return "[Error: Ollama not reachable]"
    except Exception as e:
        logger.error(f"Ollama error: {e}")
        return f"[Error: {e}]"


async def chat(
    model: str,
    messages: list[dict],
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> str:
    """Chat completion from Ollama (multi-turn)."""
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "").strip()
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama. Is it running?")
        return "[Error: Ollama not reachable]"
    except Exception as e:
        logger.error(f"Ollama error: {e}")
        return f"[Error: {e}]"


async def is_available() -> bool:
    """Check if Ollama is running."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False
