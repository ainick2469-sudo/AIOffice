"""Provider model catalog and friendly labels.

This module is the single source of truth for provider model defaults and
UI-friendly model metadata.
"""

from __future__ import annotations

from typing import Optional

PROVIDER_ALIASES: dict[str, str] = {
    "anthropic": "claude",
    "codex": "openai",
}

PROVIDER_TITLES: dict[str, str] = {
    "openai": "OpenAI",
    "claude": "Anthropic Claude",
    "ollama": "Ollama (Local)",
    "codex": "Codex (via OpenAI)",
}

MODEL_CATALOG: dict[str, list[dict]] = {
    "openai": [
        {
            "id": "gpt-5.2",
            "label": "GPT-5.2 Thinking",
            "capabilities": ["chat", "tools", "reasoning"],
            "default": True,
        },
        {
            "id": "gpt-5.2-codex",
            "label": "GPT-5.2 Codex",
            "capabilities": ["chat", "tools", "coding"],
            "default": False,
        },
    ],
    "claude": [
        {
            "id": "claude-opus-4-6",
            "label": "Claude Opus 4.6",
            "capabilities": ["chat", "tools", "reasoning"],
            "default": True,
        },
        {
            "id": "claude-sonnet-4-6",
            "label": "Claude Sonnet 4.6",
            "capabilities": ["chat", "tools"],
            "default": False,
        },
    ],
    "ollama": [
        {
            "id": "qwen2.5:14b",
            "label": "Qwen 2.5 14B (Local)",
            "capabilities": ["chat", "local"],
            "default": True,
        },
        {
            "id": "llama3.2:latest",
            "label": "Llama 3.2 (Local)",
            "capabilities": ["chat", "local"],
            "default": False,
        },
        {
            "id": "deepseek-coder:6.7b",
            "label": "DeepSeek Coder 6.7B (Local)",
            "capabilities": ["chat", "coding", "local"],
            "default": False,
        },
    ],
    "codex": [
        {
            "id": "gpt-5.2-codex",
            "label": "Codex (via OpenAI)",
            "capabilities": ["chat", "tools", "coding"],
            "default": True,
        },
        {
            "id": "gpt-5.2",
            "label": "GPT-5.2 Thinking",
            "capabilities": ["chat", "tools", "reasoning"],
            "default": False,
        },
    ],
}


def normalize_provider(value: Optional[str]) -> str:
    provider = (value or "").strip().lower()
    if not provider:
        return ""
    return PROVIDER_ALIASES.get(provider, provider)


def provider_title(provider: Optional[str]) -> str:
    raw = (provider or "").strip().lower()
    return PROVIDER_TITLES.get(raw, PROVIDER_TITLES.get(normalize_provider(raw), raw or "Provider"))


def models_for_provider(provider: Optional[str]) -> list[dict]:
    raw = (provider or "").strip().lower()
    if raw in MODEL_CATALOG:
        return [dict(item) for item in MODEL_CATALOG[raw]]
    normalized = normalize_provider(raw)
    return [dict(item) for item in MODEL_CATALOG.get(normalized, [])]


def default_model_for_provider(provider: Optional[str]) -> Optional[str]:
    options = models_for_provider(provider)
    for item in options:
        if item.get("default"):
            return str(item.get("id") or "").strip() or None
    return str(options[0].get("id") or "").strip() if options else None


def model_label(provider: Optional[str], model_id: Optional[str]) -> str:
    target = (model_id or "").strip()
    if not target:
        return ""
    for item in models_for_provider(provider):
        if (item.get("id") or "").strip() == target:
            return str(item.get("label") or target)
    return target
