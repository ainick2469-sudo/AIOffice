import { useEffect, useMemo, useState } from 'react';
import useBodyScrollLock from '../../hooks/useBodyScrollLock';
import useEscapeKey from '../../hooks/useEscapeKey';

const FALLBACK_MODEL_OPTIONS = {
  openai: ['gpt-5.2-codex', 'gpt-5.2'],
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6'],
  ollama: ['qwen2.5:14b', 'llama3.2:latest', 'deepseek-coder:6.7b'],
};

function modelOptionsForBackend(modelCatalog, backend) {
  const providerCatalog = modelCatalog?.providers?.[backend];
  const rows = Array.isArray(providerCatalog?.models) ? providerCatalog.models : [];
  if (!rows.length) {
    return (FALLBACK_MODEL_OPTIONS[backend] || []).map((id) => ({
      id,
      label: id,
      available: null,
    }));
  }
  return rows.map((row) => ({
    id: String(row?.id || ''),
    label: String(row?.label || row?.id || ''),
    available: typeof row?.available === 'boolean' ? row.available : null,
  }));
}

function defaultModelForBackend(modelCatalog, backend) {
  const fromCatalog = String(modelCatalog?.providers?.[backend]?.selected_model_id || '').trim()
    || String(modelCatalog?.providers?.[backend]?.default_model_id || '').trim();
  if (fromCatalog) return fromCatalog;
  return FALLBACK_MODEL_OPTIONS[backend]?.[0] || '';
}

function defaultsFor(agent, modelCatalog) {
  const backend = agent?.backend || 'openai';
  const defaultModel = defaultModelForBackend(modelCatalog, backend);
  return {
    backend,
    model: agent?.model || defaultModel,
    provider_key_ref: agent?.provider_key_ref || (backend === 'ollama' ? '' : `${backend}_default`),
    base_url: agent?.base_url || '',
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text || response.statusText };
  }
}

