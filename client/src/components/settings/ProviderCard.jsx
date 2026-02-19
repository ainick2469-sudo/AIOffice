import { useEffect, useMemo, useState } from 'react';
import ProviderDiagnostics from './ProviderDiagnostics';

const MODEL_SUGGESTIONS = {
  openai: ['gpt-5.2', 'gpt-5.2-codex', 'gpt-4o-mini'],
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-20250514'],
  ollama: ['qwen2.5:14b', 'llama3.2:latest', 'deepseek-coder:6.7b'],
};

function createDraft(provider, config) {
  const fallbackRef = provider === 'ollama' ? '' : `${provider}_default`;
  return {
    provider,
    key_ref: config?.key_ref || fallbackRef,
    api_key: '',
    base_url: config?.base_url || '',
    default_model: config?.default_model || MODEL_SUGGESTIONS[provider]?.[0] || '',
    timeout_ms: 12000,
    retry_count: 1,
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { text, data };
}

function friendlyError(message) {
  const source = String(message || '');
  if (!source) return 'Provider request failed.';
  if (source.toLowerCase().includes('no response')) {
    return 'No response from provider. This can happen if firewall/proxy/base URL blocks the request.';
  }
  return source;
}

function statusFor(provider, config, diagnostic) {
  if (diagnostic?.error_summary) return 'Error';
  if (provider === 'ollama') return 'Configured';
  if (config?.has_key) return 'Configured';
  return 'Not configured';
}

export default function ProviderCard({
  provider,
  beginnerMode = false,
  config,
  diagnostic,
  onProviderSaved,
  onDiagnosticUpdate,
  onError,
  onNotice,
}) {
  const [draft, setDraft] = useState(() => createDraft(provider, config));
  const [showKey, setShowKey] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawError, setRawError] = useState(null);

  useEffect(() => {
    setDraft(createDraft(provider, config));
  }, [provider, config]);

  useEffect(() => {
    if (beginnerMode && advancedOpen) {
      setAdvancedOpen(false);
    }
  }, [beginnerMode, advancedOpen]);

  const providerStatus = useMemo(
    () => statusFor(provider, config, diagnostic),
    [provider, config, diagnostic]
  );

  const modelSuggestions = MODEL_SUGGESTIONS[provider] || [];

  const writeDraft = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const saveProvider = async () => {
    setSaveBusy(true);
    setRawError(null);
    try {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          key_ref: String(draft.key_ref || '').trim() || null,
          api_key: String(draft.api_key || '').trim() || undefined,
          base_url: String(draft.base_url || '').trim() || null,
          default_model: String(draft.default_model || '').trim() || null,
        }),
      });
      const parsed = await parseResponse(response);
      if (!response.ok) {
        const detail = parsed?.data?.detail || parsed?.data?.error || response.statusText || 'Save failed.';
        throw {
          message: detail,
          status: response.status,
          bodySnippet: parsed.text ? parsed.text.slice(0, 500) : '',
        };
      }
      onProviderSaved?.(provider);
      onNotice?.(`${provider.toUpperCase()} settings saved.`);
      setDraft((prev) => ({ ...prev, api_key: '' }));
    } catch (error) {
      const friendly = friendlyError(error?.message);
      onError?.(friendly);
      setRawError({
        explanation: friendly,
        details: {
          http_status: error?.status || null,
          message: error?.message || 'No response from provider',
          response_body: error?.bodySnippet || '',
        },
      });
    } finally {
      setSaveBusy(false);
    }
  };

  const testProvider = async () => {
    setTestBusy(true);
    setRawError(null);
    const startedAt = Date.now();
    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: String(draft.default_model || '').trim() || null,
          key_ref: String(draft.key_ref || '').trim() || null,
          base_url: String(draft.base_url || '').trim() || null,
        }),
      });
      const parsed = await parseResponse(response);
      if (!response.ok) {
        const detail = parsed?.data?.detail || parsed?.data?.error || response.statusText || 'Test failed.';
        throw {
          message: detail,
          status: response.status,
          bodySnippet: parsed.text ? parsed.text.slice(0, 500) : '',
        };
      }
      const payload = parsed?.data || {};
      if (!payload?.ok) {
        throw {
          message: payload?.error || 'No response from provider',
          status: 200,
          bodySnippet: JSON.stringify(payload || {}, null, 2),
          details: payload?.details || null,
        };
      }
      const latency = Number(payload?.latency_ms || Date.now() - startedAt);
      onDiagnosticUpdate?.(provider, {
        last_test_at: new Date().toISOString(),
        latency_ms: latency,
        ok: true,
        details: payload?.details || null,
        error_summary: '',
      });
      onNotice?.(`${provider.toUpperCase()} test passed (${latency}ms).`);
    } catch (error) {
      const friendly = friendlyError(error?.message);
      onError?.(friendly);
      const details = {
        http_status: error?.status || null,
        message: error?.message || 'No response from provider',
        response_body: error?.bodySnippet || '',
        provider_details: error?.details || null,
      };
      setRawError({ explanation: friendly, details });
      onDiagnosticUpdate?.(provider, {
        last_test_at: new Date().toISOString(),
        latency_ms: null,
        ok: false,
        details,
        error_summary: friendly,
      });
    } finally {
      setTestBusy(false);
    }
  };

  const copyDiagnosticReport = async () => {
    if (!navigator?.clipboard?.writeText) return;
    const report = {
      provider,
      status: providerStatus,
      key_ref: draft.key_ref || '',
      base_url: draft.base_url || '',
      model: draft.default_model || '',
      last_test_at: diagnostic?.last_test_at || null,
      latency_ms: diagnostic?.latency_ms || null,
      last_error: diagnostic?.error_summary || null,
      details: diagnostic?.details || rawError?.details || null,
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    onNotice?.(`${provider.toUpperCase()} diagnostics copied.`);
  };

  return (
    <section className="settings-provider-card panel">
      <header className="settings-provider-head">
        <div>
          <h4>{provider.toUpperCase()}</h4>
          <p>
            {provider === 'openai' && 'Use OpenAI/Codex models for cloud generation.'}
            {provider === 'claude' && 'Use Anthropic Claude models for assistant tasks.'}
            {provider === 'ollama' && 'Use your local Ollama server for local models.'}
          </p>
        </div>
        <span className={`settings-status-pill settings-status-${providerStatus.toLowerCase().replace(/\s+/g, '-')}`}>
          {providerStatus}
        </span>
      </header>

      <div className="settings-provider-body">
        <label className="settings-field">
          <span>Key reference</span>
          <input
            className="ui-input"
            type="text"
            value={draft.key_ref}
            onChange={(event) => writeDraft('key_ref', event.target.value)}
            disabled={provider === 'ollama'}
            placeholder={provider === 'ollama' ? 'Not required for local Ollama' : `${provider}_default`}
          />
        </label>

        {provider !== 'ollama' && (
          <label className="settings-field">
            <span>API key</span>
            <div className="settings-key-input">
              <input
                className="ui-input"
                type={showKey ? 'text' : 'password'}
                value={draft.api_key}
                onChange={(event) => writeDraft('api_key', event.target.value)}
                placeholder={config?.has_key ? '•••••••• (saved)' : 'Paste API key'}
                autoComplete="off"
              />
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setShowKey((value) => !value)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <small>
              Paste your key from the provider dashboard. It unlocks model calls for agents using this key ref.
            </small>
          </label>
        )}

        <div className="settings-provider-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={saveProvider}
            disabled={saveBusy}
          >
            {saveBusy ? 'Saving...' : 'Paste & Save'}
          </button>
          <button
            type="button"
            className="ui-btn"
            onClick={testProvider}
            disabled={testBusy}
          >
            {testBusy ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        <button
          type="button"
          className="ui-btn ui-btn-ghost settings-advanced-toggle"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          {advancedOpen ? 'Hide Advanced' : 'Advanced'}
        </button>

        {advancedOpen && (
          <div className="settings-provider-advanced">
            <label className="settings-field">
              <span>Base URL override</span>
              <input
                className="ui-input"
                type="text"
                value={draft.base_url}
                onChange={(event) => writeDraft('base_url', event.target.value)}
                placeholder={
                  provider === 'openai'
                    ? 'https://api.openai.com/v1'
                    : provider === 'claude'
                      ? 'https://api.anthropic.com/v1/messages'
                      : 'http://127.0.0.1:11434'
                }
              />
            </label>

            <label className="settings-field">
              <span>Default model</span>
              <select
                className="ui-input"
                value={draft.default_model}
                onChange={(event) => writeDraft('default_model', event.target.value)}
              >
                {modelSuggestions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                {!modelSuggestions.includes(draft.default_model) && draft.default_model ? (
                  <option value={draft.default_model}>{draft.default_model}</option>
                ) : null}
              </select>
            </label>

            <div className="settings-inline-fields">
              <label className="settings-field">
                <span>Timeout (ms)</span>
                <input
                  className="ui-input"
                  type="number"
                  value={draft.timeout_ms}
                  min={2000}
                  max={120000}
                  onChange={(event) => writeDraft('timeout_ms', Number(event.target.value || 0))}
                />
              </label>
              <label className="settings-field">
                <span>Retries</span>
                <input
                  className="ui-input"
                  type="number"
                  value={draft.retry_count}
                  min={0}
                  max={5}
                  onChange={(event) => writeDraft('retry_count', Number(event.target.value || 0))}
                />
              </label>
            </div>
          </div>
        )}

        <ProviderDiagnostics
          provider={provider}
          status={providerStatus}
          diagnostic={diagnostic || {}}
          onCopyDiagnostics={copyDiagnosticReport}
        />

        {rawError ? (
          <div className="settings-provider-error agent-config-error">
            <div className="settings-provider-error-summary">
              <strong>{rawError.explanation}</strong>
              <p>
                Check key ref, base URL, network/firewall, and provider account access. This UI is showing raw details from the existing backend response.
              </p>
            </div>
            <details>
              <summary>Raw error details</summary>
              <pre>{JSON.stringify(rawError.details, null, 2)}</pre>
            </details>
            <button type="button" className="ui-btn" onClick={copyDiagnosticReport}>
              Copy
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
