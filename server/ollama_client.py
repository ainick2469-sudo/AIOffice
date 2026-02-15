"""AI Office — Ollama HTTP client."""

import httpx
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


async def list_models() -> list[str]:
    """Return installed Ollama model names."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_BASE}/api/tags")
            resp.raise_for_status()
            data = resp.json() or {}
            models = data.get("models", [])
            names = [m.get("name", "").strip() for m in models if m.get("name")]
            # Deduplicate while preserving order
            seen = set()
            ordered = []
            for name in names:
                if name not in seen:
                    ordered.append(name)
                    seen.add(name)
            return ordered
    except Exception:
        return []


async def pull_model(model: str) -> dict:
    """Pull one model via Ollama HTTP API."""
    model_name = (model or "").strip()
    if not model_name:
        return {"ok": False, "model": model_name, "error": "Model name is required."}

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE}/api/pull",
                json={"name": model_name, "stream": False},
            )
            resp.raise_for_status()
            payload = resp.json() if resp.content else {}
            return {
                "ok": True,
                "model": model_name,
                "status": payload.get("status", "success"),
                "response": payload,
            }
    except httpx.ConnectError:
        return {"ok": False, "model": model_name, "error": "Ollama not reachable on 127.0.0.1:11434."}
    except Exception as e:
        return {"ok": False, "model": model_name, "error": str(e)}
