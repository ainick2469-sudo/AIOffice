"""Provider runtime configuration helpers.

DB settings are preferred over env vars, with a short in-memory TTL cache.
"""

from __future__ import annotations

import os
import time
from typing import Optional

from . import database as db
from . import provider_models
from .runtime_config import APP_ROOT
from .secrets_vault import decrypt_secret

CACHE_TTL_SECONDS = max(1, int((os.environ.get("AI_OFFICE_PROVIDER_CACHE_SECONDS") or "10").strip() or "10"))
_CACHE: dict[str, tuple[float, dict]] = {}


def _normalize_provider(value: str) -> str:
    return provider_models.normalize_provider(value)


def _mask_key(value: str) -> Optional[str]:
    key = (value or "").strip()
    if not key:
        return None
    if len(key) <= 8:
        return ("*" * max(0, len(key) - 2)) + key[-2:]
    return f"{key[:3]}...{key[-4:]}"


def _is_placeholder_secret(value: str) -> bool:
    text = (value or "").strip()
    if not text:
        return True
    upper = text.upper()
    if upper.startswith("REPLACE_WITH_"):
        return True
    if upper in {"YOUR_KEY", "YOUR_API_KEY", "CHANGE_ME"}:
        return True
    return False


def _default_base_url(provider: str) -> Optional[str]:
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "claude":
        return "https://api.anthropic.com/v1/messages"
    if provider == "ollama":
        return "http://127.0.0.1:11434"
    return None


def _default_model(provider: str) -> Optional[str]:
    return provider_models.default_model_for_provider(provider)


def _default_reasoning_effort(provider: str) -> Optional[str]:
    if provider == "openai":
        return "high"
    return None


def _env_key(provider: str) -> str:
    env_name = ""
    if provider == "openai":
        env_name = "OPENAI_API_KEY"
    elif provider == "claude":
        env_name = "ANTHROPIC_API_KEY"
    if not env_name:
        return ""
    value = (os.environ.get(env_name) or "").strip()
    if value:
        return value
    return _read_env_file_var(env_name)


def _env_base_url(provider: str) -> str:
    env_name = ""
    if provider == "openai":
        env_name = "OPENAI_BASE_URL"
    elif provider == "claude":
        env_name = "ANTHROPIC_API_URL"
    if not env_name:
        return ""
    value = (os.environ.get(env_name) or "").strip()
    if value:
        return value
    return _read_env_file_var(env_name)


def _env_model(provider: str) -> str:
    env_name = ""
    if provider == "openai":
        env_name = "OPENAI_MODEL"
    elif provider == "claude":
        env_name = "ANTHROPIC_MODEL"
    if not env_name:
        return ""
    value = (os.environ.get(env_name) or "").strip()
    if value:
        return value
    return _read_env_file_var(env_name)


def _read_env_file_var(key: str) -> str:
    if (os.environ.get("AI_OFFICE_TESTING") or "").strip() == "1":
        return ""
    env_path = APP_ROOT / ".env"
    if not env_path.exists():
        return ""
    target = f"{key}="
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(target):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return ""
    return ""


def clear_provider_cache(provider: Optional[str] = None) -> None:
    if provider is None:
        _CACHE.clear()
        return
    _CACHE.pop(_normalize_provider(provider), None)


def _cache_get(provider: str) -> Optional[dict]:
    item = _CACHE.get(provider)
    if not item:
        return None
    expires_at, payload = item
    if time.time() >= expires_at:
        _CACHE.pop(provider, None)
        return None
    return dict(payload)


def _cache_put(provider: str, payload: dict) -> None:
    _CACHE[provider] = (time.time() + CACHE_TTL_SECONDS, dict(payload))


def _decode_key(value: Optional[str]) -> str:
    encoded = (value or "").strip()
    if not encoded:
        return ""
    try:
        return (decrypt_secret(encoded) or "").strip()
    except Exception:
        return encoded


