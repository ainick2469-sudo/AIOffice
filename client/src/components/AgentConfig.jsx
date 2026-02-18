import { useEffect, useMemo, useState } from 'react';
import { fetchAgents, updateAgent } from '../api';

const BACKEND_OPTIONS = ['ollama', 'claude', 'openai'];
const DEFAULT_MODELS = {
  ollama: 'qwen2.5:14b',
  claude: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
};

function toDraft(agent) {
  return {
    display_name: agent.display_name || '',
    role: agent.role || '',
    backend: agent.backend || 'ollama',
    model: agent.model || '',
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [backendStatus, setBackendStatus] = useState({
    ollama: false,
    claude: false,
    openai: false,
  });

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.id === selectedId) || null,
    [agents, selectedId]
  );

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

  const handleBackendChange = (nextBackend) => {
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
          className="refresh-btn"
          onClick={handleRepairCodexDefaults}
          disabled={loading || saving}
          title="Repair Codex defaults if it still matches the legacy local-model signature."
        >
          Repair Codex Defaults
        </button>
        <button className="refresh-btn" onClick={handleRefresh} disabled={loading || saving}>
          Refresh
        </button>
      </div>

      <div className="panel-body agent-config-layout">
        <aside className="agent-config-list">
          <div className="agent-config-list-title">Staff ({agents.length})</div>
          {agents.map(agent => (
            <button
              key={agent.id}
              className={`agent-config-item ${selectedId === agent.id ? 'active' : ''}`}
              onClick={() => handleSelect(agent.id)}
            >
              <span className="agent-dot" style={{ backgroundColor: agent.color || '#6B7280' }} />
              <span className="agent-config-item-name">{agent.display_name}</span>
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
              </div>

              {error && <div className="agent-config-error">{error}</div>}
              {notice && <div className="agent-config-notice">{notice}</div>}

              <div className="agent-config-actions">
                <button className="control-btn gate-btn" onClick={handleSave} disabled={saving}>
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
