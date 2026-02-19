import { useEffect, useMemo, useState } from 'react';

const PROVIDERS = ['openai', 'claude', 'ollama'];
const DEFAULT_MODELS = {
  openai: 'gpt-5.2',
  claude: 'claude-opus-4-6',
  ollama: '',
};

function emptyDraft(provider) {
  return {
    provider,
    key_ref: provider === 'ollama' ? '' : `${provider}_default`,
    api_key: '',
    base_url: '',
    default_model: DEFAULT_MODELS[provider] || '',
  };
}

function renderProviderTestDetails(result) {
  if (!result?.details || typeof result.details !== 'object') return null;
  const text = JSON.stringify(result.details, null, 2);
  if (!text || text === '{}') return null;
  return <pre className="approval-preview" style={{ marginTop: 8 }}>{text}</pre>;
}

export default function ProviderSettings() {
  const [providers, setProviders] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState({});
  const [testing, setTesting] = useState({});
  const [results, setResults] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const providersByName = useMemo(() => {
    const map = {};
    (providers || []).forEach((row) => {
      map[row.provider] = row;
    });
    return map;
  }, [providers]);

  const loadProviders = async () => {
    const resp = await fetch('/api/providers');
    const payload = resp.ok ? await resp.json() : { providers: [] };
    const rows = Array.isArray(payload?.providers) ? payload.providers : [];
    setProviders(rows);
    const nextDrafts = {};
    PROVIDERS.forEach((provider) => {
      const existing = rows.find((row) => row.provider === provider);
      nextDrafts[provider] = {
        provider,
        key_ref: existing?.key_ref || (provider === 'ollama' ? '' : `${provider}_default`),
        api_key: '',
        base_url: existing?.base_url || '',
        default_model: existing?.default_model || DEFAULT_MODELS[provider] || '',
      };
    });
    setDrafts(nextDrafts);
  };

  useEffect(() => {
    loadProviders().catch(() => setError('Failed to load providers.'));
  }, []);

  const updateDraft = (provider, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] || emptyDraft(provider)), [key]: value },
    }));
  };

  const saveProvider = async (provider) => {
    const draft = drafts[provider] || emptyDraft(provider);
    setSaving((prev) => ({ ...prev, [provider]: true }));
    setError('');
    setNotice('');
    setResults((prev) => ({ ...prev, [provider]: null }));
    try {
      const resp = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          key_ref: (draft.key_ref || '').trim() || null,
          api_key: (draft.api_key || '').trim() || undefined,
          base_url: (draft.base_url || '').trim() || null,
          default_model: (draft.default_model || '').trim() || null,
        }),
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || `Failed to save ${provider} config.`);
      }
      setNotice(`${provider.toUpperCase()} config saved.`);
      await loadProviders();
    } catch (err) {
      setError(err?.message || `Failed to save ${provider} config.`);
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const testProvider = async (provider) => {
    const draft = drafts[provider] || emptyDraft(provider);
    setTesting((prev) => ({ ...prev, [provider]: true }));
    setResults((prev) => ({ ...prev, [provider]: null }));
    setError('');
    setNotice('');
    try {
      const resp = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: (draft.default_model || '').trim() || null,
          key_ref: (draft.key_ref || '').trim() || null,
          base_url: (draft.base_url || '').trim() || null,
        }),
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || `Connection test failed for ${provider}.`);
      }
      setResults((prev) => ({ ...prev, [provider]: payload }));
      if (payload?.ok) {
        setNotice(`${provider.toUpperCase()} connected (${payload.latency_ms || 0}ms).`);
      } else {
        setError(payload?.error || `${provider.toUpperCase()} test failed.`);
      }
    } catch (err) {
      setError(err?.message || `Connection test failed for ${provider}.`);
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="panel agent-config-panel">
      <div className="panel-header">
        <h3>Providers</h3>
        <button className="refresh-btn ui-btn" onClick={() => loadProviders().catch(() => setError('Failed to refresh providers.'))}>
          Refresh
        </button>
      </div>
      <div className="panel-body">
        <div className="agent-config-form">
          {PROVIDERS.map((provider) => {
            const row = providersByName[provider] || {};
            const draft = drafts[provider] || emptyDraft(provider);
            const isOllama = provider === 'ollama';
            const testResult = results[provider];
            return (
              <section key={provider} className="agent-config-form-wrap" style={{ marginBottom: 12 }}>
                <div className="agent-config-row">
                  <label>
                    <strong>{provider.toUpperCase()}</strong>
                  </label>
                  <div className="agent-config-status-row">
                    <span className={`backend-pill ${row?.has_key || isOllama ? 'online' : 'offline'}`}>
                      {row?.has_key || isOllama ? 'configured' : 'missing key'}
                    </span>
                    {!isOllama && <span className="agent-id-pill">last4: {row?.last4 || 'n/a'}</span>}
                    <span className="agent-id-pill">key_ref: {draft.key_ref || 'n/a'}</span>
                  </div>
                </div>

                <div className="agent-config-row two-col">
                  <div>
                    <label>Key Ref</label>
                    <input
                      className="ui-input"
                      value={draft.key_ref || ''}
                      onChange={(e) => updateDraft(provider, 'key_ref', e.target.value)}
                      disabled={isOllama}
                    />
                  </div>
                  <div>
                    <label>Default Model</label>
                    <input
                      className="ui-input"
                      value={draft.default_model || ''}
                      onChange={(e) => updateDraft(provider, 'default_model', e.target.value)}
                      disabled={isOllama}
                    />
                  </div>
                </div>

                <div className="agent-config-row">
                  <label>Base URL (optional)</label>
                  <input
                    className="ui-input"
                    value={draft.base_url || ''}
                    onChange={(e) => updateDraft(provider, 'base_url', e.target.value)}
                    placeholder={
                      provider === 'openai'
                        ? 'https://api.openai.com/v1'
                        : provider === 'claude'
                          ? 'https://api.anthropic.com/v1/messages'
                          : 'http://127.0.0.1:11434'
                    }
                  />
                </div>

                {!isOllama && (
                  <div className="agent-config-row">
                    <label>API Key (stored securely; masked after save)</label>
                    <input
                      className="ui-input"
                      type="password"
                      value={draft.api_key || ''}
                      onChange={(e) => updateDraft(provider, 'api_key', e.target.value)}
                      placeholder={row?.has_key ? '••••••••' : 'enter provider key'}
                    />
                  </div>
                )}

                <div className="agent-config-actions">
                  <button
                    className="control-btn gate-btn ui-btn ui-btn-primary"
                    onClick={() => saveProvider(provider)}
                    disabled={Boolean(saving[provider])}
                  >
                    {saving[provider] ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="control-btn ui-btn"
                    onClick={() => testProvider(provider)}
                    disabled={Boolean(testing[provider])}
                  >
                    {testing[provider] ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>

                {testResult && (
                  <div className={testResult.ok ? 'agent-config-notice' : 'agent-config-error'}>
                    {testResult.ok
                      ? `Connected in ${testResult.latency_ms || 0}ms`
                      : testResult.error || 'Connection failed'}
                    {renderProviderTestDetails(testResult)}
                  </div>
                )}
              </section>
            );
          })}
          {error && <div className="agent-config-error">{error}</div>}
          {notice && <div className="agent-config-notice">{notice}</div>}
        </div>
      </div>
    </div>
  );
}
