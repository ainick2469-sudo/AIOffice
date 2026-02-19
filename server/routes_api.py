"""AI Office REST API routes."""

import json
import re
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Request
from fastapi.responses import FileResponse
from typing import Optional
from . import database as db
from . import provider_config
from . import provider_models
from .models import (
    ApprovalResponseIn,
    AutonomyModeIn,
    AgentOut,
    AgentCredentialIn,
    AgentCredentialMetaOut,
    AgentCredentialTestIn,
    AgentCredentialTestOut,
    ProviderConfigIn,
    ProviderConfigOut,
    ProviderTestIn,
    ProviderTestOut,
    ProviderSettingsIn,
    ProviderSettingsOut,
    ProviderSettingsProviderOut,
    ProviderModelCatalogOut,
    AgentUpdateIn,
    AppBuilderStartIn,
    BranchSwitchIn,
    BuildConfigIn,
    CheckpointCreateIn,
    CheckpointRestoreIn,
    CreateSkillIn,
    MergeApplyIn,
    MergePreviewIn,
    ProcessStartIn,
    ProcessStopIn,
    ProjectActiveOut,
    ProjectUIStateIn,
    ProjectUIStateOut,
    ProjectCreateFromPromptIn,
    DebugBundleIn,
    MemoryEraseIn,
    ExecuteCodeIn,
    OllamaPullIn,
    SpecSaveIn,
    SpecApproveIn,
    PermissionPolicyIn,
    PermissionPolicyOut,
    PermissionGrantIn,
    PermissionRevokeIn,
    RunCommandIn,
    ProjectCreateIn,
    ProjectImportOut,
    ProjectSwitchIn,
    ReactionToggleIn,
    TaskIn,
    TaskUpdateIn,
    TrustSessionIn,
)
from .runtime_config import (
    AI_OFFICE_HOME,
    APP_ROOT,
    build_runtime_env,
    executable_candidates,
    resolve_executable as resolve_runtime_executable,
)

router = APIRouter(prefix="/api", tags=["api"])
PROJECT_ROOT = APP_ROOT
UPLOADS_DIR = AI_OFFICE_HOME / "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMPORT_BYTES = int(os.environ.get("AI_OFFICE_MAX_IMPORT_BYTES", str(200 * 1024 * 1024)))


def _resolve_executable(name: str, candidates: list[str]) -> str:
    return resolve_runtime_executable(name, candidates)


def _runtime_env() -> dict:
    return build_runtime_env(os.environ.copy())


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "upload.bin")
    return cleaned[:120] or "upload.bin"


