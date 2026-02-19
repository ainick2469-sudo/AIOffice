import { useEffect, useMemo, useState } from 'react';
import { fetchAgents, updateAgent } from '../api';

const BACKEND_OPTIONS = ['ollama', 'claude', 'openai'];
const DEFAULT_MODELS = {
  ollama: 'qwen2.5:14b',
  claude: 'claude-opus-4-6',
  openai: 'gpt-5.2-codex',
};

function toDraft(agent) {
  return {
    display_name: agent.display_name || '',
    role: agent.role || '',
    backend: agent.backend || 'ollama',
    model: agent.model || '',
    provider_key_ref: agent.provider_key_ref || '',
    base_url: agent.base_url || '',
    permissions: agent.permissions || 'read',
    active: Boolean(agent.active),
    color: agent.color || '#6B7280',
    emoji: agent.emoji || 'A',
    system_prompt: agent.system_prompt || '',
  };
}

export default function AgentConfig() {
  const [agents, setAgents] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credSaving, setCredSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credMeta, setCredMeta] = useState(null);
  const [credKey, setCredKey] = useState('');
  const [credBaseUrl, setCredBaseUrl] = useState('');
  const [credTestBusy, setCredTestBusy] = useState(false);
  const [credTestResult, setCredTestResult] = useState(null);
  const [backendStatus, setBackendStatus] = useState({
    ollama: false,
    claude: false,
    openai: false,
  });

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedId) || null,
    [agents, selectedId]
  );

  const orderedAgents = useMemo(() => {
    const list = [...agents];
    list.sort((a, b) => {
      if (a.id === 'codex') return -1;
      if (b.id === 'codex') return 1;
      return String(a.display_name || a.id).localeCompare(String(b.display_name || b.id));
    });
    return list;
  }, [agents]);

  const applySelection = (list, preferredId = null) => {
    if (!Array.isArray(list) || list.length === 0) {
      setSelectedId(null);
      setDraft(null);
      return;
    }
    const nextId = preferredId && list.some(agent => agent.id === preferredId)
      ? preferredId
      : list[0].id;
    const nextAgent = list.find(agent => agent.id === nextId);
    setSelectedId(nextId);
    setDraft(nextAgent ? toDraft(nextAgent) : null);
  };

  const loadBackendStatus = async () => {
    const [ollama, claude, openai] = await Promise.all([
      fetch('/api/ollama/status').then(r => (r.ok ? r.json() : { available: false })),
      fetch('/api/claude/status').then(r => (r.ok ? r.json() : { available: false })),
      fetch('/api/openai/status').then(r => (r.ok ? r.json() : { available: false })),
    ]);
    setBackendStatus({
      ollama: Boolean(ollama?.available),
      claude: Boolean(claude?.available),
      openai: Boolean(openai?.available),
    });
  };

  const fetchAgentList = () => fetchAgents(false);

  const refreshAgents = async (preferredId = selectedId) => {
    const list = await fetchAgentList();
    const safeList = Array.isArray(list) ? list : [];
    setAgents(safeList);
    applySelection(safeList, preferredId);
  };

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchAgentList(), loadBackendStatus()])
      .then(([list]) => {
        if (cancelled) return;
        const safeList = Array.isArray(list) ? list : [];
        setAgents(safeList);
        applySelection(safeList);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load agents.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const interval = setInterval(() => {
      loadBackendStatus().catch(() => {});
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleSelect = (agentId) => {
    const next = agents.find(agent => agent.id === agentId);
    if (!next) return;
    setSelectedId(agentId);
    setDraft(toDraft(next));
    setNotice('');
    setError('');
  };

  const updateDraft = (field, value) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  const credentialsEnabled = draft && (draft.backend === 'openai' || draft.backend === 'claude');

  const loadCredentialMeta = async (agentId, backend) => {
    if (!agentId || !backend) return;
    const resp = await fetch(
      `/api/agents/${encodeURIComponent(agentId)}/credentials?backend=${encodeURIComponent(backend)}`
    );
    if (!resp.ok) {
      setCredMeta(null);
      return;
    }
    const payload = await resp.json();
    setCredMeta(payload);
    setCredBaseUrl(payload?.base_url || '');
  };

  useEffect(() => {
    if (!selectedId || !credentialsEnabled) {
      setCredMeta(null);
      setCredKey('');
      setCredBaseUrl('');
      setCredTestResult(null);
      return;
    }
    loadCredentialMeta(selectedId, draft.backend).catch(() => {});
  }, [selectedId, draft?.backend, credentialsEnabled]);

  const handleSaveCredentials = async () => {
    if (!selectedId || !credentialsEnabled) return;
    if (!credKey.trim()) {
      setError('API key is required.');
      return;
    }
    setCredSaving(true);
    setError('');
    setNotice('');
    try {
      const resp = await fetch(`/api/agents/${encodeURIComponent(selectedId)}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: draft.backend,
          api_key: credKey.trim(),
          base_url: (credBaseUrl || '').trim() || null,
        }),
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || 'Failed to save credentials.');
      }
      setCredKey('');
      setCredMeta(payload);
      await loadBackendStatus();
      setNotice('Credentials saved.');
    } catch (err) {
      setError(err?.message || 'Failed to save credentials.');
    } finally {
      setCredSaving(false);
    }
  };

  const handleClearCredentials = async () => {
    if (!selectedId || !credentialsEnabled) return;
    setCredSaving(true);
    setError('');
    setNotice('');
    try {
      const resp = await fetch(
        `/api/agents/${encodeURIComponent(selectedId)}/credentials?backend=${encodeURIComponent(draft.backend)}`,
        { method: 'DELETE' }
      );
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || 'Failed to clear credentials.');
      }
      setCredKey('');
      setCredMeta(null);
      setCredBaseUrl('');
      await loadBackendStatus();
      setNotice('Credentials cleared.');
    } catch (err) {
      setError(err?.message || 'Failed to clear credentials.');
    } finally {
      setCredSaving(false);
    }
  };

  const handleBackendChange = (nextBackend) => {
    setCredTestResult(null);
    setDraft(prev => {
      if (!prev) return prev;
      const currentModel = (prev.model || '').trim();
      const next = { ...prev, backend: nextBackend };

      // If the model clearly belongs to a different provider, nudge to a sane default.
      if (nextBackend === 'openai') {
        if (!currentModel || currentModel.includes(':') || currentModel.startsWith('claude-')) {
          next.model = DEFAULT_MODELS.openai;
        }
      } else if (nextBackend === 'claude') {
        if (!currentModel || currentModel.includes(':') || currentModel.startsWith('gpt-')) {
          next.model = DEFAULT_MODELS.claude;
        }
      } else if (nextBackend === 'ollama') {
        if (!currentModel || currentModel.startsWith('gpt-') || currentModel.startsWith('claude-')) {
          next.model = DEFAULT_MODELS.ollama;
        }
      }
      if (nextBackend === 'openai' && !(next.provider_key_ref || '').trim()) {
        next.provider_key_ref = 'openai_default';
      } else if (nextBackend === 'claude' && !(next.provider_key_ref || '').trim()) {
        next.provider_key_ref = 'claude_default';
      } else if (nextBackend === 'ollama') {
        next.provider_key_ref = '';
      }
      return next;
    });
  };

  const handleRepairCodexDefaults = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const resp = await fetch('/api/agents/repair', { method: 'POST' });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || 'Repair request failed.');
      }
      await refreshAgents(selectedId || 'codex');
      if (payload?.changed) {
        setNotice(
          `Repaired Codex defaults: ${payload.before.backend}/${payload.before.model} → ${payload.after.backend}/${payload.after.model}`
        );
      } else {
        setNotice('No repair needed.');
      }
      window.dispatchEvent(new Event('agents-updated'));
    } catch (err) {
      setError(err?.message || 'Failed to repair agent defaults.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestCredentials = async () => {
    if (!selectedId || !credentialsEnabled) return;
    setCredTestBusy(true);
    setError('');
    setNotice('');
    setCredTestResult(null);
    try {
      const resp = await fetch(`/api/agents/${encodeURIComponent(selectedId)}/credentials/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: draft.backend,
          model: (draft.model || '').trim() || null,
        }),
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || 'Connection test failed.');
      }
      setCredTestResult(payload);
      if (payload?.ok) {
        setNotice(`Connection OK (${payload.latency_ms || 0}ms)`);
      } else {
        setError(payload?.error || 'Connection test failed.');
      }
    } catch (err) {
      setError(err?.message || 'Connection test failed.');
    } finally {
      setCredTestBusy(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !draft) return;
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await updateAgent(selectedId, {
        display_name: draft.display_name.trim(),
        role: draft.role.trim(),
        backend: draft.backend,
        model: draft.model.trim(),
        provider_key_ref: (draft.provider_key_ref || '').trim() || null,
        base_url: (draft.base_url || '').trim() || null,
        permissions: draft.permissions.trim(),
        active: Boolean(draft.active),
        color: draft.color.trim(),
        emoji: draft.emoji.trim(),
        system_prompt: draft.system_prompt,
      });

      await refreshAgents(selectedId);
      await loadBackendStatus();
      setNotice('Agent updated.');
      window.dispatchEvent(new Event('agents-updated'));
    } catch (err) {
      setError(err?.message || 'Failed to save agent changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    setError('');
    setNotice('');
    Promise.all([refreshAgents(selectedId), loadBackendStatus()])
      .catch(() => setError('Failed to refresh data.'))
      .finally(() => setLoading(false));
  };

  const backendOnline = draft ? backendStatus[draft.backend] : false;

  return (
    <div className="panel agent-config-panel">
      <div className="panel-header">
        <h3>Agent Config</h3>
        <button
          className="refresh-btn ui-btn"
          onClick={handleRepairCodexDefaults}
          disabled={loading || saving}
          title="Repair Codex defaults if it still matches the legacy local-model signature."
        >
          Repair Codex Defaults
        </button>
        <button className="refresh-btn ui-btn" onClick={handleRefresh} disabled={loading || saving}>
          Refresh
        </button>
      </div>

      <div className="panel-body agent-config-layout">
        <aside className="agent-config-list">
          <div className="agent-config-list-title">Staff ({agents.length})</div>
          {orderedAgents.map(agent => (
            <button
              key={agent.id}
              className={`agent-config-item ${selectedId === agent.id ? 'active' : ''} ${agent.id === 'codex' ? 'agent-config-item-codex' : ''}`}
              onClick={() => handleSelect(agent.id)}
            >
              <span className="agent-dot" style={{ backgroundColor: agent.color || '#6B7280' }} />
              <span className="agent-config-item-name">{agent.display_name}</span>
              {agent.id === 'codex' && <span className="agent-id-pill">Codex</span>}
              {agent.id === 'codex' && (
                <span className={`agent-id-pill ${backendStatus.openai ? 'ok' : 'warn'}`}>
                  API {backendStatus.openai ? 'ready' : 'missing key'}
                </span>
              )}
              <span className={`agent-config-item-status ${agent.active ? 'on' : 'off'}`}>
                {agent.active ? 'active' : 'inactive'}
              </span>
            </button>
          ))}
        </aside>

        <section className="agent-config-form-wrap">
          {loading && <div className="panel-empty">Loading...</div>}
          {!loading && !draft && <div className="panel-empty">No agent selected.</div>}

          {!loading && draft && (
            <div className="agent-config-form">
              <div className="agent-config-row">
                <label>Name</label>
                <input
                  value={draft.display_name}
                  onChange={e => updateDraft('display_name', e.target.value)}
                />
              </div>

              <div className="agent-config-row">
                <label>Role</label>
                <input
                  value={draft.role}
                  onChange={e => updateDraft('role', e.target.value)}
                />
              </div>

              <div className="agent-config-row two-col">
                <div>
                  <label>Backend</label>
                  <select
                    value={draft.backend}
                    onChange={e => handleBackendChange(e.target.value)}
                  >
                    {BACKEND_OPTIONS.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Model</label>
                  <input
                    value={draft.model}
                    onChange={e => updateDraft('model', e.target.value)}
                  />
                </div>
              </div>

              <div className="agent-config-row two-col">
                <div>
                  <label>Provider Key Ref</label>
                  <input
                    value={draft.provider_key_ref || ''}
                    placeholder={draft.backend === 'openai' ? 'openai_default' : (draft.backend === 'claude' ? 'claude_default' : 'n/a')}
                    onChange={e => updateDraft('provider_key_ref', e.target.value)}
                    disabled={draft.backend === 'ollama'}
                  />
                </div>
                <div>
                  <label>Base URL Override (advanced)</label>
                  <input
                    value={draft.base_url || ''}
                    placeholder={draft.backend === 'openai' ? 'https://api.openai.com/v1' : (draft.backend === 'claude' ? 'https://api.anthropic.com/v1/messages' : 'optional')}
                    onChange={e => updateDraft('base_url', e.target.value)}
                    disabled={draft.backend === 'ollama'}
                  />
                </div>
              </div>

              <div className="agent-config-row">
                <label>Permissions</label>
                <input
                  value={draft.permissions}
                  onChange={e => updateDraft('permissions', e.target.value)}
                />
              </div>

              <div className="agent-config-row two-col">
                <div>
                  <label>Color</label>
                  <input
                    value={draft.color}
                    onChange={e => updateDraft('color', e.target.value)}
                  />
                </div>
                <div>
                  <label>Emoji</label>
                  <input
                    value={draft.emoji}
                    onChange={e => updateDraft('emoji', e.target.value)}
                  />
                </div>
              </div>

              <div className="agent-config-row agent-active-row">
                <label>Active</label>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={e => updateDraft('active', e.target.checked)}
                />
              </div>

              <div className="agent-config-row">
                <label>System Prompt</label>
                <textarea
                  rows={10}
                  value={draft.system_prompt}
                  onChange={e => updateDraft('system_prompt', e.target.value)}
                />
              </div>

              <div className="agent-config-status-row">
                <span className={`backend-pill ${backendOnline ? 'online' : 'offline'}`}>
                  {draft.backend.toUpperCase()} {backendOnline ? 'online' : 'offline'}
                </span>
                {selectedAgent && <span className="agent-id-pill">id: {selectedAgent.id}</span>}
                <span className="agent-id-pill">model: {(draft.model || '(unset)').trim() || '(unset)'}</span>
                {credentialsEnabled && (
                  <span className="agent-id-pill">
                    key: {credMeta?.has_key ? `present (${credMeta?.last4 || 'last4?'})` : 'missing'}
                  </span>
                )}
              </div>

              <div className="agent-runtime-row">
                <span><strong>Effective runtime</strong></span>
                <span className="agent-id-pill">{draft.backend}/{(draft.model || '(unset)').trim() || '(unset)'}</span>
                <span className="agent-id-pill">key_ref: {(draft.provider_key_ref || '(none)').trim() || '(none)'}</span>
                <span className="agent-id-pill">
                  credential: {credentialsEnabled ? (credMeta?.has_key ? 'present' : 'missing') : 'n/a'}
                </span>
                <span className={`agent-id-pill ${credTestResult?.ok ? 'ok' : credTestResult ? 'warn' : ''}`}>
                  last test: {credTestResult ? (credTestResult.ok ? `ok (${credTestResult.latency_ms || 0}ms)` : (credTestResult.error || 'failed')) : 'not run'}
                </span>
              </div>
              {draft.backend === 'openai' && !backendStatus.openai && (
                <div className="agent-config-error">
                  OpenAI key missing. Codex cannot run on OpenAI until you set a key in Settings -&gt; API Keys and run Test OpenAI.
                </div>
              )}
              {draft.backend === 'claude' && !backendStatus.claude && (
                <div className="agent-config-error">
                  Claude key missing. Configure Anthropic key in Settings -&gt; API Keys before using this backend.
                </div>
              )}

              {credentialsEnabled && (
                <div className="agent-config-form" style={{ marginTop: 12 }}>
                  <div className="agent-config-row">
                    <label>API Key (stored locally; never shown after save)</label>
                    <input
                      type="password"
                      value={credKey}
                      placeholder={credMeta?.has_key ? '••••••••' : 'enter key'}
                      onChange={(e) => setCredKey(e.target.value)}
                    />
                  </div>
                  <div className="agent-config-row">
                    <label>Base URL (optional)</label>
                    <input
                      value={credBaseUrl}
                      placeholder={draft.backend === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1/messages'}
                      onChange={(e) => setCredBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="agent-config-actions">
                    <button
                      className="control-btn gate-btn ui-btn ui-btn-primary"
                      onClick={handleSaveCredentials}
                      disabled={credSaving || saving}
                      title="Save per-agent credentials"
                    >
                      {credSaving ? 'Saving...' : 'Save Credentials'}
                    </button>
                    <button
                      className="control-btn ui-btn"
                      onClick={handleClearCredentials}
                      disabled={credSaving || saving || !credMeta?.has_key}
                      title="Remove stored credentials for this backend"
                    >
                      Clear
                    </button>
                    <button
                      className="control-btn ui-btn"
                      onClick={handleTestCredentials}
                      disabled={credSaving || saving || credTestBusy}
                      title="Test backend connection with the current credential binding"
                    >
                      {credTestBusy ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                  {credTestResult && (
                    <div className={`agent-config-${credTestResult.ok ? 'notice' : 'error'}`}>
                      {credTestResult.ok
                        ? `Connection ok (${credTestResult.latency_ms || 0}ms)`
                        : credTestResult.error || 'Connection failed'}
                      {credTestResult?.details && (
                        <pre className="approval-preview" style={{ marginTop: 8 }}>
                          {JSON.stringify(credTestResult.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {error && <div className="agent-config-error">{error}</div>}
              {notice && <div className="agent-config-notice">{notice}</div>}

              <div className="agent-config-actions">
                <button className="control-btn gate-btn ui-btn ui-btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
