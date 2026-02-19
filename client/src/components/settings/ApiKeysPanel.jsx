import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PROVIDER_ORDER = ['openai', 'claude'];

const PROVIDER_META = {
  openai: {
    title: 'OpenAI / Codex',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    fallbackModel: 'gpt-5.2',
  },
  claude: {
    title: 'Anthropic Claude',
    baseUrlPlaceholder: 'https://api.anthropic.com/v1/messages',
    fallbackModel: 'claude-opus-4-6',
  },
};

function createEmptyDraft() {
  return {
    openai: {
      api_key: '',
      model_default: PROVIDER_META.openai.fallbackModel,
      base_url: '',
      reasoning_effort: 'high',
    },
    claude: {
      api_key: '',
      model_default: PROVIDER_META.claude.fallbackModel,
      base_url: '',
    },
    fallback_to_ollama: false,
  };
}

function modelOptionsFor(provider, modelCatalog) {
  const rows = modelCatalog?.providers?.[provider]?.models;
  if (!Array.isArray(rows) || !rows.length) {
    const fallback = PROVIDER_META[provider]?.fallbackModel || '';
    return fallback ? [{ id: fallback, label: fallback, available: null, availability_reason: null }] : [];
  }
  return rows.map((row) => ({
    id: String(row?.id || ''),
    label: String(row?.label || row?.id || ''),
    available: typeof row?.available === 'boolean' ? row.available : null,
    availability_reason: row?.availability_reason || null,
  }));
}

function resolveModelDefault(provider, snapshot, modelCatalog) {
  const fromSnapshot = String(snapshot?.[provider]?.model_default || '').trim();
  if (fromSnapshot) return fromSnapshot;
  const selected = String(modelCatalog?.providers?.[provider]?.selected_model_id || '').trim();
  if (selected) return selected;
  const defaultId = String(modelCatalog?.providers?.[provider]?.default_model_id || '').trim();
  if (defaultId) return defaultId;
  const firstCatalog = String((modelOptionsFor(provider, modelCatalog)[0] || {}).id || '').trim();
  if (firstCatalog) return firstCatalog;
  return PROVIDER_META[provider]?.fallbackModel || '';
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text || response.statusText };
  }
}

function statusLabelFromSnapshot(providerId, snapshot) {
  const row = snapshot?.[providerId] || {};
  if (row?.last_error) return 'Error';
  if (row?.configured) return 'Configured';
  return 'Not configured';
}

async function copyJson(value) {
  const text = JSON.stringify(value, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function prettyProvider(provider) {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'claude') return 'Claude';
  return String(provider || '').toUpperCase();
}

function formatErrorSummary(result) {
  if (!result) return '';
  if (result.ok) return '';
  const bits = [];
  if (result.error_code) bits.push(result.error_code);
  if (result.error) bits.push(result.error);
  return bits.join(' — ') || 'Connection test failed.';
}

function providerTestEndpoint(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'claude') {
    return `/api/providers/${normalized}/test`;
  }
  return '/api/providers/test';
}

function quotaHelpMessage(result) {
  const code = String(result?.error_code || '').toUpperCase();
  const detail = String(result?.error || '').toLowerCase();
  if (code === 'QUOTA_EXCEEDED' || detail.includes('quota') || detail.includes('billing')) {
    return 'This is account billing/usage limits (not a bad key). Check OpenAI Billing and project budgets.';
  }
  return '';
}