async def _read_provider_runtime(
    provider: str,
    *,
    key_ref_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
    model_override: Optional[str] = None,
) -> dict:
    cfg = await db.get_provider_config(provider)
    key_ref = (key_ref_override or "").strip() or (cfg.get("key_ref") or "").strip()

    settings_key = _decode_key(await db.get_setting(f"{provider}.api_key_enc"))
    legacy_settings_key = (await db.get_setting(f"{provider}.api_key") or "").strip()
    provider_secret = await db.get_provider_secret(key_ref) if key_ref else ""
    env_key = _env_key(provider)

    override_key = (api_key_override or "").strip()
    if override_key and not _is_placeholder_secret(override_key):
        api_key = override_key
        key_source = "override"
    elif settings_key and not _is_placeholder_secret(settings_key):
        api_key = settings_key
        key_source = "settings"
    elif legacy_settings_key and not _is_placeholder_secret(legacy_settings_key):
        api_key = legacy_settings_key
        key_source = "settings-legacy"
    elif provider_secret and not _is_placeholder_secret(provider_secret):
        api_key = provider_secret
        key_source = "vault"
    elif env_key and not _is_placeholder_secret(env_key):
        api_key = env_key
        key_source = "env"
    else:
        api_key = ""
        key_source = "none"

    settings_base_url = (await db.get_setting(f"{provider}.base_url") or "").strip()
    settings_model = (await db.get_setting(f"{provider}.model_default") or "").strip()
    settings_reasoning_effort = (await db.get_setting(f"{provider}.reasoning_effort") or "").strip().lower()
    settings_last_tested_at = (await db.get_setting(f"{provider}.last_tested_at") or "").strip()
    settings_last_error = (await db.get_setting(f"{provider}.last_error") or "").strip()

    base_url = (
        (base_url_override or "").strip()
        or settings_base_url
        or (cfg.get("base_url") or "").strip()
        or _env_base_url(provider)
        or _default_base_url(provider)
    )
    model_default = (
        (model_override or "").strip()
        or settings_model
        or (cfg.get("default_model") or "").strip()
        or _env_model(provider)
        or _default_model(provider)
    )
    reasoning_effort = settings_reasoning_effort or _default_reasoning_effort(provider)

    return {
        "provider": provider,
        "configured": bool(api_key) if provider in {"openai", "claude"} else True,
        "api_key": api_key,
        "key_source": key_source,
        "key_ref": key_ref or None,
        "key_masked": _mask_key(api_key),
        "base_url": base_url or None,
        "model_default": model_default or None,
        "reasoning_effort": reasoning_effort or None,
        "last_tested_at": settings_last_tested_at or None,
        "last_error": settings_last_error or None,
        "updated_at": cfg.get("updated_at"),
    }


async def resolve_provider_runtime(
    provider: str,
    *,
    key_ref_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
    base_url_override: Optional[str] = None,
    model_override: Optional[str] = None,
    refresh: bool = False,
) -> dict:
    provider_name = _normalize_provider(provider)
    if provider_name not in {"openai", "claude", "ollama"}:
        raise ValueError("provider must be one of: openai, claude, ollama")

    has_overrides = any(
        bool((value or "").strip())
        for value in [key_ref_override, api_key_override, base_url_override, model_override]
    )
    if not refresh and not has_overrides:
        cached = _cache_get(provider_name)
        if cached is not None:
            return cached

    runtime = await _read_provider_runtime(
        provider_name,
        key_ref_override=key_ref_override,
        api_key_override=api_key_override,
        base_url_override=base_url_override,
        model_override=model_override,
    )
    if not has_overrides:
        _cache_put(provider_name, runtime)
    return runtime


async def provider_status(provider: str, *, refresh: bool = False) -> dict:
    runtime = await resolve_provider_runtime(provider, refresh=refresh)
    return {
        "provider": runtime["provider"],
        "configured": bool(runtime.get("configured")),
        "key_masked": runtime.get("key_masked"),
        "key_ref": runtime.get("key_ref"),
        "base_url": runtime.get("base_url"),
        "model_default": runtime.get("model_default"),
        "key_source": runtime.get("key_source"),
        "reasoning_effort": runtime.get("reasoning_effort"),
        "last_tested_at": runtime.get("last_tested_at"),
        "last_error": runtime.get("last_error"),
    }