export default function AgentConfigDrawer({
  open,
  agent,
  providerConfigs,
  modelCatalog,
  onClose,
  onSaved,
  onError,
  onNotice,
}) {
  const [draft, setDraft] = useState(() => defaultsFor(agent, modelCatalog));
  const [saving, setSaving] = useState(false);
  const [modelMode, setModelMode] = useState('list');
  const [credentialSource, setCredentialSource] = useState('provider_default');
  const [overrideMeta, setOverrideMeta] = useState(null);
  const [overrideKey, setOverrideKey] = useState('');
  const [overrideBaseUrl, setOverrideBaseUrl] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideTesting, setOverrideTesting] = useState(false);
  const [overrideTestResult, setOverrideTestResult] = useState(null);
  const [showOverrideKey, setShowOverrideKey] = useState(false);

  useBodyScrollLock(Boolean(open), 'settings-agent-config-drawer');

  useEffect(() => {
    setDraft(defaultsFor(agent, modelCatalog));
    setModelMode('list');
    setCredentialSource('provider_default');
    setOverrideMeta(null);
    setOverrideKey('');
    setOverrideBaseUrl('');
    setOverrideTestResult(null);
  }, [agent, modelCatalog]);

  useEscapeKey((event) => {
    if (!open) return;
    onClose?.();
    event.preventDefault();
  }, open);

  useEffect(() => {
    if (!open) return undefined;
    const onGlobalEscape = (event) => {
      onClose?.();
      if (event?.detail) event.detail.handled = true;
    };
    const onResetUi = () => {
      onClose?.();
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [open, onClose]);

  const modelSuggestions = useMemo(
    () => modelOptionsForBackend(modelCatalog, draft.backend),
    [modelCatalog, draft.backend]
  );
  const modelSuggestionIds = useMemo(
    () => modelSuggestions.map((item) => item.id),
    [modelSuggestions]
  );

  const keyOptions = useMemo(() => {
    if (draft.backend === 'ollama') return [];
    const fromProvider = (providerConfigs || [])
      .filter((row) => row.provider === draft.backend)
      .map((row) => row.key_ref)
      .filter(Boolean);
    const fallback = `${draft.backend}_default`;
    return Array.from(new Set([fallback, ...fromProvider]));
  }, [providerConfigs, draft.backend]);

  const providerRow = useMemo(
    () => (providerConfigs || []).find((row) => row.provider === draft.backend) || null,
    [providerConfigs, draft.backend]
  );

  const providerHasKey = Boolean(providerRow?.has_key);
  const overrideHasKey = Boolean(overrideMeta?.has_key);
  const effectiveSource = overrideHasKey ? 'agent override' : 'provider default';
  const missingProviderKey = draft.backend !== 'ollama' && !providerHasKey && !overrideHasKey;

  const updateDraft = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleBackendChange = (backend) => {
    const fallbackModel = defaultModelForBackend(modelCatalog, backend);
    updateDraft('backend', backend);
    updateDraft('model', fallbackModel);
    updateDraft('provider_key_ref', backend === 'ollama' ? '' : `${backend}_default`);
    setCredentialSource('provider_default');
    setOverrideMeta(null);
    setOverrideKey('');
    setOverrideBaseUrl('');
    setOverrideTestResult(null);
    setModelMode('list');
  };

  const fetchOverrideMeta = async () => {
    if (!open || !agent?.id) return;
    if (draft.backend !== 'openai' && draft.backend !== 'claude') {
      setOverrideMeta(null);
      return;
    }
    const response = await fetch(
      `/api/agents/${encodeURIComponent(agent.id)}/credentials?backend=${encodeURIComponent(draft.backend)}`
    );
    const payload = response.ok ? await response.json() : null;
    setOverrideMeta(payload);
    setOverrideBaseUrl(payload?.base_url || '');
    setCredentialSource(payload?.has_key ? 'agent_override' : 'provider_default');
  };

  useEffect(() => {
    fetchOverrideMeta().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent?.id, draft.backend]);

  if (!open || !agent) return null;

  const resetDefaults = () => {
    setDraft(defaultsFor(agent, modelCatalog));
    setModelMode('list');
    setOverrideKey('');
    setOverrideBaseUrl(overrideMeta?.base_url || '');
    setOverrideTestResult(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: draft.backend,
          model: String(draft.model || '').trim(),
          provider_key_ref:
            draft.backend === 'ollama'
              ? null
              : String(draft.provider_key_ref || '').trim() || null,
          base_url:
            draft.backend === 'ollama'
              ? null
              : String(draft.base_url || '').trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed to update agent runtime settings.');
      }
      onSaved?.(payload);
      onNotice?.(`Updated ${agent.display_name || agent.id}.`);
      onClose?.();
    } catch (error) {
      onError?.(error?.message || 'Failed to save agent settings.');
    } finally {
      setSaving(false);
    }
  };

  const saveOverrideCredentials = async () => {
    if (draft.backend !== 'openai' && draft.backend !== 'claude') return;
    if (!String(overrideKey || '').trim()) {
      onError?.('Override API key is required.');
      return;
    }
    setOverrideSaving(true);
    setOverrideTestResult(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: draft.backend,
          api_key: String(overrideKey || '').trim(),
          base_url: String(overrideBaseUrl || '').trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed to save override credentials.');
      }
      setOverrideMeta(payload);
      setOverrideKey('');
      setCredentialSource('agent_override');
      onSaved?.();
      onNotice?.(`Saved ${draft.backend.toUpperCase()} override key for ${agent.display_name || agent.id}.`);
    } catch (error) {
      onError?.(error?.message || 'Failed to save override credentials.');
    } finally {
      setOverrideSaving(false);
    }
  };

  const clearOverrideCredentials = async () => {
    if (draft.backend !== 'openai' && draft.backend !== 'claude') return;
    setOverrideSaving(true);
    setOverrideTestResult(null);
    try {
      const response = await fetch(
        `/api/agents/${encodeURIComponent(agent.id)}/credentials?backend=${encodeURIComponent(draft.backend)}`,
        { method: 'DELETE' }
      );
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed to clear override credentials.');
      }
      setOverrideMeta(null);
      setOverrideBaseUrl('');
      setCredentialSource('provider_default');
      onSaved?.();
      onNotice?.('Agent override credentials cleared. Runtime now uses provider default credentials.');
    } catch (error) {
      onError?.(error?.message || 'Failed to clear override credentials.');
    } finally {
      setOverrideSaving(false);
    }
  };

  const testCredentials = async () => {
    if (draft.backend !== 'openai' && draft.backend !== 'claude') return;
    setOverrideTesting(true);
    setOverrideTestResult(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/credentials/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: draft.backend,
          model: String(draft.model || '').trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Connection test failed.');
      }
      setOverrideTestResult(payload);
      if (payload?.ok) {
        onNotice?.(
          `${agent.display_name || agent.id}: ${payload.backend.toUpperCase()} test OK (${payload.latency_ms || 0}ms).`
        );
      } else {
        onError?.(payload?.error || 'Connection test failed.');
      }
    } catch (error) {
      onError?.(error?.message || 'Connection test failed.');
      setOverrideTestResult({ ok: false, error: error?.message || 'Connection test failed.' });
    } finally {
      setOverrideTesting(false);
    }
  };

  return (
    <div className="settings-drawer-backdrop" onClick={onClose}>
      <aside className="settings-agent-drawer panel" onClick={(event) => event.stopPropagation()}>
        <header className="settings-section-head">
          <div>
            <h4>{agent.display_name || agent.id}</h4>
            <p>Configure provider, model, and key source for this agent.</p>
          </div>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="settings-drawer-body">
          <div className="agent-runtime-row">
            <span><strong>Effective runtime</strong></span>
            <span className="agent-id-pill">{draft.backend}</span>
            <span className="agent-id-pill">{(draft.model || '(unset)').trim() || '(unset)'}</span>
            <span className="agent-id-pill">
              {effectiveSource}
              {overrideMeta?.last4 ? ` (${overrideMeta.last4})` : ''}
            </span>
          </div>

          {missingProviderKey && (
            <div className="agent-config-error">
              {draft.backend === 'openai'
                ? 'OpenAI key is missing. Set it in Settings -> Providers -> API Keys.'
                : 'Claude key is missing. Set it in Settings -> Providers -> API Keys.'}
            </div>
          )}

          <label className="settings-field">
            <span title="Provider selects runtime backend (OpenAI, Claude, Ollama)">Provider</span>
            <select
              className="ui-input"
              value={draft.backend}
              onChange={(event) => handleBackendChange(event.target.value)}
            >
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>

          <label className="settings-field">
            <span title="Model selects the exact model name used by this agent">Model</span>
            <div className="settings-inline-fields">
              <select
                className="ui-input"
                value={modelMode === 'custom' ? '__custom__' : draft.model}
                onChange={(event) => {
                  if (event.target.value === '__custom__') {
                    setModelMode('custom');
                    return;
                  }
                  setModelMode('list');
                  updateDraft('model', event.target.value);
                }}
              >
                {modelSuggestions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.available === false ? ' (Unavailable)' : ''}
                  </option>
                ))}
                {!modelSuggestionIds.includes(draft.model) && draft.model ? (
                  <option value={draft.model}>{draft.model}</option>
                ) : null}
                <option value="__custom__">Custom model...</option>
              </select>
              {modelMode === 'custom' ? (
                <input
                  className="ui-input"
                  type="text"
                  value={draft.model}
                  onChange={(event) => updateDraft('model', event.target.value)}
                  placeholder="Enter custom model"
                />
              ) : null}
            </div>
          </label>

          <label className="settings-field">
            <span title="Provider key reference used when 'Provider Defaults' is selected">Provider key ref</span>
            <select
              className="ui-input"
              value={draft.provider_key_ref}
              onChange={(event) => updateDraft('provider_key_ref', event.target.value)}
              disabled={draft.backend === 'ollama'}
            >
              {keyOptions.map((keyRef) => (
                <option key={keyRef} value={keyRef}>
                  {keyRef}
                </option>
              ))}
              {!keyOptions.length && <option value="">Not required</option>}
            </select>
          </label>

          <details className="settings-inline-details">
            <summary>Advanced</summary>
            <label className="settings-field">
              <span>Base URL override</span>
              <input
                className="ui-input"
                type="text"
                value={draft.base_url}
                disabled={draft.backend === 'ollama'}
                onChange={(event) => updateDraft('base_url', event.target.value)}
                placeholder={
                  draft.backend === 'openai'
                    ? 'https://api.openai.com/v1'
                    : draft.backend === 'claude'
                      ? 'https://api.anthropic.com/v1/messages'
                      : ''
                }
              />
            </label>
          </details>

          {(draft.backend === 'openai' || draft.backend === 'claude') && (
            <div className="settings-inline-details">
              <h5 style={{ margin: '4px 0 10px' }}>Credential Source</h5>
              <div className="settings-checkbox-row">
                <label>
                  <input
                    type="radio"
                    name="credential-source"
                    value="provider_default"
                    checked={credentialSource === 'provider_default'}
                    onChange={() => setCredentialSource('provider_default')}
                  />
                  Use provider defaults
                </label>
                <label>
                  <input
                    type="radio"
                    name="credential-source"
                    value="agent_override"
                    checked={credentialSource === 'agent_override'}
                    onChange={() => setCredentialSource('agent_override')}
                  />
                  Override for this agent
                </label>
              </div>

              {credentialSource === 'provider_default' ? (
                <div className="agent-config-notice">
                  Runtime uses provider key ref <strong>{draft.provider_key_ref || '(none)'}</strong>.
                  {overrideHasKey ? (
                    <>
                      {' '}
                      A per-agent override key is still stored. Clear it to fully switch back to provider default.
                    </>
                  ) : null}
                </div>
              ) : null}

              {credentialSource === 'agent_override' ? (
                <>
                  <label className="settings-field">
                    <span>Override API key</span>
                    <div className="settings-key-input">
                      <input
                        className="ui-input"
                        type={showOverrideKey ? 'text' : 'password'}
                        value={overrideKey}
                        onChange={(event) => setOverrideKey(event.target.value)}
                        placeholder={overrideHasKey ? '•••••••• (saved)' : 'Paste override key'}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost"
                        onClick={() => setShowOverrideKey((value) => !value)}
                      >
                        {showOverrideKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </label>
                  <label className="settings-field">
                    <span>Override base URL (optional)</span>
                    <input
                      className="ui-input"
                      type="text"
                      value={overrideBaseUrl}
                      onChange={(event) => setOverrideBaseUrl(event.target.value)}
                      placeholder={
                        draft.backend === 'openai'
                          ? 'https://api.openai.com/v1'
                          : 'https://api.anthropic.com/v1/messages'
                      }
                    />
                  </label>
                  <div className="settings-provider-actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary"
                      onClick={saveOverrideCredentials}
                      disabled={overrideSaving}
                    >
                      {overrideSaving ? 'Saving...' : 'Save Override'}
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={clearOverrideCredentials}
                      disabled={overrideSaving || !overrideHasKey}
                    >
                      Clear Override
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={testCredentials}
                      disabled={overrideTesting}
                    >
                      {overrideTesting ? 'Testing...' : 'Test'}
                    </button>
                  </div>
                  {overrideTestResult ? (
                    <div className={overrideTestResult.ok ? 'agent-config-notice' : 'agent-config-error'}>
                      {overrideTestResult.ok
                        ? `Connection OK (${overrideTestResult.latency_ms || 0}ms)`
                        : overrideTestResult.error || 'Connection failed'}
                      {overrideTestResult?.details ? (
                        <details style={{ marginTop: 8 }}>
                          <summary>Details</summary>
                          <pre className="approval-preview">{JSON.stringify(overrideTestResult.details, null, 2)}</pre>
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </div>

        <footer className="settings-drawer-actions">
          <button type="button" className="ui-btn ui-btn-ghost" onClick={resetDefaults}>
            Reset to default
          </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </footer>
      </aside>
    </div>
  );
}
