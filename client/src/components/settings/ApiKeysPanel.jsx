import { useCallback, useEffect, useMemo, useState } from 'react';

const PROVIDERS = [
  {
    id: 'openai',
    title: 'OpenAI / Codex',
    modelOptions: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-4o-mini'],
    baseUrlPlaceholder: 'https://api.openai.com/v1',
  },
  {
    id: 'claude',
    title: 'Anthropic Claude',
    modelOptions: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514'],
    baseUrlPlaceholder: 'https://api.anthropic.com/v1/messages',
  },
];

function createEmptyDraft() {
  return {
    openai: {
      api_key: '',
      model_default: 'gpt-5.2',
      base_url: '',
      reasoning_effort: 'high',
    },
    claude: {
      api_key: '',
      model_default: 'claude-opus-4-6',
      base_url: '',
    },
    fallback_to_ollama: false,
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

export default function ApiKeysPanel({ onError, onNotice, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [testing, setTesting] = useState({});
  const [showKey, setShowKey] = useState({ openai: false, claude: false });
  const [snapshot, setSnapshot] = useState({
    openai: {
      configured: false,
      key_masked: null,
      model_default: 'gpt-5.2',
      base_url: '',
      key_ref: 'openai_default',
      reasoning_effort: 'high',
      last_tested_at: null,
      last_error: null,
    },
    claude: {
      configured: false,
      key_masked: null,
      model_default: 'claude-opus-4-6',
      base_url: '',
      key_ref: 'claude_default',
      last_tested_at: null,
      last_error: null,
    },
    fallback_to_ollama: false,
  });
  const [draft, setDraft] = useState(createEmptyDraft);
  const [testResult, setTestResult] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settings/providers');
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed to load provider settings.');
      }
      setSnapshot(payload);
      setDraft({
        openai: {
          api_key: '',
          model_default: payload?.openai?.model_default || 'gpt-5.2',
          base_url: payload?.openai?.base_url || '',
          reasoning_effort: payload?.openai?.reasoning_effort || 'high',
        },
        claude: {
          api_key: '',
          model_default: payload?.claude?.model_default || 'claude-opus-4-6',
          base_url: payload?.claude?.base_url || '',
        },
        fallback_to_ollama: Boolean(payload?.fallback_to_ollama),
      });
    } catch (err) {
      onError?.(err?.message || 'Failed to load provider settings.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const statusLabels = useMemo(
    () => ({
      openai: statusLabelFromSnapshot('openai', snapshot),
      claude: statusLabelFromSnapshot('claude', snapshot),
    }),
    [snapshot]
  );

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
      onNotice?.(`${provider.toUpperCase()} settings saved.`);
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
      const response = await fetch('/api/providers/test', {
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
      await load();
      if (payload?.ok) {
        onNotice?.(`${provider.toUpperCase()} connection OK (${payload?.latency_ms || 0}ms).`);
      } else {
        onError?.(payload?.error || `${provider.toUpperCase()} test failed.`);
      }
    } catch (err) {
      onError?.(err?.message || `Failed to test ${provider}.`);
      setTestResult((prev) => ({
        ...prev,
        [provider]: { ok: false, error: err?.message || 'Unknown error', details: null },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>API Keys</h4>
          <p>
            Configure provider keys and defaults. Secrets are masked in API responses and never returned in full.
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

      <div className="settings-provider-grid">
        {PROVIDERS.map((provider) => {
          const providerId = provider.id;
          const lastError = snapshot?.[providerId]?.last_error;
          const testDetails = testResult?.[providerId]?.details || null;
          return (
            <article key={providerId} className="settings-provider-card panel">
              <header className="settings-provider-head">
                <div>
                  <h4>{provider.title}</h4>
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
                    value={draft?.[providerId]?.model_default || ''}
                    onChange={(event) => updateDraft(providerId, 'model_default', event.target.value)}
                  >
                    {provider.modelOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    {!provider.modelOptions.includes(draft?.[providerId]?.model_default) &&
                    (draft?.[providerId]?.model_default || '').trim() ? (
                      <option value={draft?.[providerId]?.model_default}>
                        {draft?.[providerId]?.model_default}
                      </option>
                    ) : null}
                  </select>
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
                    placeholder={provider.baseUrlPlaceholder}
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
                            model: draft?.[providerId]?.model_default || null,
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

                {testResult?.[providerId] ? (
                  <div className={testResult[providerId].ok ? 'agent-config-notice' : 'agent-config-error'}>
                    {testResult[providerId].ok
                      ? `Connected (${testResult[providerId].latency_ms || 0}ms)`
                      : testResult[providerId].error || 'Connection failed'}
                    {testDetails ? (
                      <details style={{ marginTop: 8 }}>
                        <summary>Raw details</summary>
                        <pre className="approval-preview" style={{ marginTop: 8 }}>
                          {JSON.stringify(testDetails, null, 2)}
                        </pre>
                        <button
                          type="button"
                          className="ui-btn ui-btn-ghost"
                          onClick={() =>
                            copyJson(testResult[providerId]).then((ok) => {
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