def _normalize_timestamp(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = value.strip().replace("T", " ").replace("Z", "")
    return text or None


def _slugify_project_name(text: str) -> str:
    raw = (text or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    slug = re.sub(r"^[^a-z0-9]+", "", slug).strip("-")
    slug = slug[:50].strip("-")
    return slug


def _normalize_provider(value: str) -> str:
    return provider_models.normalize_provider(value)


def _validate_provider_key(provider: str, api_key: str) -> Optional[str]:
    key = (api_key or "").strip()
    if not key:
        return "API key cannot be empty."
    upper = key.upper()
    if upper.startswith("REPLACE_WITH_") or upper in {"YOUR_KEY", "YOUR_API_KEY", "CHANGE_ME"}:
        return "API key placeholder detected. Paste a real provider key."
    if provider == "openai":
        if not (key.startswith("sk-") or key.startswith("rk-")):
            return "OpenAI key should usually start with `sk-`."
    if provider == "claude":
        if not key.startswith("sk-ant-"):
            return "Anthropic key should usually start with `sk-ant-`."
    return None


def _extract_status_code(details: Optional[dict]) -> Optional[int]:
    if not isinstance(details, dict):
        return None
    candidates = [
        details.get("status_code"),
        (details.get("provider_details") or {}).get("status_code")
        if isinstance(details.get("provider_details"), dict)
        else None,
    ]
    for value in candidates:
        if value is None:
            continue
        try:
            return int(value)
        except Exception:
            continue
    return None


def _map_provider_test_failure(
    *,
    provider: str,
    error: Optional[str],
    details: Optional[dict],
) -> tuple[str, str]:
    status_code = _extract_status_code(details)
    message = str(error or "").strip()
    lower = message.lower()
    provider_title = provider_models.provider_title(provider)

    if status_code in {401, 403}:
        return (
            "AUTH_INVALID",
            f"{provider_title} authentication failed. Re-check your API key and key source, then test again.",
        )
    if status_code == 429 or "insufficient_quota" in lower or "quota" in lower:
        return (
            "QUOTA_EXCEEDED",
            f"{provider_title} quota or billing limit was reached. Check account billing/limits and retry.",
        )
    if status_code == 404 or "model not available" in lower or "model not found" in lower or "model unavailable" in lower:
        return (
            "MODEL_UNAVAILABLE",
            f"The selected model is not enabled for this account. Pick another model in Settings -> Providers.",
        )
    if (
        status_code in {408, 502, 503, 504}
        or "timeout" in lower
        or "timed out" in lower
        or "unreachable" in lower
        or "connection" in lower
        or "dns" in lower
        or "network" in lower
    ):
        return (
            "PROVIDER_UNREACHABLE",
            f"{provider_title} is unreachable right now. Check base URL, proxy/firewall, and network access.",
        )
    if "no key found" in lower or "missing key" in lower or "not configured" in lower:
        return (
            "AUTH_INVALID",
            f"{provider_title} is not configured. Open Settings -> API Keys, save a key, then test connection.",
        )
    return (
        "UNKNOWN_ERROR",
        f"{provider_title} test failed. Review diagnostics, then re-run Test Connection.",
    )


def _seed_spec_from_prompt(prompt: str, *, project_name: str, template: Optional[str] = None) -> tuple[str, str]:
    tpl = (template or "").strip() or "auto"
    goal = (prompt or "").strip()
    spec = (
        f"# Build Spec: {project_name}\n\n"
        "## Goal\n"
        f"{goal}\n\n"
        "## UX\n"
        "- Primary user flow:\n"
        "- Screens:\n\n"
        "## Stack\n"
        f"- Template hint: `{tpl}`\n"
        "- Frontend:\n"
        "- Backend:\n\n"
        "## Data Model\n"
        "- Entities:\n\n"
        "## API\n"
        "- Endpoints:\n\n"
        "## Milestones\n"
        "1. Scaffold\n"
        "2. Core features\n"
        "3. Preview loop\n"
        "4. Verification (tests/build)\n"
    )
    ideas = (
        f"# Idea Bank: {project_name}\n\n"
        "## Seed\n"
        f"- Prompt: {goal}\n\n"
        "## UI Ideas\n"
        "- \n\n"
        "## Feature Ideas\n"
        "- \n"
    )
    return spec, ideas


def _registry_agents() -> list[dict]:
    registry_path = PROJECT_ROOT / "agents" / "registry.json"
    if not registry_path.exists():
        return []
    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
        agents = data.get("agents", [])
        return agents if isinstance(agents, list) else []
    except Exception:
        return []


def _recommended_ollama_model_map() -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for agent in _registry_agents():
        if agent.get("backend") != "ollama":
            continue
        if not agent.get("active", True):
            continue
        model = (agent.get("model") or "").strip()
        agent_id = (agent.get("id") or "").strip()
        if not model or not agent_id:
            continue
        mapping.setdefault(model, []).append(agent_id)
    return mapping


@router.get("/agents", response_model=list[AgentOut])
async def list_agents(active_only: bool = True):
    agents = await db.get_agents(active_only)
    return agents


@router.get("/agents/{agent_id}", response_model=AgentOut)
async def get_agent(agent_id: str):
    agent = await db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


@router.patch("/agents/{agent_id}", response_model=AgentOut)
async def update_agent(agent_id: str, body: AgentUpdateIn):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No updates provided")

    for key in ("display_name", "role", "model", "provider_key_ref", "base_url", "permissions", "color", "emoji", "system_prompt"):
        if key in updates and isinstance(updates[key], str):
            updates[key] = updates[key].strip()
            if key in {"provider_key_ref", "base_url"} and not updates[key]:
                updates[key] = None

    for required in ("display_name", "role", "model", "permissions", "color", "emoji"):
        if required in updates and not updates[required]:
            raise HTTPException(400, f"{required} cannot be empty")

    if "backend" in updates:
        backend_value = (updates.get("backend") or "").strip().lower()
        if backend_value not in {"ollama", "openai", "claude"}:
            raise HTTPException(400, "backend must be one of: ollama, openai, claude")

    if "backend" in updates and not (updates.get("model") or ""):
        agent = await db.get_agent(agent_id)
        if not agent or not str(agent.get("model") or "").strip():
            raise HTTPException(400, "model is required when setting backend")

    updated = await db.update_agent(agent_id, updates)
    if not updated:
        raise HTTPException(404, "Agent not found")
    return updated


@router.get("/agents/{agent_id}/credentials", response_model=AgentCredentialMetaOut)
async def get_agent_credentials(agent_id: str, backend: str = Query(..., min_length=1, max_length=20)):
    try:
        return await db.get_agent_credential_meta(agent_id, backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/agents/{agent_id}/credentials", response_model=AgentCredentialMetaOut)
async def set_agent_credentials(agent_id: str, body: AgentCredentialIn):
    try:
        return await db.upsert_agent_credential(
            agent_id=agent_id,
            backend=body.backend,
            api_key=body.api_key,
            base_url=body.base_url,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/agents/{agent_id}/credentials")
async def delete_agent_credentials(agent_id: str, backend: str = Query(..., min_length=1, max_length=20)):
    try:
        ok = await db.clear_agent_credential(agent_id, backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "deleted": ok}


@router.post("/agents/{agent_id}/credentials/test", response_model=AgentCredentialTestOut)
async def test_agent_credentials(agent_id: str, body: AgentCredentialTestIn):
    backend = (body.backend or "").strip().lower()
    if backend not in {"openai", "claude"}:
        raise HTTPException(400, "backend must be openai or claude")

    agent = await db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    default_model = "gpt-5.2-codex" if backend == "openai" else "claude-opus-4-6"
    model_hint = (body.model or agent.get("model") or default_model).strip() or default_model
    api_key = await db.get_agent_api_key(agent_id, backend)
    meta = await db.get_agent_credential_meta(agent_id, backend)
    provider_cfg = await db.get_provider_config(backend)
    key_ref = (agent.get("provider_key_ref") or "").strip() or (provider_cfg.get("key_ref") or "").strip()
    if not api_key and key_ref:
        api_key = await db.get_provider_secret(key_ref)
    base_url = (
        (agent.get("base_url") or "").strip()
        or (meta.get("base_url") or "").strip()
        or (provider_cfg.get("base_url") or "").strip()
        or None
    )

    try:
        if backend == "openai":
            from . import openai_adapter

            probe = await openai_adapter.probe_connection(
                model=model_hint,
                api_key=api_key,
                base_url=base_url,
                timeout_seconds=15,
            )
        else:
            from . import claude_adapter

            probe = await claude_adapter.probe_connection(
                model=model_hint,
                api_key=api_key,
                base_url=base_url,
                timeout_seconds=15,
            )
    except Exception as exc:
        return AgentCredentialTestOut(
            ok=False,
            backend=backend,
            model_hint=model_hint,
            latency_ms=None,
            error=str(exc),
            details={"agent_id": agent_id, "backend": backend},
        )

    return AgentCredentialTestOut(
        ok=bool(probe.get("ok")),
        backend=backend,
        model_hint=str(probe.get("model_hint") or model_hint),
        latency_ms=probe.get("latency_ms"),
        error=probe.get("error"),
        details=probe.get("details") or {"agent_id": agent_id, "backend": backend},
    )


@router.post("/agents/repair")
async def repair_agent_defaults():
    """Repair safe defaults for known agents without surprising user-customized configs."""
    agent = await db.get_agent("codex")
    if not agent:
        raise HTTPException(404, "Agent not found")

    before = {"id": "codex", "backend": agent.get("backend"), "model": agent.get("model")}
    changed = False
    updated = agent

    backend = (agent.get("backend") or "").strip().lower()
    model = (agent.get("model") or "").strip().lower()
    legacy_models = {"qwen2.5:14b", "qwen2.5:32b", "qwen2.5:7b", "qwen3:14b", "qwen3:32b"}

    # Only repair known legacy codex signatures.
    if backend == "ollama" and model in legacy_models:
        updated = await db.update_agent(
            "codex",
            {"backend": "openai", "model": "gpt-5.2-codex", "provider_key_ref": "openai_default"},
        ) or agent
        changed = True

    after = {"id": "codex", "backend": updated.get("backend"), "model": updated.get("model")}
    return {"ok": True, "changed": changed, "before": before, "after": after}


@router.post("/agents/sync-registry")
async def sync_agents_registry(force: bool = Query(default=False)):
    result = await db.sync_agents_from_registry(force=force)
    return result


async def _provider_settings_out() -> ProviderSettingsOut:
    snapshot = await provider_config.provider_settings_snapshot()
    fallback_raw = (await db.get_setting("providers.fallback_to_ollama") or "").strip().lower()
    fallback_enabled = fallback_raw in {"1", "true", "yes", "on"}
    return ProviderSettingsOut(
        openai=ProviderSettingsProviderOut(**snapshot.get("openai", {})),
        claude=ProviderSettingsProviderOut(**snapshot.get("claude", {})),
        fallback_to_ollama=fallback_enabled,
    )


@router.get("/settings/providers", response_model=ProviderSettingsOut)
async def get_settings_providers():
    return await _provider_settings_out()


@router.get("/settings/models", response_model=ProviderModelCatalogOut)
async def get_settings_models():
    snapshot = await provider_config.model_catalog_snapshot(refresh=True)
    return ProviderModelCatalogOut(**snapshot)


@router.post("/settings/providers", response_model=ProviderSettingsOut)
async def set_settings_providers(body: ProviderSettingsIn):
    payload = body.model_dump(exclude_unset=True)
    touched: list[str] = []
    provider_rows = {
        "openai": payload.get("openai"),
        "claude": payload.get("claude"),
    }

    for provider, raw in provider_rows.items():
        if not isinstance(raw, dict):
            continue

        cfg = await db.get_provider_config(provider)
        key_ref = (cfg.get("key_ref") or f"{provider}_default").strip()
        base_url = (cfg.get("base_url") or "").strip() or None
        default_model = (cfg.get("default_model") or "").strip() or None

        if "base_url" in raw:
            base_url = (raw.get("base_url") or "").strip() or None
            await db.set_setting(f"{provider}.base_url", base_url or "")
        if "model_default" in raw:
            default_model = (raw.get("model_default") or "").strip() or None
            await db.set_setting(f"{provider}.model_default", default_model or "")
        if provider == "openai" and "reasoning_effort" in raw:
            reasoning_effort = (raw.get("reasoning_effort") or "").strip().lower()
            if reasoning_effort not in {"", "low", "medium", "high"}:
                raise HTTPException(400, "openai.reasoning_effort must be low, medium, or high")
            await db.set_setting("openai.reasoning_effort", reasoning_effort or "high")
        if "api_key" in raw:
            api_key = (raw.get("api_key") or "").strip()
            if api_key:
                key_err = _validate_provider_key(provider, api_key)
                if key_err:
                    raise HTTPException(400, key_err)
                from .secrets_vault import encrypt_secret

                await db.set_setting(f"{provider}.api_key_enc", encrypt_secret(api_key))
                await db.set_setting(f"{provider}.api_key", "")
                await db.upsert_provider_secret(key_ref, api_key)
            else:
                await db.set_setting(f"{provider}.api_key_enc", "")
                await db.set_setting(f"{provider}.api_key", "")
                if key_ref:
                    await db.clear_provider_secret(key_ref)
        await db.upsert_provider_config(
            provider,
            key_ref=key_ref,
            base_url=base_url,
            default_model=default_model,
        )
        provider_config.clear_provider_cache(provider)
        touched.append(provider)
        await db.log_console_event(
            channel="main",
            project_name=None,
            event_type="provider_config_updated",
            source="routes_api",
            message=f"{provider} settings updated",
            data={
                "provider": provider,
                "key_ref": key_ref,
                "base_url": base_url,
                "model": default_model,
                "reasoning_effort": (
                    (raw.get("reasoning_effort") or "").strip().lower()
                    if isinstance(raw, dict) and provider == "openai"
                    else None
                ),
            },
        )

    if "fallback_to_ollama" in payload:
        enabled = bool(payload.get("fallback_to_ollama"))
        await db.set_setting("providers.fallback_to_ollama", "true" if enabled else "false")
        await db.log_console_event(
            channel="main",
            project_name=None,
            event_type="provider_config_updated",
            source="routes_api",
            message="providers.fallback_to_ollama updated",
            data={"fallback_to_ollama": enabled},
        )

    if touched:
        provider_config.clear_provider_cache()
    return await _provider_settings_out()


@router.get("/providers")
async def list_providers():
    rows = await db.list_provider_configs()
    return {"providers": rows}


@router.post("/providers", response_model=ProviderConfigOut)
async def set_provider_config(body: ProviderConfigIn):
    provider = _normalize_provider(body.provider)
    if provider not in {"openai", "claude", "ollama"}:
        raise HTTPException(400, "provider must be one of: openai, claude, ollama, codex")

    existing = await db.get_provider_config(provider)
    key_ref = (body.key_ref or "").strip() or (existing.get("key_ref") or "")
    if not key_ref and provider in {"openai", "claude"}:
        key_ref = f"{provider}_default"

    cfg = await db.upsert_provider_config(
        provider,
        key_ref=key_ref or None,
        base_url=(body.base_url or "").strip() or None,
        default_model=(body.default_model or "").strip() or None,
    )
    if (body.api_key or "").strip():
        key_err = _validate_provider_key(provider, body.api_key)
        if key_err:
            raise HTTPException(400, key_err)
        if not key_ref:
            raise HTTPException(400, "key_ref is required when api_key is provided")
        await db.upsert_provider_secret(key_ref, body.api_key)
        from .secrets_vault import encrypt_secret

        await db.set_setting(f"{provider}.api_key_enc", encrypt_secret(body.api_key))
        await db.set_setting(f"{provider}.api_key", "")
    if body.base_url is not None:
        await db.set_setting(f"{provider}.base_url", (body.base_url or "").strip())
    if body.default_model is not None:
        await db.set_setting(f"{provider}.model_default", (body.default_model or "").strip())
    provider_config.clear_provider_cache(provider)
    await db.log_console_event(
        channel="main",
        project_name=None,
        event_type="provider_config_updated",
        source="routes_api",
        message=f"{provider} provider config updated",
        data={
            "provider": provider,
            "key_ref": key_ref or None,
            "base_url": (body.base_url or "").strip() or None,
            "default_model": (body.default_model or "").strip() or None,
        },
    )

    secret_meta = await db.get_provider_secret_meta(cfg.get("key_ref"))
    return ProviderConfigOut(
        provider=cfg.get("provider") or provider,
        key_ref=cfg.get("key_ref"),
        has_key=bool(secret_meta.get("has_key")),
        last4=secret_meta.get("last4"),
        base_url=cfg.get("base_url"),
        default_model=cfg.get("default_model"),
        updated_at=cfg.get("updated_at"),
        key_updated_at=secret_meta.get("updated_at"),
    )


@router.post("/providers/test", response_model=ProviderTestOut)
async def test_provider_config(body: ProviderTestIn):
    provider = _normalize_provider(body.provider)
    if provider not in {"openai", "claude", "ollama"}:
        raise HTTPException(400, "provider must be one of: openai, claude, anthropic, ollama, codex")

    if provider == "ollama":
        from . import ollama_client

        started = time.perf_counter()
        available = await ollama_client.is_available()
        latency_ms = int((time.perf_counter() - started) * 1000)
        details = {"endpoint": "http://127.0.0.1:11434"}
        if available:
            try:
                models = await ollama_client.list_models()
                details["models_count"] = len(models)
                details["models"] = models[:10]
            except Exception as exc:
                details["models_error"] = str(exc)
        error_text = None if available else "Ollama is not reachable on http://127.0.0.1:11434. Start Ollama and retry."
        error_code = None
        hint = None
        if error_text:
            error_code, hint = _map_provider_test_failure(provider=provider, error=error_text, details=details)
        return ProviderTestOut(
            ok=bool(available),
            provider=provider,
            model_hint=None,
            latency_ms=latency_ms,
            error=error_text,
            error_code=error_code,
            hint=hint,
            details=details,
        )

    cfg = await db.get_provider_config(provider)
    runtime = await provider_config.resolve_provider_runtime(
        provider,
        key_ref_override=(body.key_ref or "").strip() or None,
        base_url_override=(body.base_url or "").strip() or None,
        model_override=(body.model or "").strip() or None,
        refresh=True,
    )
    key_ref = (runtime.get("key_ref") or "").strip()
    api_key = (runtime.get("api_key") or "").strip()
    base_url = (runtime.get("base_url") or "").strip() or None
    model_hint = (
        runtime.get("model_default")
        or cfg.get("default_model")
        or provider_models.default_model_for_provider(provider)
        or ("gpt-5.2" if provider == "openai" else "claude-opus-4-6")
    ).strip()

    if not api_key:
        details = {
            "provider": provider,
            "key_ref": key_ref or None,
            "key_source": runtime.get("key_source"),
        }
        error_text = f"No key found for provider `{provider}`. Save a key in Settings -> API Keys first."
        error_code, hint = _map_provider_test_failure(provider=provider, error=error_text, details=details)
        result = ProviderTestOut(
            ok=False,
            provider=provider,
            model_hint=model_hint,
            latency_ms=0,
            error=error_text,
            error_code=error_code,
            hint=hint,
            details=details,
        )
        await db.set_setting(f"{provider}.last_tested_at", datetime.now(timezone.utc).isoformat())
        await db.set_setting(f"{provider}.last_error", result.error or "")
        return result

    try:
        if provider == "openai":
            from . import openai_adapter

            probe = await openai_adapter.probe_connection(
                model=model_hint,
                api_key=api_key or None,
                base_url=base_url,
                timeout_seconds=15,
            )
        else:
            from . import claude_adapter

            probe = await claude_adapter.probe_connection(
                model=model_hint,
                api_key=api_key or None,
                base_url=base_url,
                timeout_seconds=15,
            )
    except Exception as exc:
        details = {
            "provider": provider,
            "base_url": base_url,
            "key_source": runtime.get("key_source"),
        }
        error_text = str(exc)
        error_code, hint = _map_provider_test_failure(provider=provider, error=error_text, details=details)
        result = ProviderTestOut(
            ok=False,
            provider=provider,
            model_hint=model_hint,
            latency_ms=None,
            error=error_text,
            error_code=error_code,
            hint=hint,
            details=details,
        )
        await db.set_setting(f"{provider}.last_tested_at", datetime.now(timezone.utc).isoformat())
        await db.set_setting(f"{provider}.last_error", result.error or "")
        return result

    probe_details = probe.get("details") if isinstance(probe, dict) else None
    if not isinstance(probe_details, dict):
        probe_details = {"raw": probe_details}
    merged_details = {
        **probe_details,
        "provider": provider,
        "base_url": base_url,
        "key_source": runtime.get("key_source"),
    }
    error_text = probe.get("error")
    error_code = None
    hint = None
    if not bool(probe.get("ok")):
        error_code, hint = _map_provider_test_failure(
            provider=provider,
            error=error_text,
            details=merged_details,
        )

    result = ProviderTestOut(
        ok=bool(probe.get("ok")),
        provider=provider,
        model_hint=str(probe.get("model_hint") or model_hint),
        latency_ms=probe.get("latency_ms"),
        error=error_text,
        error_code=error_code,
        hint=hint,
        details=merged_details,
    )
    await db.set_setting(f"{provider}.last_tested_at", datetime.now(timezone.utc).isoformat())
    await db.set_setting(f"{provider}.last_error", result.error or "")
    provider_config.clear_provider_cache(provider)
    return result


@router.get("/messages/{channel}")
async def get_messages(channel: str, limit: int = 50, before_id: Optional[int] = None):
    messages = await db.get_messages(channel, limit, before_id)
    return messages


@router.delete("/channels/{channel_id}/messages")
async def clear_channel_messages_route(channel_id: str):
    deleted = await db.clear_channel_messages(channel_id)
    system_message = await db.insert_message(
        channel=channel_id,
        sender="system",
        content="Chat history cleared.",
        msg_type="system",
    )

    from .websocket import manager

    await manager.broadcast(channel_id, {"type": "chat", "message": system_message})
    return {
        "ok": True,
        "channel": channel_id,
        "deleted_count": deleted,
        "system_message": system_message,
    }


@router.post("/messages/{message_id}/reactions")
async def toggle_message_reaction(message_id: int, body: ReactionToggleIn):
    if not body.emoji.strip():
        raise HTTPException(400, "Emoji is required")
    result = await db.toggle_message_reaction(
        message_id=message_id,
        actor_id=(body.actor_id or "user").strip() or "user",
        actor_type=body.actor_type,
        emoji=body.emoji.strip(),
    )
    message = await db.get_message_by_id(message_id)
    if message:
        from .websocket import manager
        await manager.broadcast(message["channel"], {
            "type": "reaction_update",
            "message_id": message_id,
            "summary": result["summary"],
        })
    return result


@router.get("/messages/{message_id}/reactions")
async def get_message_reaction_summary(message_id: int):
    return await db.get_message_reactions(message_id)


@router.get("/channels")
async def list_channels():
    """List all channels: group rooms + DMs for each active agent."""
    channels = await db.get_channels()
    agents = await db.get_agents(active_only=True)
    custom_names = await db.get_all_channel_names()

    result = []
    for ch in channels:
        name = custom_names.get(ch["id"], ch["name"])
        result.append({"id": ch["id"], "name": name, "type": ch["type"]})

    # Add DM channels (virtual, not stored in DB)
    for a in agents:
        dm_id = f"dm:{a['id']}"
        result.append({
            "id": dm_id,
            "name": custom_names.get(dm_id, f"DM: {a['display_name']}"),
            "type": "dm",
            "agent_id": a["id"],
        })
    return result


@router.post("/channels")
async def create_channel_route(body: dict):
    """Create a new chat room."""
    name = body.get("name", "").strip()
    if not name:
        return {"error": "Name required"}
    # Generate ID from name
    import re
    ch_id = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not ch_id:
        ch_id = f"room-{int(__import__('time').time())}"
    # Check for duplicates
    existing = await db.get_channels()
    if any(c["id"] == ch_id for c in existing):
        ch_id = f"{ch_id}-{int(__import__('time').time()) % 10000}"
    ch = await db.create_channel(ch_id, name, "group")
    return ch


@router.delete("/channels/{channel_id}")
async def delete_channel_route(channel_id: str, delete_messages: bool = True):
    """Delete a chat room and optionally its messages."""
    if channel_id == "main":
        return {"error": "Cannot delete Main Room"}
    await db.delete_channel(channel_id, delete_messages)
    return {"ok": True, "deleted": channel_id, "messages_deleted": delete_messages}


@router.patch("/channels/{channel_id}/name")
async def rename_channel(channel_id: str, body: dict):
    """Manually rename a channel."""
    name = body.get("name", "").strip()
    if not name:
        return {"error": "Name required"}
    await db.set_channel_name(channel_id, name)
    await db.rename_channel_db(channel_id, name)
    return {"ok": True, "channel": channel_id, "name": name}


@router.post("/projects")
async def create_project_route(body: ProjectCreateIn):
    from . import project_manager as pm

    try:
        project = await pm.create_project(body.name, template=body.template)
        from . import build_runner
        detected = await build_runner.detect_and_store_config(project["name"])
        channel_id = f"proj-{project['name']}"
        return {"ok": True, "project": project, "channel_id": channel_id, "detected_config": detected}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/projects")
async def list_projects_route():
    from . import project_manager as pm

    projects = await pm.list_projects()
    metadata_by_project = await db.list_project_metadata()
    # Enrich with best-effort stack detection from build config.
    from . import build_runner

    enriched = []
    for project in projects:
        name = (project.get("name") or "").strip()
        meta = metadata_by_project.get(name.lower(), {}) if name else {}
        display_name = (meta.get("display_name") or "").strip() or None
        if not display_name and name:
            display_key = f"project_display_name:{name}"
            display_name = await db.get_setting(display_key)
        config = build_runner.get_build_config(name) if name else {}
        detected = config.get("detected") if isinstance(config, dict) else {}
        if not isinstance(detected, dict):
            detected = {}
        kinds = sorted([k for k in detected.keys() if isinstance(k, str) and k.strip()])
        enriched.append(
            {
                **project,
                "display_name": display_name,
                "channel_id": f"proj-{name}" if name else None,
                "detected_kinds": kinds,
                "detected_kind": kinds[0] if kinds else None,
                "last_opened_at": meta.get("last_opened_at"),
                "preview_focus_mode": bool(meta.get("preview_focus_mode", 0)),
                "layout_preset": meta.get("layout_preset") or "split",
            }
        )
    return {"projects": enriched, "projects_root": str(pm.WORKSPACE_ROOT)}


@router.put("/projects/{name}/display-name")
async def set_project_display_name(name: str, body: dict):
    from . import project_manager as pm

    project = (name or "").strip().lower()
    if not project or not pm.validate_project_name(project):
        raise HTTPException(400, "Invalid project name.")

    display_name = str(body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(400, "display_name is required")
    if len(display_name) > 80:
        raise HTTPException(400, "display_name too long (max 80 chars)")

    key = f"project_display_name:{project}"
    await db.set_setting(key, display_name)
    meta = await db.upsert_project_metadata(project, display_name=display_name)
    return {"ok": True, "project": project, "display_name": display_name, "metadata": meta}


@router.get("/projects/{name}/ui-state", response_model=ProjectUIStateOut)
async def get_project_ui_state(name: str):
    from . import project_manager as pm

    project = (name or "").strip().lower()
    if not project or not pm.validate_project_name(project):
        raise HTTPException(400, "Invalid project name.")

    meta = await db.get_project_metadata(project)
    return ProjectUIStateOut(
        project_name=project,
        preview_focus_mode=bool(meta.get("preview_focus_mode", 0)),
        layout_preset=(meta.get("layout_preset") or "split"),
        pane_layout=meta.get("pane_layout") or {},
        last_opened_at=meta.get("last_opened_at"),
    )


@router.put("/projects/{name}/ui-state", response_model=ProjectUIStateOut)
async def set_project_ui_state(name: str, body: ProjectUIStateIn):
    from . import project_manager as pm

    project = (name or "").strip().lower()
    if not project or not pm.validate_project_name(project):
        raise HTTPException(400, "Invalid project name.")

    meta = await db.set_project_ui_state(
        project,
        preview_focus_mode=body.preview_focus_mode,
        layout_preset=body.layout_preset,
        pane_layout=body.pane_layout,
    )
    return ProjectUIStateOut(
        project_name=project,
        preview_focus_mode=bool(meta.get("preview_focus_mode", 0)),
        layout_preset=(meta.get("layout_preset") or "split"),
        pane_layout=meta.get("pane_layout") or {},
        last_opened_at=meta.get("last_opened_at"),
    )


@router.post("/projects/create_from_prompt")
async def create_project_from_prompt(body: ProjectCreateFromPromptIn):
    from . import project_manager as pm
    from . import spec_bank
    from . import build_runner

    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")

    requested = (body.project_name or "").strip().lower()
    if requested and not pm.validate_project_name(requested):
        raise HTTPException(400, "Invalid project_name. Use lowercase letters, numbers, and hyphens (max 50 chars).")

    template = body.template
    base = requested or _slugify_project_name(prompt)
    if not base:
        base = f"project-{int(__import__('time').time())}"

    created = None
    name = base
    if requested:
        created = await pm.create_project(name, template=template)
    else:
        # Auto-suffix to avoid collisions when name derived from prompt.
        last_error = ""
        for i in range(0, 50):
            candidate = base if i == 0 else f"{base[: max(0, 47 - len(str(i)))]}-{i}"
            candidate = candidate.strip("-")
            if not pm.validate_project_name(candidate):
                continue
            try:
                created = await pm.create_project(candidate, template=template)
                name = candidate
                break
            except ValueError as exc:
                last_error = str(exc)
                if "already exists" in last_error.lower():
                    continue
                raise HTTPException(400, last_error)
        if not created:
            raise HTTPException(400, last_error or "Unable to allocate a unique project name.")

    channel_id = f"proj-{name}"
    try:
        await db.create_channel(channel_id, name, "group")
    except Exception:
        # Channel is an implementation detail; messages do not require a channels-row to exist.
        pass

    active = await pm.switch_project(channel_id, name)
    detected = await build_runner.detect_and_store_config(name, root_override=active.get("path"))

    spec_md, idea_bank_md = _seed_spec_from_prompt(prompt, project_name=name, template=template)
    saved = spec_bank.save_current(name, spec_md=spec_md, idea_bank_md=idea_bank_md)
    state = await db.set_spec_state(channel_id, name, status="draft", spec_version=saved.get("version"))

    tasks = []
    for title, desc in [
        ("Define scope", "Confirm the user-facing goal, constraints, and definition of done."),
        ("Choose stack", "Confirm frontend/backend/runtime stack and project structure."),
        ("Scaffold repo", "Create the initial file structure and base implementation."),
        ("Run preview", "Configure preview_cmd/port and validate the preview loop end-to-end."),
    ]:
        tasks.append(
            await db.create_task_record(
                {"title": title, "description": desc, "status": "backlog", "created_by": "system"},
                channel=channel_id,
                project_name=name,
            )
        )

    return {
        "ok": True,
        "project": created,
        "channel": channel_id,
        "channel_id": channel_id,
        "active": active,
        "spec_status": state.get("status") or "draft",
        "spec_version": state.get("spec_version"),
        "created_tasks": tasks,
        "detected_config": detected,
    }


@router.post("/projects/import", response_model=ProjectImportOut)
async def import_project(
    zip_file: Optional[UploadFile] = File(default=None),
    files: Optional[list[UploadFile]] = File(default=None),
    project_name: Optional[str] = Query(default=None),
):
    import zipfile
    import time
    import shutil

    from . import project_manager as pm
    from . import build_runner
    from . import spec_bank

    requested = (project_name or "").strip().lower()
    if requested and not pm.validate_project_name(requested):
        raise HTTPException(400, "Invalid project_name. Use lowercase letters, numbers, and hyphens (max 50 chars).")

    if not zip_file and not files:
        raise HTTPException(400, "zip_file or files is required")

    # Decide name from provided value, zip base name, or timestamp.
    base = requested
    if not base and zip_file and (zip_file.filename or "").strip():
        stem = Path(zip_file.filename).stem
        base = _slugify_project_name(stem)
    if not base:
        base = f"import-{int(time.time())}"

    created = None
    name = base
    if requested:
        created = await pm.create_project(name, template=None)
    else:
        last_error = ""
        for i in range(0, 50):
            candidate = base if i == 0 else f"{base[: max(0, 47 - len(str(i)))]}-{i}"
            candidate = candidate.strip("-")
            if not pm.validate_project_name(candidate):
                continue
            try:
                created = await pm.create_project(candidate, template=None)
                name = candidate
                break
            except ValueError as exc:
                last_error = str(exc)
                if "already exists" in last_error.lower():
                    continue
                raise HTTPException(400, last_error)
        if not created:
            raise HTTPException(400, last_error or "Unable to allocate a unique project name.")

    channel_id = f"proj-{name}"
    try:
        await db.create_channel(channel_id, name, "group")
    except Exception:
        pass

    active = await pm.switch_project(channel_id, name)
    repo_root = Path(active.get("path") or "").resolve()
    if not repo_root.exists():
        raise HTTPException(500, "Workspace repo path is missing.")

    # Reset repo contents before import.
    for child in list(repo_root.iterdir()):
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=False)
            else:
                child.unlink(missing_ok=True)
        except Exception:
            pass

    extracted_files = 0

    def _normalize_rel(raw: str) -> str:
        rel = (raw or "").replace("\\", "/")
        while rel.startswith("/"):
            rel = rel[1:]
        while rel.startswith("./"):
            rel = rel[2:]
        return rel

    if zip_file:
        data = await zip_file.read()
        if len(data) > MAX_IMPORT_BYTES:
            raise HTTPException(413, f"Zip too large. Max size is {MAX_IMPORT_BYTES // (1024 * 1024)}MB.")

        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
        tmp_zip = UPLOADS_DIR / f"import-{stamp}-{_safe_filename(zip_file.filename or 'project.zip')}"
        tmp_zip.write_bytes(data)

        with zipfile.ZipFile(str(tmp_zip), "r") as zf:
            members = []
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name_in_zip = _normalize_rel(info.filename)
                if not name_in_zip or name_in_zip.startswith("__MACOSX/"):
                    continue
                if name_in_zip.startswith("../") or "/../" in f"/{name_in_zip}/":
                    continue
                members.append(name_in_zip)

            strip_prefix = None
            top_levels = {m.split("/")[0] for m in members if m}
            if len(top_levels) == 1 and any("/" in m for m in members):
                strip_prefix = next(iter(top_levels))

            for rel in members:
                if strip_prefix and rel.startswith(strip_prefix + "/"):
                    rel = rel[len(strip_prefix) + 1 :]
                if not rel:
                    continue
                target = (repo_root / rel).resolve()
                try:
                    target.relative_to(repo_root)
                except Exception:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(rel if not strip_prefix else f"{strip_prefix}/{rel}", "r") as src:
                    target.write_bytes(src.read())
                extracted_files += 1
    else:
        # Folder upload via `webkitdirectory`: client sends relative paths as the per-file "filename".
        file_items = list(files or [])
        names = [_normalize_rel(getattr(f, "filename", "") or "") for f in file_items]
        strip_prefix = None
        top_levels = {n.split("/")[0] for n in names if n}
        if len(top_levels) == 1 and any("/" in n for n in names):
            strip_prefix = next(iter(top_levels))

        total_bytes = 0
        for upload, rel in zip(file_items, names):
            if not rel:
                continue
            if strip_prefix and rel.startswith(strip_prefix + "/"):
                rel = rel[len(strip_prefix) + 1 :]
            if not rel:
                continue
            if rel.startswith("../") or "/../" in f"/{rel}/":
                continue
            payload = await upload.read()
            total_bytes += len(payload)
            if total_bytes > MAX_IMPORT_BYTES:
                raise HTTPException(413, f"Import too large. Max size is {MAX_IMPORT_BYTES // (1024 * 1024)}MB.")
            target = (repo_root / rel).resolve()
            try:
                target.relative_to(repo_root)
            except Exception:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            extracted_files += 1

    detected = await build_runner.detect_and_store_config(name, root_override=repo_root)

    # Seed a spec draft to force spec gate before mutating tools.
    spec_md, idea_bank_md = _seed_spec_from_prompt(
        f"Imported project `{name}`. Next: summarize what this repo is and how to run it.",
        project_name=name,
        template=None,
    )
    saved = spec_bank.save_current(name, spec_md=spec_md, idea_bank_md=idea_bank_md)
    await db.set_spec_state(channel_id, name, status="draft", spec_version=saved.get("version"))

    tasks_created = 0
    for title, desc in [
        ("Index file tree", "Scan the workspace tree and identify key entrypoints and configs."),
        ("Summarize architecture", "Write a short architecture summary grounded in actual files."),
        ("Generate Spec + Blueprint", "Update the spec and regenerate the blueprint based on findings."),
    ]:
        await db.create_task_record(
            {"title": title, "description": desc, "status": "backlog", "created_by": "system"},
            channel=channel_id,
            project_name=name,
        )
        tasks_created += 1

    # Brief artifact (deterministic V1).
    docs_dir = repo_root / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    brief_path = docs_dir / "PROJECT_BRIEF.md"
    if not brief_path.exists():
        brief_path.write_text(
            (
                f"# Project Brief: {name}\n\n"
                "## Imported\n"
                f"- Extracted files: {extracted_files}\n\n"
                "## Detected\n"
                f"- Kinds: {', '.join(sorted((detected or {}).get('detected', {}).keys())) or '(none)'}\n\n"
                "## Next\n"
                "- Open Spec tab, refine the spec, then click Approve Spec.\n"
                "- Configure Preview and Run.\n"
            ),
            encoding="utf-8",
        )

    return ProjectImportOut(
        ok=True,
        project=name,
        channel=channel_id,
        channel_id=channel_id,
        path=str(repo_root),
        extracted_files=extracted_files,
        brief_path=str(brief_path),
        tasks_created=tasks_created,
    )


@router.post("/projects/switch")
async def switch_project_route(body: ProjectSwitchIn):
    from . import project_manager as pm

    try:
        result = await pm.switch_project(body.channel, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    detection = await pm.maybe_detect_build_config(body.channel)
    return {"ok": True, "active": result, "detected_config": detection}


@router.get("/projects/active/{channel}", response_model=ProjectActiveOut)
async def get_active_project_route(channel: str):
    from . import project_manager as pm
    return await pm.get_active_project(channel)


@router.get("/spec/current")
async def get_current_spec(channel: str = Query(default="main")):
    from . import project_manager as pm
    from . import spec_bank

    channel_id = (channel or "main").strip() or "main"
    active = await pm.get_active_project(channel_id)
    project = (active.get("project") or "ai-office").strip() or "ai-office"
    state = await db.get_spec_state(channel_id, project)
    snap = spec_bank.get_current(project)
    return {
        "ok": True,
        "channel": channel_id,
        "project": project,
        "status": state.get("status") or "none",
        "spec_version": state.get("spec_version"),
        "spec_md": snap.spec_md,
        "idea_bank_md": snap.idea_bank_md,
        "spec_path": snap.spec_path,
        "idea_bank_path": snap.idea_bank_path,
        "updated_at": state.get("updated_at"),
    }


@router.post("/spec/current")
async def save_current_spec(body: SpecSaveIn):
    from . import project_manager as pm
    from . import spec_bank

    channel_id = (body.channel or "main").strip() or "main"
    active = await pm.get_active_project(channel_id)
    project = (active.get("project") or "ai-office").strip() or "ai-office"
    result = spec_bank.save_current(project, spec_md=body.spec_md or "", idea_bank_md=body.idea_bank_md)
    state = await db.set_spec_state(channel_id, project, status="draft", spec_version=result.get("version"))
    snap = spec_bank.get_current(project)
    return {
        **result,
        "channel": channel_id,
        "status": state.get("status") or "draft",
        "spec_version": state.get("spec_version"),
        "spec_md": snap.spec_md,
        "idea_bank_md": snap.idea_bank_md,
    }


@router.post("/spec/approve")
async def approve_spec(body: SpecApproveIn):
    from . import project_manager as pm

    channel_id = (body.channel or "main").strip() or "main"
    if (body.confirm_text or "").strip().upper() != "APPROVE SPEC":
        raise HTTPException(400, "confirm_text must be 'APPROVE SPEC'")

    active = await pm.get_active_project(channel_id)
    project = (active.get("project") or "ai-office").strip() or "ai-office"
    state = await db.set_spec_state(channel_id, project, status="approved")
    await db.log_console_event(
        channel=channel_id,
        project_name=project,
        event_type="spec_approved",
        source="spec",
        message="Spec approved",
        data={"status": state.get("status"), "spec_version": state.get("spec_version")},
    )
    return {"ok": True, "channel": channel_id, "project": project, **state}


@router.get("/spec/history")
async def spec_history(project: str = Query(default="ai-office"), limit: int = 50):
    from . import spec_bank

    return {"ok": True, "project": project, "items": spec_bank.list_history(project, limit=limit)}


@router.get("/blueprint/current")
async def get_current_blueprint(channel: str = Query(default="main")):
    from . import project_manager as pm
    from . import blueprint_bank

    channel_id = (channel or "main").strip() or "main"
    active = await pm.get_active_project(channel_id)
    project = (active.get("project") or "ai-office").strip() or "ai-office"
    snap = blueprint_bank.get_current(project)
    return {
        "ok": True,
        "channel": channel_id,
        "project": project,
        "blueprint": snap.blueprint,
        "blueprint_path": snap.blueprint_path,
    }


@router.post("/blueprint/regenerate")
async def regenerate_blueprint(channel: str = Query(default="main")):
    from . import project_manager as pm
    from . import spec_bank
    from . import blueprint_bank

    channel_id = (channel or "main").strip() or "main"
    active = await pm.get_active_project(channel_id)
    project = (active.get("project") or "ai-office").strip() or "ai-office"
    spec = spec_bank.get_current(project).spec_md

    generated = blueprint_bank.generate_from_spec(spec)
    saved = blueprint_bank.save_current(project, {"project": project, **generated})
    snap = blueprint_bank.get_current(project)
    await db.log_console_event(
        channel=channel_id,
        project_name=project,
        event_type="blueprint_regenerated",
        source="blueprint",
        message="Blueprint regenerated",
        data={"version": saved.get("version"), "nodes": len(generated.get("nodes", [])), "edges": len(generated.get("edges", []))},
    )
    return {
        "ok": True,
        "channel": channel_id,
        "project": project,
        "version": saved.get("version"),
        "blueprint": snap.blueprint,
        "blueprint_path": snap.blueprint_path,
        "history_path": saved.get("history_path"),
    }


@router.get("/projects/status/{channel}")
async def get_project_status_route(channel: str):
    from . import project_manager as pm
    return await pm.get_project_status(channel)


@router.get("/projects/{name}/autonomy-mode")
async def get_project_autonomy_mode(name: str):
    mode = await db.get_project_autonomy_mode(name)
    return {"project": name, "mode": mode}


@router.put("/projects/{name}/autonomy-mode")
async def set_project_autonomy_mode(name: str, body: AutonomyModeIn):
    try:
        mode = await db.set_project_autonomy_mode(name, body.mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "project": name, "mode": mode}


@router.get("/permissions", response_model=PermissionPolicyOut)
async def get_channel_permissions(channel: str = "main"):
    return await db.get_permission_policy(channel)


@router.put("/permissions", response_model=PermissionPolicyOut)
async def put_channel_permissions(body: PermissionPolicyIn):
    try:
        return await db.set_permission_policy(
            body.channel,
            mode=body.mode,
            expires_at=body.expires_at,
            scopes=body.scopes,
            command_allowlist_profile=body.command_allowlist_profile,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/trust_session", response_model=PermissionPolicyOut)
async def trust_session_permissions(body: TrustSessionIn):
    try:
        return await db.issue_trusted_session(
            body.channel,
            minutes=body.minutes,
            scopes=body.scopes,
            command_allowlist_profile=body.command_allowlist_profile,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/grant", response_model=PermissionPolicyOut)
async def grant_channel_permission(body: PermissionGrantIn):
    try:
        await db.grant_permission_scope(
            channel=body.channel,
            scope=body.scope,
            grant_level=body.grant_level,
            minutes=body.minutes,
            project_name=body.project_name,
            source_request_id=body.request_id,
            created_by=body.created_by,
        )
        return await db.get_permission_policy(body.channel)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/revoke", response_model=PermissionPolicyOut)
async def revoke_channel_permission(body: PermissionRevokeIn):
    try:
        await db.revoke_permission_grant(
            channel=body.channel,
            grant_id=body.grant_id,
            scope=body.scope,
            project_name=body.project_name,
        )
        return await db.get_permission_policy(body.channel)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/permissions/approval-response")
async def permissions_approval_response(body: ApprovalResponseIn):
    from . import tool_gateway
    from .websocket import manager

    resolved = await tool_gateway.resolve_approval_response(
        body.request_id,
        approved=body.approved,
        decided_by=body.decided_by,
    )
    if not resolved:
        raise HTTPException(404, "Approval request not found")

    await manager.broadcast(resolved["channel"], {
        "type": "approval_resolved",
        "request_id": body.request_id,
        "approved": bool(body.approved),
        "decided_by": body.decided_by,
    })
    return {"ok": True, "request": resolved}


@router.get("/approvals/pending")
async def approvals_pending(
    channel: str = Query(default="main"),
    project: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    requests = await db.list_pending_approval_requests(channel, project_name=project, limit=limit)
    return {"ok": True, "channel": channel, "project": project, "requests": requests}


@router.delete("/projects/{name}")
async def delete_project_route(name: str, confirm_token: Optional[str] = Query(default=None)):
    from . import project_manager as pm

    try:
        return await pm.delete_project(name, confirm_token=confirm_token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/projects/{name}/build-config")
async def get_project_build_config(name: str):
    from . import build_runner

    try:
        config = build_runner.get_build_config(name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"project": name, "config": config, "latest_result": build_runner.get_latest_result(name)}


@router.put("/projects/{name}/build-config")
async def put_project_build_config(name: str, body: BuildConfigIn):
    from . import build_runner

    try:
        config = build_runner.set_build_config(name, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "project": name, "config": config}


@router.post("/projects/{name}/build")
async def run_project_build(name: str, channel: Optional[str] = None):
    from . import build_runner
    from . import project_manager as pm

    cwd_override = None
    if channel:
        active = await pm.get_active_project(channel)
        if (active.get("project") or "").strip() != name:
            raise HTTPException(400, "Channel active project does not match build target.")
        cwd_override = active.get("path")
    return build_runner.run_build(name, cwd_override=cwd_override)


@router.post("/projects/{name}/test")
async def run_project_test(name: str, channel: Optional[str] = None):
    from . import build_runner
    from . import project_manager as pm

    cwd_override = None
    if channel:
        active = await pm.get_active_project(channel)
        if (active.get("project") or "").strip() != name:
            raise HTTPException(400, "Channel active project does not match test target.")
        cwd_override = active.get("path")
    return build_runner.run_test(name, cwd_override=cwd_override)


@router.post("/projects/{name}/run")
async def run_project_start(name: str, channel: Optional[str] = None):
    from . import build_runner
    from . import project_manager as pm

    cwd_override = None
    if channel:
        active = await pm.get_active_project(channel)
        if (active.get("project") or "").strip() != name:
            raise HTTPException(400, "Channel active project does not match run target.")
        cwd_override = active.get("path")
    return build_runner.run_start(name, cwd_override=cwd_override)


@router.get("/projects/{name}/branches")
async def list_project_branches_route(name: str, channel: Optional[str] = None):
    from . import git_tools
    from . import project_manager as pm

    result = git_tools.list_branches(name)
    if not result.get("ok"):
        return result
    active_branch = (
        await pm.get_active_branch(channel, name)
        if channel
        else (result.get("current_branch") or "main")
    )
    channel_state = await db.list_project_branches_state(name)
    return {
        **result,
        "active_branch": active_branch,
        "channel_branch_state": channel_state,
    }


@router.post("/projects/{name}/branches/switch")
async def switch_project_branch_route(name: str, body: BranchSwitchIn):
    from . import git_tools
    from . import project_manager as pm

    result = git_tools.switch_branch(
        name,
        body.branch,
        create_if_missing=bool(body.create_if_missing),
    )
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or result.get("stderr") or "Failed to switch branch")

    branch = (result.get("current_branch") or body.branch).strip() or "main"
    await pm.set_active_branch(body.channel, name, branch)
    active = await pm.get_active_project(body.channel)
    return {
        "ok": True,
        "project": name,
        "channel": body.channel,
        "branch": branch,
        "active": active,
        "git": result,
    }


@router.post("/projects/{name}/merge-preview")
async def merge_preview_route(name: str, body: MergePreviewIn):
    from . import git_tools
    return git_tools.merge_preview(name, body.source_branch, body.target_branch)


@router.post("/projects/{name}/merge-apply")
async def merge_apply_route(name: str, body: MergeApplyIn):
    from . import git_tools
    return git_tools.merge_apply(
        name,
        body.source_branch,
        body.target_branch,
        allow_dirty_override=bool(body.allow_dirty_override),
    )


@router.get("/projects/{name}/git/status")
async def git_status(name: str):
    from . import git_tools
    return git_tools.status(name)


@router.get("/projects/{name}/git/log")
async def git_log(name: str, limit: int = 20):
    from . import git_tools
    return git_tools.log(name, count=limit)


@router.get("/projects/{name}/git/diff")
async def git_diff(name: str):
    from . import git_tools
    return git_tools.diff(name)


@router.post("/projects/{name}/git/commit")
async def git_commit(name: str, body: dict):
    from . import git_tools
    return git_tools.commit(name, str(body.get("message", "")).strip())


@router.post("/projects/{name}/git/branch")
async def git_branch(name: str, body: dict):
    from . import git_tools
    return git_tools.branch(name, str(body.get("name", "")).strip())


@router.post("/projects/{name}/git/merge")
async def git_merge(name: str, body: dict):
    from . import git_tools
    return git_tools.merge(name, str(body.get("name", "")).strip())


@router.get("/projects/{name}/checkpoints")
async def list_checkpoints_route(name: str):
    from . import checkpoints
    return checkpoints.list_checkpoints(name)


@router.post("/projects/{name}/checkpoints")
async def create_checkpoint_route(name: str, body: CheckpointCreateIn):
    from . import checkpoints
    return checkpoints.create_checkpoint(name, body.name, body.note or "")


@router.post("/projects/{name}/checkpoints/restore")
async def restore_checkpoint_route(name: str, body: CheckpointRestoreIn):
    from . import checkpoints
    return checkpoints.restore_checkpoint(name, body.checkpoint_id, body.confirm)


@router.delete("/projects/{name}/checkpoints/{checkpoint_id:path}")
async def delete_checkpoint_route(name: str, checkpoint_id: str):
    from . import checkpoints
    return checkpoints.delete_checkpoint(name, checkpoint_id)


@router.get("/projects/{name}/search")
async def search_project_route(
    name: str,
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = 50,
    channel: str = "main",
):
    """Grep-like text search within a project's workspace (Oracle UI)."""
    from . import project_manager as pm
    from . import project_search

    root = pm.APP_ROOT if name == "ai-office" else pm.get_project_root(name)
    candidate = (root / channel / "repo").resolve()
    search_root = candidate if candidate.exists() else root.resolve()
    results = project_search.search_text(search_root, q, limit=limit)
    return {
        "ok": True,
        "project": name,
        "root": str(search_root),
        "results": results,
    }


@router.get("/oracle/search")
async def oracle_search_route(
    channel: str = "main",
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = 50,
):
    """Search within the active project's sandbox root for a channel."""
    from . import project_manager as pm
    from . import project_search

    active = await pm.get_active_project(channel)
    root = await pm.get_sandbox_root(channel)
    results = project_search.search_text(root, q, limit=limit)
    return {
        "ok": True,
        "channel": channel,
        "project": active.get("project", "ai-office"),
        "branch": active.get("branch", "main"),
        "root": str(root),
        "results": results,
    }


@router.post("/execute")
async def execute_code(body: ExecuteCodeIn):
    import subprocess
    import tempfile
    import time

    language = body.language
    code = body.code
    if "&&" in code or "||" in code:
        raise HTTPException(400, "Shell chaining is not allowed.")

    python_exe = _resolve_executable("python", executable_candidates("python"))
    node_exe = _resolve_executable("node", executable_candidates("node"))
    bash_exe = _resolve_executable("bash", executable_candidates("bash"))

    suffix_map = {"python": ".py", "javascript": ".js", "bash": ".sh"}
    run_map = {
        "python": [python_exe, "{file}"],
        "javascript": [node_exe, "{file}"],
        "bash": [bash_exe, "{file}"],
    }

    with tempfile.TemporaryDirectory(prefix="ai-office-exec-") as tmp:
        file_path = Path(tmp) / f"snippet{suffix_map[language]}"
        file_path.write_text(code, encoding="utf-8")
        args = [part if part != "{file}" else str(file_path) for part in run_map[language]]
        started = time.time()
        try:
            proc = subprocess.run(
                args,
                cwd=tmp,
                env=_runtime_env(),
                capture_output=True,
                text=True,
                timeout=30,
            )
            return {
                "stdout": (proc.stdout or "")[:12000],
                "stderr": (proc.stderr or "")[:8000],
                "exit_code": proc.returncode,
                "duration_ms": int((time.time() - started) * 1000),
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Execution timed out after 30s.",
                "exit_code": -1,
                "duration_ms": int((time.time() - started) * 1000),
            }


@router.post("/tasks")
async def create_task(task: TaskIn, channel: str = "main"):
    payload = task.model_dump()
    selected_channel = (payload.get("channel") or channel or "main").strip() or "main"
    if not payload["title"].strip():
        raise HTTPException(400, "Title is required.")
    if "branch" in payload and payload["branch"] is not None:
        payload["branch"] = str(payload["branch"]).strip() or None
    return await db.create_task_record(
        payload,
        channel=selected_channel,
        project_name=(payload.get("project_name") or None),
    )


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    branch: Optional[str] = None,
    channel: Optional[str] = None,
    project_name: Optional[str] = None,
):
    if status and status not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {status}")
    if branch is not None and not str(branch).strip():
        raise HTTPException(400, "branch cannot be empty")
    if channel is not None and not str(channel).strip():
        raise HTTPException(400, "channel cannot be empty")
    if project_name is not None and not str(project_name).strip():
        raise HTTPException(400, "project_name cannot be empty")
    return await db.list_tasks(status=status, branch=branch, channel=channel, project_name=project_name)


@router.get("/tasks/{task_id}")
async def get_task(task_id: int):
    task = await db.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.put("/tasks/{task_id}")
async def update_task(task_id: int, body: TaskUpdateIn):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No updates provided.")
    if "title" in updates and not str(updates["title"]).strip():
        raise HTTPException(400, "Title cannot be empty.")
    if "status" in updates and updates["status"] not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {updates['status']}")
    if "branch" in updates and not str(updates["branch"]).strip():
        raise HTTPException(400, "branch cannot be empty.")
    updated = await db.update_task(task_id, updates)
    if not updated:
        raise HTTPException(404, "Task not found")
    return updated


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int):
    ok = await db.delete_task(task_id)
    if not ok:
        raise HTTPException(404, "Task not found")
    return {"ok": True, "deleted": task_id}


@router.get("/health")
async def health():
    return {"status": "ok", "service": "ai-office"}


@router.get("/health/startup")
async def startup_health():
    from . import ollama_client
    from .project_manager import WORKSPACE_ROOT

    db_ok = False
    db_error = ""
    conn = None
    try:
        conn = await db.get_db()
        await conn.execute("SELECT 1")
        db_ok = True
    except Exception as exc:
        db_error = str(exc)
    finally:
        try:
            await conn.close()
        except Exception:
            pass

    projects_root_ok = WORKSPACE_ROOT.exists() and WORKSPACE_ROOT.is_dir()
    frontend_dist_ok = (PROJECT_ROOT / "client-dist" / "index.html").exists()
    openai_status_cfg = await provider_config.provider_status("openai", refresh=True)
    claude_status_cfg = await provider_config.provider_status("claude", refresh=True)
    backends = {
        "ollama": bool(await ollama_client.is_available()),
        "claude": bool(claude_status_cfg.get("configured")),
        "openai": bool(openai_status_cfg.get("configured")),
    }

    warnings = []
    if not frontend_dist_ok:
        warnings.append("frontend_dist_missing")
    if not backends["ollama"]:
        warnings.append("ollama_unavailable")
    if not backends["claude"]:
        warnings.append("claude_unavailable")
    if not backends["openai"]:
        warnings.append("openai_unavailable")

    checks = {
        "db": {"ok": db_ok, "error": db_error},
        "projects_root": {"ok": projects_root_ok, "path": str(WORKSPACE_ROOT)},
        "frontend_dist": {"ok": frontend_dist_ok},
        "backends": backends,
    }
    overall_healthy = db_ok and projects_root_ok
    return {
        "status": "ok" if overall_healthy else "degraded",
        "overall_healthy": overall_healthy,
        "checks": checks,
        "warnings": warnings,
    }


@router.get("/memory/shared")
async def get_shared_memory(limit: int = 50, type_filter: Optional[str] = None):
    from .memory import read_memory
    return read_memory(None, limit=limit, type_filter=type_filter)


@router.get("/memory/stats")
async def memory_stats(project: str = Query(default="ai-office")):
    from .memory import get_memory_stats
    return get_memory_stats(project)


@router.post("/memory/erase")
async def memory_erase(body: MemoryEraseIn):
    from .memory import erase_memory

    project = (body.project or "").strip() or "ai-office"
    channel = (body.channel or "main").strip() or "main"
    scopes = list(body.scopes or [])

    result = erase_memory(project, scopes)
    cleared = {"messages_deleted": 0, "tasks_deleted": 0, "approvals_deleted": 0}
    system_message = None

    if body.also_clear_tasks:
        cleared["tasks_deleted"] = await db.clear_tasks_for_scope(channel=channel, project_name=project)

    if body.also_clear_approvals:
        cleared["approvals_deleted"] = await db.clear_approval_requests_for_scope(channel=channel, project_name=project)

    if body.also_clear_channel_messages:
        cleared["messages_deleted"] = await db.clear_channel_messages(channel)
        system_message = await db.insert_message(
            channel=channel,
            sender="system",
            content="Chat history cleared.",
            msg_type="system",
        )
        from .websocket import manager
        await manager.broadcast(channel, {"type": "chat", "message": system_message})

    try:
        await db.log_console_event(
            channel=channel,
            event_type="memory_erase",
            source="controls",
            project_name=project,
            message=f"Memory erased: {', '.join(result.get('scopes_erased') or [])}",
            data={"scopes": result.get("scopes_erased") or [], "cleared": cleared},
        )
    except Exception:
        pass

    return {
        "ok": True,
        "project": project,
        "scopes_erased": result.get("scopes_erased") or [],
        "memory_stats": result.get("stats") or {},
        "cleared": cleared,
        "system_message": system_message,
    }


@router.get("/memory/{agent_id}")
async def get_agent_memory(agent_id: str, limit: int = 50):
    from .memory import read_all_memory_for_agent
    return read_all_memory_for_agent(agent_id, limit=limit)


@router.get("/audit")
async def get_audit_logs(
    limit: int = 200,
    agent_id: Optional[str] = None,
    tool_type: Optional[str] = None,
    channel: Optional[str] = None,
    task_id: Optional[str] = None,
    risk_level: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    conn = await db.get_db()
    try:
        where = []
        params = []
        if agent_id:
            where.append("tl.agent_id = ?")
            params.append(agent_id)
        if tool_type:
            where.append("tl.tool_type = ?")
            params.append(tool_type)
        if channel:
            where.append("tl.channel = ?")
            params.append(channel)
        if task_id:
            where.append("tl.task_id = ?")
            params.append(task_id)
        if risk_level:
            where.append("COALESCE(ar.risk_level, '') = ?")
            params.append(risk_level.strip().lower())
        if q:
            where.append("(tl.command LIKE ? OR tl.args LIKE ? OR tl.output LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])
        start_ts = _normalize_timestamp(date_from)
        end_ts = _normalize_timestamp(date_to)
        if start_ts:
            where.append("tl.created_at >= ?")
            params.append(start_ts)
        if end_ts:
            where.append("tl.created_at <= ?")
            params.append(end_ts)

        sql = (
            "SELECT tl.*, COALESCE(ar.risk_level, '') AS risk_level "
            "FROM tool_logs tl "
            "LEFT JOIN approval_requests ar ON ar.id = tl.approval_request_id"
        )
        if where:
            sql += " WHERE " + " AND ".join(where)
        safe_limit = max(1, min(int(limit), 1000))
        sql += " ORDER BY tl.id DESC LIMIT ?"
        params.append(safe_limit)
        rows = await conn.execute(sql, tuple(params))
        results = [dict(r) for r in await rows.fetchall()]
        results.reverse()
        return results
    finally:
        await conn.close()


@router.get("/audit/export")
async def export_audit_logs(
    channel: Optional[str] = None,
    task_id: Optional[str] = None,
    tool_type: Optional[str] = None,
    risk_level: Optional[str] = None,
):
    rows = await get_audit_logs(
        limit=1000,
        channel=channel,
        task_id=task_id,
        tool_type=tool_type,
        risk_level=risk_level,
    )
    return {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "filters": {
            "channel": channel,
            "task_id": task_id,
            "tool_type": tool_type,
            "risk_level": risk_level,
        },
        "count": len(rows),
        "rows": rows,
    }


@router.get("/audit/count")
async def get_audit_count():
    conn = await db.get_db()
    try:
        row = await conn.execute("SELECT COUNT(*) AS c FROM tool_logs")
        result = await row.fetchone()
        return {"count": int(result["c"] if result else 0)}
    finally:
        await conn.close()


@router.delete("/audit/logs")
async def clear_audit_logs():
    conn = await db.get_db()
    try:
        cursor = await conn.execute("DELETE FROM tool_logs")
        await conn.commit()
        return {"ok": True, "deleted_logs": int(cursor.rowcount or 0)}
    finally:
        await conn.close()


@router.delete("/audit/decisions")
async def clear_audit_decisions():
    conn = await db.get_db()
    try:
        cursor = await conn.execute("DELETE FROM decisions")
        await conn.commit()
        return {"ok": True, "deleted_decisions": int(cursor.rowcount or 0)}
    finally:
        await conn.close()


@router.delete("/audit/all")
async def clear_audit_all():
    conn = await db.get_db()
    try:
        logs_cursor = await conn.execute("DELETE FROM tool_logs")
        decisions_cursor = await conn.execute("DELETE FROM decisions")
        await conn.commit()
        return {
            "ok": True,
            "deleted_logs": int(logs_cursor.rowcount or 0),
            "deleted_decisions": int(decisions_cursor.rowcount or 0),
        }
    finally:
        await conn.close()


@router.get("/console/events/{channel}")
async def get_console_events_route(
    channel: str,
    limit: int = 200,
    event_type: Optional[str] = None,
    source: Optional[str] = None,
):
    return await db.get_console_events(
        channel=channel,
        limit=limit,
        event_type=event_type,
        source=source,
    )


@router.post("/debug/bundle")
async def export_debug_bundle(body: DebugBundleIn):
    from . import debug_bundle

    try:
        result = await debug_bundle.create_debug_bundle(
            channel=(body.channel or "main").strip() or "main",
            minutes=int(body.minutes or 30),
            include_prompts=bool(body.include_prompts),
            redact_secrets=bool(body.redact_secrets),
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))

    return FileResponse(
        path=str(result.path),
        media_type="application/zip",
        filename=result.file_name,
    )


@router.post("/tools/read")
async def tool_read(filepath: str, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_read_file
    return await tool_read_file(agent_id, filepath, channel=channel)


@router.post("/tools/search")
async def tool_search(pattern: str, directory: str = ".", channel: str = "main"):
    from .tool_gateway import tool_search_files
    return await tool_search_files("user", pattern, directory, channel=channel)


@router.post("/tools/run")
async def tool_run(request: Request, command: Optional[str] = None, agent_id: str = "user", channel: str = "main", approved: bool = False):
    from .tool_gateway import tool_run_command

    # Prefer structured JSON payloads (argv execution) when provided.
    if (request.headers.get("content-type") or "").lower().startswith("application/json"):
        try:
            raw = await request.json()
        except Exception:
            raw = None
        if isinstance(raw, dict) and raw:
            try:
                body = RunCommandIn(**raw)
            except Exception as exc:
                raise HTTPException(400, str(exc))
            return await tool_run_command(
                (body.agent_id or "user").strip() or "user",
                body.command or "",
                channel=(body.channel or "main").strip() or "main",
                approved=bool(body.approved),
                cmd=body.cmd,
                cwd=body.cwd,
                env=body.env,
                timeout=body.timeout,
            )

    if not (command or "").strip():
        raise HTTPException(400, "command is required")
    return await tool_run_command(agent_id, command, channel=channel, approved=bool(approved))


@router.post("/tools/write")
async def tool_write(filepath: str, content: str,
                     approved: bool = False, agent_id: str = "user", channel: str = "main"):
    from .tool_gateway import tool_write_file
    return await tool_write_file(agent_id, filepath, content, approved, channel=channel)


@router.post("/tools/web")
async def tool_web_search(query: str):
    from . import web_search
    return await web_search.search_web(query, limit=8)


@router.post("/tools/fetch")
async def tool_web_fetch(url: str):
    from . import web_search
    return await web_search.fetch_url(url)


@router.post("/tools/create-skill")
async def create_skill_route(body: CreateSkillIn):
    from . import skills_loader

    created = skills_loader.create_skill_scaffold(body.name)
    if not created.get("ok"):
        raise HTTPException(400, created.get("error", "Failed to create skill."))
    return {"ok": True, "skill": created}


@router.post("/skills/reload")
async def reload_skills_route():
    from . import skills_loader
    return skills_loader.reload_skills()


@router.post("/release-gate")
async def trigger_release_gate():
    from .release_gate import run_release_gate
    import asyncio
    task = asyncio.create_task(run_release_gate("main"))
    return {"status": "started", "message": "Release gate pipeline running in main room"}


@router.post("/app-builder/start")
async def start_app_builder_route(body: AppBuilderStartIn):
    from .app_builder import start_app_builder

    try:
        return await start_app_builder(
            channel=(body.channel or "main").strip() or "main",
            app_name=body.app_name,
            goal=body.goal,
            stack=body.stack,
            target_dir=body.target_dir,
            include_tests=body.include_tests,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/release-gate/history")
async def release_gate_history():
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            "SELECT * FROM decisions WHERE decided_by = 'release_gate' ORDER BY id DESC LIMIT 10")
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.post("/pulse/start")
async def start_pulse_endpoint():
    from .pulse import start_pulse
    start_pulse()
    return {"status": "started"}


@router.post("/pulse/stop")
async def stop_pulse_endpoint():
    from .pulse import stop_pulse
    stop_pulse()
    return {"status": "stopped"}


@router.get("/pulse/status")
async def pulse_status():
    from .pulse import get_pulse_status
    return get_pulse_status()


@router.post("/work/start")
async def work_start(body: dict):
    from .autonomous_worker import start_work

    channel = str(body.get("channel", "main")).strip() or "main"
    approved = bool(body.get("approved", False))
    return start_work(channel, approved=approved)


@router.post("/work/stop")
async def work_stop(body: dict):
    from .autonomous_worker import stop_work

    channel = str(body.get("channel", "main")).strip() or "main"
    return stop_work(channel)


@router.get("/work/status/{channel}")
async def work_status(channel: str):
    from .autonomous_worker import get_work_status

    return get_work_status(channel)


@router.post("/process/start")
async def process_start(body: ProcessStartIn):
    from . import process_manager

    try:
        result = await process_manager.start_process(
            channel=(body.channel or "main").strip() or "main",
            command=body.command,
            name=body.name,
            project=body.project,
            agent_id=(body.agent_id or "user").strip() or "user",
            approved=bool(body.approved),
            task_id=(body.task_id or "").strip() or None,
        )
        return {"ok": True, "process": result}
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/process/stop")
async def process_stop(body: ProcessStopIn):
    from . import process_manager

    try:
        result = await process_manager.stop_process(
            channel=(body.channel or "main").strip() or "main",
            process_id=body.process_id,
        )
        return {"ok": True, "process": result}
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.get("/process/list/{channel}")
async def process_list(channel: str, include_logs: bool = False):
    from . import process_manager

    processes = await process_manager.list_processes(channel, include_logs=include_logs)
    return {"channel": channel, "processes": processes}


@router.post("/process/kill-switch")
async def process_kill_switch(body: dict):
    from . import process_manager

    channel = str(body.get("channel", "main")).strip() or "main"
    result = await process_manager.kill_switch(channel)
    return result


@router.get("/process/orphans")
async def process_orphans(channel: Optional[str] = None, project: Optional[str] = None):
    from . import process_manager

    orphans = await process_manager.list_orphan_processes(channel=channel, project_name=project)
    return {"orphans": orphans, "count": len(orphans)}


@router.post("/process/orphans/cleanup")
async def process_orphans_cleanup(body: dict):
    from . import process_manager

    channel = str(body.get("channel") or "").strip() or None
    project = str(body.get("project_name") or body.get("project") or "").strip() or None
    raw_ids = body.get("process_ids") or body.get("process_id") or []
    if isinstance(raw_ids, (str, int)):
        raw_ids = [raw_ids]
    if not isinstance(raw_ids, list):
        raw_ids = []
    process_ids = [str(item).strip() for item in raw_ids if str(item).strip()]

    return await process_manager.cleanup_orphan_processes(
        channel=channel,
        project_name=project,
        process_ids=process_ids or None,
    )


@router.get("/conversation/{channel}")
async def conversation_status(channel: str):
    from .agent_engine import get_conversation_status
    return get_conversation_status(channel)


@router.get("/collab-mode/{channel}")
async def collab_mode_status(channel: str):
    from .agent_engine import get_collab_mode_status
    return get_collab_mode_status(channel)


@router.post("/conversation/{channel}/stop")
async def stop_conversation(channel: str):
    from .agent_engine import stop_conversation as _stop
    stopped = await _stop(channel)
    return {"stopped": stopped}


@router.patch("/tasks/{task_id}/status")
async def update_task_status(task_id: int, body: dict):
    new_status = str(body.get("status", "backlog")).strip().lower()
    if new_status not in db.TASK_STATUSES:
        raise HTTPException(400, f"Invalid status: {new_status}")
    task = await db.update_task(task_id, {"status": new_status})
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.get("/files/tree")
async def file_tree(path: str = ".", channel: str = "main"):
    """Get directory tree for file viewer (scoped to active project)."""
    from . import project_manager as pm

    root = (await pm.get_sandbox_root(channel)).resolve()
    base = (root / path).resolve()
    try:
        base.relative_to(root)
    except Exception:
        return {"error": "Outside sandbox"}

    items = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.name.startswith('.') or entry.name in ('node_modules', '__pycache__', '.git', 'data', 'venv', '.venv'):
                continue
            items.append({
                "name": entry.name,
                "path": str(entry.relative_to(root)).replace("\\", "/"),
                "type": "dir" if entry.is_dir() else "file",
                "size": entry.stat().st_size if entry.is_file() else None,
            })
    except Exception as e:
        return {"error": str(e)}
    return items


@router.get("/files/read")
async def file_read(path: str, channel: str = "main"):
    """Read file contents for file viewer (scoped to active project)."""
    from .tool_gateway import tool_read_file
    return await tool_read_file("viewer", path, channel=channel)


@router.post("/files/upload")
async def file_upload(file: UploadFile = File(...)):
    """Upload a user file for sharing in chat."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(file.filename or "upload.bin")
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S-%f")
    final_name = f"{stamp}-{safe_name}"
    target = UPLOADS_DIR / final_name

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Max size is {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.")

    target.write_bytes(data)
    rel_path = f"uploads/{final_name}"
    return {
        "ok": True,
        "original_name": file.filename or safe_name,
        "file_name": final_name,
        "path": rel_path,
        "url": f"/{rel_path}",
        "size": len(data),
        "content_type": file.content_type or "application/octet-stream",
    }


@router.get("/claude/status")
async def claude_status():
    status = await provider_config.provider_status("claude", refresh=True)
    cred_available = bool(await db.has_any_backend_key("claude"))
    available = bool(status.get("configured")) or cred_available
    return {
        "backend": "claude",
        "available": available,
        "key_source": status.get("key_source"),
        "via_credentials": cred_available,
        "key_ref": status.get("key_ref"),
        "key_masked": status.get("key_masked"),
        "base_url": status.get("base_url"),
        "model_default": status.get("model_default"),
        "last_tested_at": status.get("last_tested_at"),
        "last_error": status.get("last_error"),
    }


@router.get("/ollama/status")
async def ollama_status():
    from . import ollama_client
    return {"available": await ollama_client.is_available()}


@router.get("/ollama/models/recommendations")
async def ollama_model_recommendations():
    from . import ollama_client

    available = await ollama_client.is_available()
    installed = await ollama_client.list_models() if available else []
    installed_set = set(installed)
    model_map = _recommended_ollama_model_map()

    recommended = []
    for model_name in sorted(model_map.keys()):
        recommended.append({
            "model": model_name,
            "agents": sorted(model_map[model_name]),
            "installed": model_name in installed_set,
        })

    missing = [item["model"] for item in recommended if not item["installed"]]
    return {
        "available": available,
        "installed_models": installed,
        "recommended_models": recommended,
        "missing_models": missing,
        "missing_count": len(missing),
    }


@router.post("/ollama/models/pull")
async def ollama_pull_models(body: OllamaPullIn):
    from . import ollama_client

    if not await ollama_client.is_available():
        raise HTTPException(503, "Ollama is not available on 127.0.0.1:11434")

    installed = set(await ollama_client.list_models())
    recommended_map = _recommended_ollama_model_map()
    recommended = set(recommended_map.keys())
    requested = {m.strip() for m in body.models if m and m.strip()}

    targets = set(requested)
    if body.include_recommended:
        targets.update(recommended)

    if body.pull_missing_only:
        targets = {m for m in targets if m not in installed}

    if not targets:
        return {
            "status": "noop",
            "pulled": [],
            "failed": [],
            "message": "No models to pull.",
        }

    pulled: list[dict] = []
    failed: list[dict] = []
    for model_name in sorted(targets):
        result = await ollama_client.pull_model(model_name)
        if result.get("ok"):
            pulled.append(result)
        else:
            failed.append(result)

    return {
        "status": "completed" if not failed else "partial",
        "requested": sorted(targets),
        "pulled": pulled,
        "failed": failed,
        "pulled_count": len(pulled),
        "failed_count": len(failed),
    }


@router.get("/openai/status")
async def openai_status():
    status = await provider_config.provider_status("openai", refresh=True)
    cred_available = bool(await db.has_any_backend_key("openai"))
    available = bool(status.get("configured")) or cred_available
    return {
        "backend": "openai",
        "available": available,
        "key_source": status.get("key_source"),
        "via_credentials": cred_available,
        "key_ref": status.get("key_ref"),
        "key_masked": status.get("key_masked"),
        "base_url": status.get("base_url"),
        "model_default": status.get("model_default"),
        "reasoning_effort": status.get("reasoning_effort"),
        "last_tested_at": status.get("last_tested_at"),
        "last_error": status.get("last_error"),
    }

@router.get("/messages/search")
async def search_messages(q: str, channel: str = None, limit: int = 50):
    """Search messages across all channels or a specific one."""
    conn = await db.get_db()
    try:
        if channel:
            rows = await conn.execute(
                "SELECT * FROM messages WHERE content LIKE ? AND channel = ? ORDER BY created_at DESC LIMIT ?",
                (f"%{q}%", channel, limit))
        else:
            rows = await conn.execute(
                "SELECT * FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?",
                (f"%{q}%", limit))
        results = [dict(r) for r in await rows.fetchall()]
        return results
    finally:
        await conn.close()


@router.get("/agents/{agent_id}/profile")
async def agent_profile(agent_id: str):
    """Get agent profile with stats and recent memory."""
    from .memory import read_all_memory_for_agent
    agent = await db.get_agent(agent_id)
    if not agent:
        return {"error": "Not found"}

    conn = await db.get_db()
    try:
        # Message count
        row = await conn.execute(
            "SELECT COUNT(*) as count FROM messages WHERE sender = ?", (agent_id,))
        msg_count = (await row.fetchone())["count"]

        # Recent messages
        rows = await conn.execute(
            "SELECT * FROM messages WHERE sender = ? ORDER BY created_at DESC LIMIT 10", (agent_id,))
        recent = [dict(r) for r in await rows.fetchall()]

        # Memory
        memories = read_all_memory_for_agent(agent_id, limit=20)
        performance = await db.get_agent_performance(agent_id)

        return {
            **dict(agent),
            "message_count": msg_count,
            "recent_messages": recent,
            "memories": memories,
            "performance": performance,
        }
    finally:
        await conn.close()


@router.get("/decisions")
async def get_decisions(limit: int = 50):
    """Get all decisions."""
    conn = await db.get_db()
    try:
        rows = await conn.execute(
            "SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?", (limit,))
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.get("/usage")
async def api_usage(limit: int = 200):
    conn = await db.get_db()
    try:
        rows = await conn.execute("SELECT * FROM api_usage ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in await rows.fetchall()]
    finally:
        await conn.close()


@router.get("/usage/summary")
async def api_usage_summary(channel: Optional[str] = None, project: Optional[str] = None):
    summary = await db.get_api_usage_summary(channel=channel, project_name=project)
    budget_raw = await db.get_setting("api_budget_usd")
    if budget_raw is None:
        import os
        budget_raw = os.environ.get("API_USAGE_BUDGET_USD", "").strip()
    try:
        budget = float(budget_raw) if budget_raw else 0.0
    except Exception:
        budget = 0.0
    used = float(summary.get("total_estimated_cost", 0.0) or 0.0)
    return {
        **summary,
        "budget_usd": budget,
        "budget_warning": bool(budget > 0 and used >= budget * 0.8),
        "budget_exceeded": bool(budget > 0 and used >= budget),
        "remaining_usd": max(0.0, budget - used),
    }


@router.get("/usage/budget")
async def get_api_budget():
    value = await db.get_setting("api_budget_usd")
    if value is None:
        import os
        value = os.environ.get("API_USAGE_BUDGET_USD", "").strip()
    try:
        budget = float(value) if value else 0.0
    except Exception:
        budget = 0.0
    return {"budget_usd": budget}


@router.put("/usage/budget")
async def set_api_budget(body: dict):
    raw = str(body.get("budget_usd", "0")).strip()
    try:
        value = float(raw)
    except Exception:
        raise HTTPException(400, "budget_usd must be numeric")
    if value < 0:
        raise HTTPException(400, "budget_usd must be >= 0")
    await db.set_setting("api_budget_usd", str(value))
    return {"ok": True, "budget_usd": value}


@router.get("/performance/agents")
async def agents_performance():
    perf = await db.get_all_agent_performance()
    agents = await db.get_agents(active_only=False)
    meta = {a["id"]: a for a in agents}
    enriched = []
    for item in perf:
        aid = item["agent_id"]
        agent = meta.get(aid, {})
        enriched.append({
            **item,
            "display_name": agent.get("display_name", aid),
            "emoji": agent.get("emoji", "AI"),
            "color": agent.get("color", "#6B7280"),
        })
    return enriched


@router.post("/agents/{agent_id}/memory/cleanup")
async def cleanup_agent_memory(agent_id: str):
    """Remove duplicate memories for an agent."""
    from .memory import cleanup_memories
    removed = cleanup_memories(agent_id)
    shared_removed = cleanup_memories(None)
    return {"ok": True, "removed": removed, "shared_removed": shared_removed}


@router.get("/agents/{agent_id}/memories")
async def get_agent_memories(agent_id: str, limit: int = 100, type: str = None):
    """Get paginated memories for an agent."""
    from .memory import read_all_memory_for_agent, read_memory
    if type:
        personal = read_memory(agent_id, limit=limit, type_filter=type)
        shared = read_memory(None, limit=limit, type_filter=type)
        # Deduplicate
        seen = set()
        combined = []
        for entry in personal + shared:
            key = entry.get("content", "").lower().strip()
            if key not in seen:
                seen.add(key)
                combined.append(entry)
        combined.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return combined[:limit]
    else:
        memories = read_all_memory_for_agent(agent_id, limit=limit)
        memories.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return memories