async def provider_settings_snapshot() -> dict:
    openai = await provider_status("openai", refresh=True)
    claude = await provider_status("claude", refresh=True)
    return {
        "openai": {
            "configured": bool(openai.get("configured")),
            "key_masked": openai.get("key_masked"),
            "model_default": openai.get("model_default"),
            "base_url": openai.get("base_url"),
            "key_ref": openai.get("key_ref"),
            "reasoning_effort": openai.get("reasoning_effort"),
            "last_tested_at": openai.get("last_tested_at"),
            "last_error": openai.get("last_error"),
        },
        "claude": {
            "configured": bool(claude.get("configured")),
            "key_masked": claude.get("key_masked"),
            "model_default": claude.get("model_default"),
            "base_url": claude.get("base_url"),
            "key_ref": claude.get("key_ref"),
            "last_tested_at": claude.get("last_tested_at"),
            "last_error": claude.get("last_error"),
        },
    }


def _model_availability_for_provider(
    *,
    provider: str,
    configured: bool,
    selected_model: Optional[str],
    last_tested_at: Optional[str],
    last_error: Optional[str],
) -> list[dict]:
    models = []
    for item in provider_models.models_for_provider(provider):
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        available: Optional[bool] = None
        reason: Optional[str] = None
        if provider in {"openai", "claude", "codex"}:
            if not configured:
                available = False
                reason = "Provider key is not configured."
            elif selected_model == model_id and last_tested_at:
                if last_error:
                    available = False
                    reason = last_error
                else:
                    available = True
                    reason = f"Last tested at {last_tested_at}."
            else:
                available = None
                reason = "Availability unknown until Test Connection runs for this model."
        elif provider == "ollama":
            available = None
            reason = "Local model availability depends on your Ollama installation."

        models.append(
            {
                "id": model_id,
                "label": str(item.get("label") or model_id),
                "capabilities": list(item.get("capabilities") or []),
                "default": bool(item.get("default")),
                "legacy": bool(item.get("legacy")),
                "selected": bool(model_id == (selected_model or "")),
                "available": available,
                "availability_reason": reason,
            }
        )
    return models


async def model_catalog_snapshot(*, refresh: bool = False) -> dict:
    openai = await provider_status("openai", refresh=refresh)
    claude = await provider_status("claude", refresh=refresh)
    ollama = await provider_status("ollama", refresh=refresh)

    provider_state = {
        "openai": openai,
        "claude": claude,
        "ollama": ollama,
        # Codex is an OpenAI-backed runtime alias in this app.
        "codex": {
            **openai,
            "provider": "codex",
            "model_default": openai.get("model_default") or provider_models.default_model_for_provider("codex"),
        },
    }

    providers: dict[str, dict] = {}
    for provider in ["openai", "claude", "ollama", "codex"]:
        state = provider_state[provider]
        selected_model = (
            (state.get("model_default") or "").strip()
            or provider_models.default_model_for_provider(provider)
            or ""
        )
        providers[provider] = {
            "provider": provider,
            "title": provider_models.provider_title(provider),
            "route_provider": provider_models.normalize_provider(provider),
            "configured": bool(state.get("configured")),
            "key_source": state.get("key_source"),
            "key_ref": state.get("key_ref"),
            "base_url": state.get("base_url"),
            "selected_model_id": selected_model or None,
            "default_model_id": provider_models.default_model_for_provider(provider),
            "last_tested_at": state.get("last_tested_at"),
            "last_error": state.get("last_error"),
            "models": _model_availability_for_provider(
                provider=provider,
                configured=bool(state.get("configured")),
                selected_model=selected_model,
                last_tested_at=state.get("last_tested_at"),
                last_error=state.get("last_error"),
            ),
        }
    return {"providers": providers}