export default function ApiKeysPanel({
  modelCatalog,
  focusSignal,
  onError,
  onNotice,
  onSaved,
  onDiagnosticUpdate,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [testing, setTesting] = useState({});
  const [showKey, setShowKey] = useState({ openai: false, claude: false });
  const [snapshot, setSnapshot] = useState({
    openai: {
      configured: false,
      key_masked: null,
      model_default: PROVIDER_META.openai.fallbackModel,
      base_url: '',
      key_ref: 'openai_default',
      reasoning_effort: 'high',
      last_tested_at: null,
      last_error: null,
    },
    claude: {
      configured: false,
      key_masked: null,
      model_default: PROVIDER_META.claude.fallbackModel,
      base_url: '',
      key_ref: 'claude_default',
      last_tested_at: null,
      last_error: null,
    },
    fallback_to_ollama: false,
  });
  const [draft, setDraft] = useState(createEmptyDraft);
  const [testResult, setTestResult] = useState({});
  const providerRefs = useRef({});
  const diagnosticsRef = useRef(null);

  const registerProviderRef = useCallback((provider) => (node) => {
    if (!node) {
      delete providerRefs.current[provider];
      return;
    }
    providerRefs.current[provider] = node;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/providers');
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed to load provider settings.');
      }
      setSnapshot(payload);
      setDraft((prev) => ({
        openai: {
          ...prev.openai,
          api_key: '',
          model_default: resolveModelDefault('openai', payload, modelCatalog),
          base_url: payload?.openai?.base_url || '',
          reasoning_effort: payload?.openai?.reasoning_effort || prev?.openai?.reasoning_effort || 'high',
        },
        claude: {
          ...prev.claude,
          api_key: '',
          model_default: resolveModelDefault('claude', payload, modelCatalog),
          base_url: payload?.claude?.base_url || '',
        },
        fallback_to_ollama: Boolean(payload?.fallback_to_ollama),
      }));
    } catch (err) {
      onError?.(err?.message || 'Failed to load provider settings.');
    } finally {
      setLoading(false);
    }
  }, [modelCatalog, onError]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    setDraft((prev) => ({
      ...prev,
      openai: {
        ...prev.openai,
        model_default: prev.openai.model_default || resolveModelDefault('openai', snapshot, modelCatalog),
      },
      claude: {
        ...prev.claude,
        model_default: prev.claude.model_default || resolveModelDefault('claude', snapshot, modelCatalog),
      },
    }));
  }, [modelCatalog, snapshot]);

  useEffect(() => {
    const target = String(focusSignal?.target || '').trim().toLowerCase();
    if (!target.startsWith('providers:')) return undefined;
    const key = target.split(':')[1] || '';
    let node = null;
    if (key === 'diagnostics') {
      node = diagnosticsRef.current || providerRefs.current.openai || providerRefs.current.claude;
    } else {
      node = providerRefs.current[key] || null;
    }
    if (!node) return undefined;
    node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    node.classList.add('settings-focus-flash');
    const timer = window.setTimeout(() => node.classList.remove('settings-focus-flash'), 2200);
    return () => window.clearTimeout(timer);
  }, [focusSignal, loading]);

  const statusLabels = useMemo(
    () => ({
      openai: statusLabelFromSnapshot('openai', snapshot),
      claude: statusLabelFromSnapshot('claude', snapshot),
    }),
    [snapshot]
  );

  const optionsByProvider = useMemo(() => ({
    openai: modelOptionsFor('openai', modelCatalog),
    claude: modelOptionsFor('claude', modelCatalog),
  }), [modelCatalog]);

  const updateDraft = (provider, key, value) => {
    setDraft((prev) => ({
      ...prev,
      [provider]: {
        ...(prev[provider] || {}),
        [key]: value,
      },
    }));
  };

  const saveProvider = async (provider) => {
    setSaving((prev) => ({ ...prev, [provider]: true }));
    setTestResult((prev) => ({ ...prev, [provider]: null }));
    try {
      const providerPatch = {
        api_key: (draft?.[provider]?.api_key || '').trim() || undefined,
        model_default: (draft?.[provider]?.model_default || '').trim() || null,
        base_url: (draft?.[provider]?.base_url || '').trim() || null,
      };
      if (provider === 'openai') {
        providerPatch.reasoning_effort = draft?.openai?.reasoning_effort || 'high';
      }
      const response = await fetch('/api/settings/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [provider]: providerPatch,
          fallback_to_ollama: Boolean(draft?.fallback_to_ollama),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || `Failed to save ${provider} settings.`);
      }
      setSnapshot(payload);
      setDraft((prev) => ({
        ...prev,
        [provider]: {
          ...(prev[provider] || {}),
          api_key: '',
          model_default: payload?.[provider]?.model_default || prev?.[provider]?.model_default || '',
          base_url: payload?.[provider]?.base_url || '',
          reasoning_effort:
            provider === 'openai'
              ? payload?.openai?.reasoning_effort || prev?.openai?.reasoning_effort || 'high'
              : prev?.[provider]?.reasoning_effort,
        },
      }));
      onSaved?.();
      onNotice?.(`${prettyProvider(provider)} settings saved.`);
    } catch (err) {
      onError?.(err?.message || `Failed to save ${provider} settings.`);
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const testProvider = async (provider) => {
    setTesting((prev) => ({ ...prev, [provider]: true }));
    setTestResult((prev) => ({ ...prev, [provider]: null }));
    try {
      const endpoint = providerTestEndpoint(provider);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: (draft?.[provider]?.model_default || '').trim() || null,
          base_url: (draft?.[provider]?.base_url || '').trim() || null,
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || `Failed to test ${provider}.`);
      }
      setTestResult((prev) => ({ ...prev, [provider]: payload }));
      onDiagnosticUpdate?.(provider, {
        last_test_at: new Date().toISOString(),
        latency_ms: payload?.latency_ms || null,
        ok: Boolean(payload?.ok),
        request_id: payload?.request_id || null,
        status: payload?.status || null,
        details: payload?.details || null,
        error_summary: formatErrorSummary(payload),
      });
      await load();
      if (payload?.ok) {
        onNotice?.(`${prettyProvider(provider)} connection OK (${payload?.latency_ms || 0}ms).`);
      } else {
        const message = [payload?.error_code, payload?.error].filter(Boolean).join(': ') || `${prettyProvider(provider)} test failed.`;
        onError?.(payload?.hint ? `${message} ${payload.hint}` : message);
      }
    } catch (err) {
      onError?.(err?.message || `Failed to test ${provider}.`);
      const failed = { ok: false, error: err?.message || 'Unknown error', details: null };
      setTestResult((prev) => ({ ...prev, [provider]: failed }));
      onDiagnosticUpdate?.(provider, {
        last_test_at: new Date().toISOString(),
        latency_ms: null,
        ok: false,
        details: null,
        error_summary: failed.error,
      });
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>API Keys & Models</h4>
          <p>
            Configure provider keys and models from one source of truth. Secrets are masked and never returned in full.
          </p>
        </div>
        <button type="button" className="ui-btn" onClick={() => load().catch(() => {})} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </header>

      <label className="settings-checkbox-row">
        <input
          type="checkbox"
          checked={Boolean(draft?.fallback_to_ollama)}
          onChange={(event) => setDraft((prev) => ({ ...prev, fallback_to_ollama: event.target.checked }))}
        />
        <span>Allow fallback to Ollama when remote provider fails (default OFF).</span>
      </label>

      <div className="settings-provider-grid" ref={diagnosticsRef} data-settings-focus="providers:diagnostics">
        {PROVIDER_ORDER.map((providerId) => {
          const meta = PROVIDER_META[providerId];
          const lastError = snapshot?.[providerId]?.last_error;
          const result = testResult?.[providerId] || null;
          const selectedModel = String(draft?.[providerId]?.model_default || '').trim();
          const selectedOption = (optionsByProvider[providerId] || []).find((item) => item.id === selectedModel) || null;

          return (
            <article
              key={providerId}
              ref={registerProviderRef(providerId)}
              className="settings-provider-card panel"
              data-settings-focus={`providers:${providerId}`}
            >
              <header className="settings-provider-head">
                <div>
                  <h4>{meta.title}</h4>
                  <p>Key ref: {snapshot?.[providerId]?.key_ref || `${providerId}_default`}</p>
                </div>
                <span
                  className={`settings-status-pill settings-status-${statusLabels[providerId].toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {statusLabels[providerId]}
                </span>
              </header>

              <div className="settings-provider-body">
                <label className="settings-field">
                  <span>Stored key</span>
                  <input
                    className="ui-input"
                    type="text"
                    value={snapshot?.[providerId]?.key_masked || '(not set)'}
                    readOnly
                  />
                </label>

                <label className="settings-field">
                  <span>API key</span>
                  <div className="settings-key-input">
                    <input
                      className="ui-input"
                      type={showKey[providerId] ? 'text' : 'password'}
                      value={draft?.[providerId]?.api_key || ''}
                      onChange={(event) => updateDraft(providerId, 'api_key', event.target.value)}
                      placeholder="Paste key (masked after save)"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost"
                      onClick={() =>
                        setShowKey((prev) => ({ ...prev, [providerId]: !prev[providerId] }))
                      }
                    >
                      {showKey[providerId] ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>

                <label className="settings-field">
                  <span>Default model</span>
                  <select
                    className="ui-input"
                    value={selectedModel}
                    onChange={(event) => updateDraft(providerId, 'model_default', event.target.value)}
                  >
                    {(optionsByProvider[providerId] || []).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.available === false ? ' (Unavailable)' : ''}
                      </option>
                    ))}
                    {selectedModel && !(optionsByProvider[providerId] || []).some((option) => option.id === selectedModel) ? (
                      <option value={selectedModel}>{selectedModel} (Custom)</option>
                    ) : null}
                  </select>
                  {selectedOption?.availability_reason ? (
                    <small>{selectedOption.availability_reason}</small>
                  ) : null}
                </label>

                {providerId === 'openai' ? (
                  <label className="settings-field">
                    <span>Reasoning effort</span>
                    <select
                      className="ui-input"
                      value={draft?.openai?.reasoning_effort || 'high'}
                      onChange={(event) => updateDraft('openai', 'reasoning_effort', event.target.value)}
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                ) : null}

                <label className="settings-field">
                  <span>Base URL (optional)</span>
                  <input
                    className="ui-input"
                    type="text"
                    value={draft?.[providerId]?.base_url || ''}
                    onChange={(event) => updateDraft(providerId, 'base_url', event.target.value)}
                    placeholder={meta.baseUrlPlaceholder}
                  />
                </label>

                <div className="settings-provider-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => saveProvider(providerId)}
                    disabled={Boolean(saving[providerId])}
                  >
                    {saving[providerId] ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="ui-btn"
                    onClick={() => testProvider(providerId)}
                    disabled={Boolean(testing[providerId])}
                  >
                    {testing[providerId] ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>

                <div className="settings-provider-meta">
                  <small>Last tested: {snapshot?.[providerId]?.last_tested_at || 'never'}</small>
                </div>

                <div className="settings-provider-runtime panel">
                  <strong>Backend runtime config</strong>
                  <div className="settings-provider-runtime-grid">
                    <span>Provider: {prettyProvider(providerId)}</span>
                    <span>Model: {selectedModel || '(default)'}</span>
                    <span>Base URL: {draft?.[providerId]?.base_url || snapshot?.[providerId]?.base_url || meta.baseUrlPlaceholder}</span>
                    <span>Key source: {snapshot?.[providerId]?.key_source || 'none'}</span>
                    <span>Key ref: {snapshot?.[providerId]?.key_ref || `${providerId}_default`}</span>
                    <span>Fingerprint: {snapshot?.[providerId]?.key_fingerprint_last4 || 'n/a'}</span>
                  </div>
                </div>

                {lastError ? (
                  <div className="agent-config-error">
                    {lastError}
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost"
                        onClick={() =>
                          copyJson({
                            provider: providerId,
                            model: selectedModel || null,
                            last_error: lastError,
                            last_tested_at: snapshot?.[providerId]?.last_tested_at || null,
                          }).then((ok) => {
                            if (ok) onNotice?.('Diagnostics copied.');
                          })
                        }
                      >
                        Copy diagnostics
                      </button>
                    </div>
                  </div>
                ) : null}

                {result ? (
                  <div className={result.ok ? 'agent-config-notice' : 'agent-config-error'}>
                    {result.ok
                      ? `Connected (${result.latency_ms || 0}ms)`
                      : [result.error_code, result.error].filter(Boolean).join(': ') || 'Connection failed'}
                    {!result.ok && result?.request_id ? (
                      <p style={{ marginTop: 8 }}>Request ID: {result.request_id}</p>
                    ) : null}
                    {!result.ok && result?.status ? (
                      <p style={{ marginTop: 8 }}>HTTP status: {result.status}</p>
                    ) : null}
                    {!result.ok && quotaHelpMessage(result) ? (
                      <p style={{ marginTop: 8 }}>{quotaHelpMessage(result)}</p>
                    ) : null}
                    {!result.ok && result.hint ? <p style={{ marginTop: 8 }}>{result.hint}</p> : null}
                    {result?.details ? (
                      <details style={{ marginTop: 8 }}>
                        <summary>Raw details</summary>
                        <pre className="approval-preview" style={{ marginTop: 8 }}>
                          {JSON.stringify(result.details, null, 2)}
                        </pre>
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost"
                          onClick={() =>
                            copyJson(result).then((ok) => {
                              if (ok) onNotice?.('Test diagnostics copied.');
                            })
                          }
                        >
                          Copy diagnostics
                        </button>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
