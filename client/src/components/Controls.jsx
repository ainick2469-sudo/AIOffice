import { useState, useEffect } from 'react';
import { startAppBuilder, fetchOllamaRecommendations, pullOllamaModels } from '../api';

export default function Controls() {
  const [gateRunning, setGateRunning] = useState(false);
  const [gateHistory, setGateHistory] = useState([]);
  const [pulse, setPulse] = useState({ enabled: false, running: false, interval_seconds: 300 });
  const [builderGoal, setBuilderGoal] = useState('');
  const [builderAppName, setBuilderAppName] = useState('Generated App');
  const [builderStack, setBuilderStack] = useState('react-fastapi');
  const [builderTarget, setBuilderTarget] = useState('apps/generated-app');
  const [builderIncludeTests, setBuilderIncludeTests] = useState(true);
  const [builderRunning, setBuilderRunning] = useState(false);
  const [builderStatus, setBuilderStatus] = useState('');
  const [modelInfo, setModelInfo] = useState({
    available: false,
    installed_models: [],
    recommended_models: [],
    missing_models: [],
    missing_count: 0,
  });
  const [modelLoading, setModelLoading] = useState(false);
  const [modelPulling, setModelPulling] = useState(false);
  const [modelStatus, setModelStatus] = useState('');
  const [budget, setBudget] = useState(0);
  const [usage, setUsage] = useState(null);
  const [memoryProject, setMemoryProject] = useState('ai-office');
  const [memoryChannel, setMemoryChannel] = useState('main');
  const [memoryStats, setMemoryStats] = useState(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryErasing, setMemoryErasing] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState('');
  const [memoryConfirm, setMemoryConfirm] = useState('');
  const [memoryScopes, setMemoryScopes] = useState({
    facts: true,
    decisions: true,
    daily: false,
    agent_logs: false,
    index: true,
  });
  const [memoryAlso, setMemoryAlso] = useState({
    clear_messages: false,
    clear_tasks: false,
    clear_approvals: false,
  });

  useEffect(() => {
    fetch('/api/pulse/status').then(r => r.json()).then(setPulse).catch(() => {});
    fetch('/api/release-gate/history').then(r => r.json()).then(setGateHistory).catch(() => {});
    fetch('/api/usage/budget').then(r => r.json()).then((d) => setBudget(Number(d?.budget_usd || 0))).catch(() => {});
    fetch('/api/usage/summary').then(r => r.json()).then(setUsage).catch(() => {});
    fetch('/api/projects/active/main')
      .then(r => r.json())
      .then((active) => {
        const proj = active?.project || 'ai-office';
        setMemoryProject(proj);
        fetch(`/api/memory/stats?project=${encodeURIComponent(proj)}`)
          .then(r => r.json())
          .then(setMemoryStats)
          .catch(() => {});
      })
      .catch(() => {});
    refreshModelInfo();
  }, []);

  const triggerGate = () => {
    setGateRunning(true);
    fetch('/api/release-gate', { method: 'POST' })
      .then(r => r.json())
      .then(() => setTimeout(() => setGateRunning(false), 5000))
      .catch(() => setGateRunning(false));
  };

  const togglePulse = () => {
    const endpoint = pulse.enabled ? '/api/pulse/stop' : '/api/pulse/start';
    fetch(endpoint, { method: 'POST' })
      .then(r => r.json())
      .then(() => fetch('/api/pulse/status').then(r => r.json()).then(setPulse));
  };

  const triggerAppBuilder = async () => {
    const trimmedGoal = builderGoal.trim();
    if (!trimmedGoal) {
      setBuilderStatus('Please describe what app you want built.');
      return;
    }

    setBuilderRunning(true);
    setBuilderStatus('');
    try {
      const result = await startAppBuilder({
        channel: 'main',
        app_name: builderAppName.trim() || 'Generated App',
        goal: trimmedGoal,
        stack: builderStack,
        target_dir: builderTarget.trim() || null,
        include_tests: builderIncludeTests,
      });
      setBuilderStatus(
        `Started in #${result.channel}. Target: ${result.target_dir}. Seeded tasks: ${result.tasks_created}.`
      );
    } catch (err) {
      setBuilderStatus(err?.message || 'Failed to start app builder.');
    } finally {
      setBuilderRunning(false);
    }
  };

  const refreshModelInfo = async () => {
    setModelLoading(true);
    setModelStatus('');
    try {
      const info = await fetchOllamaRecommendations();
      setModelInfo(info);
      if (!info.available) {
        setModelStatus('Ollama is offline. Start Ollama to sync staff models.');
      } else if (info.missing_count === 0) {
        setModelStatus('All recommended staff models are installed.');
      } else {
        setModelStatus(`${info.missing_count} recommended model(s) are missing.`);
      }
    } catch (err) {
      setModelStatus(err?.message || 'Failed to load model readiness.');
    } finally {
      setModelLoading(false);
    }
  };

  const pullMissingModels = async () => {
    setModelPulling(true);
    setModelStatus('');
    try {
      const result = await pullOllamaModels({
        include_recommended: true,
        pull_missing_only: true,
      });
      setModelStatus(
        `Pull complete: ${result.pulled_count || 0} pulled, ${result.failed_count || 0} failed.`
      );
      await refreshModelInfo();
    } catch (err) {
      setModelStatus(err?.message || 'Failed to pull missing models.');
    } finally {
      setModelPulling(false);
    }
  };

  const saveBudget = () => {
    fetch('/api/usage/budget', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget_usd: Number(budget || 0) }),
    })
      .then(r => r.json())
      .then(() => fetch('/api/usage/summary').then(r => r.json()).then(setUsage))
      .catch(() => {});
  };

  const refreshMemoryStats = async (projectOverride = null) => {
    const proj = (projectOverride || memoryProject || 'ai-office').trim() || 'ai-office';
    setMemoryLoading(true);
    setMemoryStatus('');
    try {
      const res = await fetch(`/api/memory/stats?project=${encodeURIComponent(proj)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || 'Failed to load memory stats');
      }
      setMemoryStats(data);
      setMemoryProject(data?.project || proj);
    } catch (err) {
      setMemoryStatus(err?.message || 'Failed to load memory stats');
    } finally {
      setMemoryLoading(false);
    }
  };

  const eraseMemoryBanks = async () => {
    const proj = (memoryProject || 'ai-office').trim() || 'ai-office';
    const channel = (memoryChannel || 'main').trim() || 'main';
    const selectedScopes = Object.entries(memoryScopes).filter(([, v]) => v).map(([k]) => k);
    if (selectedScopes.length === 0 && !memoryAlso.clear_messages && !memoryAlso.clear_tasks && !memoryAlso.clear_approvals) {
      setMemoryStatus('Select at least one scope/toggle to erase.');
      return;
    }
    if (memoryConfirm.trim().toUpperCase() !== 'ERASE') {
      setMemoryStatus('Type ERASE to confirm.');
      return;
    }

    setMemoryErasing(true);
    setMemoryStatus('');
    try {
      const res = await fetch('/api/memory/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: proj,
          channel,
          scopes: selectedScopes,
          also_clear_channel_messages: !!memoryAlso.clear_messages,
          also_clear_tasks: !!memoryAlso.clear_tasks,
          also_clear_approvals: !!memoryAlso.clear_approvals,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || 'Memory erase failed');
      }
      setMemoryStats(data?.memory_stats || null);
      setMemoryConfirm('');
      setMemoryStatus(`Erased: ${(data?.scopes_erased || []).join(', ') || '(none)'} | Cleared tasks: ${data?.cleared?.tasks_deleted || 0} | Cleared approvals: ${data?.cleared?.approvals_deleted || 0}`);
      await refreshMemoryStats(proj);
    } catch (err) {
      setMemoryStatus(err?.message || 'Memory erase failed');
    } finally {
      setMemoryErasing(false);
    }
  };

  return (
    <div className="panel controls-panel">
      <div className="panel-header"><h3>Controls</h3></div>
      <div className="panel-body">
        <div className="control-section">
          <h4>API Budget</h4>
          <p className="control-desc">Set API spend threshold for hosted backends (Claude/OpenAI).</p>
          <div className="project-create-row">
            <input
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              style={{ maxWidth: 180 }}
            />
            <button className="control-btn gate-btn" onClick={saveBudget}>Save Budget</button>
          </div>
          {usage && (
            <div className="builder-status">
              Used: ${Number(usage.total_estimated_cost || 0).toFixed(3)} | Tokens: {usage.total_tokens || 0} | Remaining: ${Number(usage.remaining_usd || 0).toFixed(3)}
            </div>
          )}
        </div>

        <div className="control-section">
          <h4>Erase Memory Banks</h4>
          <p className="control-desc">
            Clear poisoned project memory safely (facts/decisions/daily/agent logs/index). Optional: clear tasks/approvals/messages for a channel.
          </p>
          <div className="project-create-row">
            <label className="builder-field" style={{ margin: 0 }}>
              <span>Project</span>
              <input
                type="text"
                value={memoryProject}
                onChange={(e) => setMemoryProject(e.target.value)}
                placeholder="ai-office"
                style={{ maxWidth: 240 }}
              />
            </label>
            <label className="builder-field" style={{ margin: 0 }}>
              <span>Channel</span>
              <input
                type="text"
                value={memoryChannel}
                onChange={(e) => setMemoryChannel(e.target.value)}
                placeholder="main"
                style={{ maxWidth: 160 }}
              />
            </label>
            <button className="control-btn pulse-btn" onClick={() => refreshMemoryStats()} disabled={memoryLoading}>
              {memoryLoading ? 'Loading...' : 'Refresh Stats'}
            </button>
          </div>
          {memoryStats && (
            <div className="builder-status">
              Facts: {memoryStats.facts_count} | Decisions: {memoryStats.decisions_count} | Daily files: {memoryStats.daily_files} | Agent entries: {memoryStats.agent_entries} | Index rows: {memoryStats.index_rows}
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            {Object.keys(memoryScopes).map((key) => (
              <label key={key} className="builder-checkbox" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={!!memoryScopes[key]}
                  onChange={(e) => setMemoryScopes({ ...memoryScopes, [key]: e.target.checked })}
                />
                <span>{key}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            <label className="builder-checkbox" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={!!memoryAlso.clear_tasks}
                onChange={(e) => setMemoryAlso({ ...memoryAlso, clear_tasks: e.target.checked })}
              />
              <span>Also clear tasks</span>
            </label>
            <label className="builder-checkbox" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={!!memoryAlso.clear_approvals}
                onChange={(e) => setMemoryAlso({ ...memoryAlso, clear_approvals: e.target.checked })}
              />
              <span>Also clear approvals</span>
            </label>
            <label className="builder-checkbox" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={!!memoryAlso.clear_messages}
                onChange={(e) => setMemoryAlso({ ...memoryAlso, clear_messages: e.target.checked })}
              />
              <span>Also clear channel messages</span>
            </label>
          </div>
          <div className="project-create-row" style={{ marginTop: 8 }}>
            <input
              type="text"
              value={memoryConfirm}
              onChange={(e) => setMemoryConfirm(e.target.value)}
              placeholder="Type ERASE to confirm"
              style={{ maxWidth: 240 }}
            />
            <button className="control-btn gate-btn" onClick={eraseMemoryBanks} disabled={memoryErasing}>
              {memoryErasing ? 'Erasing...' : 'Erase Selected'}
            </button>
          </div>
          {memoryStatus && <div className="builder-status">{memoryStatus}</div>}
        </div>

        <div className="control-section">
          <h4>Ollama Model Readiness</h4>
          <p className="control-desc">
            Keep staff-specific local models installed so routing and responses stay strong.
          </p>
          <div className="model-controls-row">
            <button className="control-btn pulse-btn" onClick={refreshModelInfo} disabled={modelLoading}>
              {modelLoading ? 'Checking...' : 'Refresh Model Status'}
            </button>
            <button
              className="control-btn gate-btn"
              onClick={pullMissingModels}
              disabled={modelPulling || modelLoading || !modelInfo.available}
            >
              {modelPulling ? 'Pulling...' : 'Pull Missing Recommended Models'}
            </button>
          </div>
          {modelStatus && <div className="builder-status">{modelStatus}</div>}
          <div className="model-list">
            {modelInfo.recommended_models?.length ? (
              modelInfo.recommended_models.map((entry) => (
                <div key={entry.model} className={`model-item ${entry.installed ? 'installed' : 'missing'}`}>
                  <div className="model-item-head">
                    <span className="model-name">{entry.model}</span>
                    <span className={`model-chip ${entry.installed ? 'installed' : 'missing'}`}>
                      {entry.installed ? 'Installed' : 'Missing'}
                    </span>
                  </div>
                  <div className="model-agents">Staff: {entry.agents.join(', ')}</div>
                </div>
              ))
            ) : (
              <div className="control-desc">No recommended Ollama models detected yet.</div>
            )}
          </div>
        </div>

        <div className="control-section">
          <h4>App Builder</h4>
          <p className="control-desc">
            Launch a structured multi-agent build run for a complete app implementation.
          </p>
          <div className="builder-grid">
            <label className="builder-field">
              <span>App name</span>
              <input
                type="text"
                value={builderAppName}
                onChange={(e) => setBuilderAppName(e.target.value)}
                placeholder="Generated App"
              />
            </label>
            <label className="builder-field">
              <span>Stack profile</span>
              <select value={builderStack} onChange={(e) => setBuilderStack(e.target.value)}>
                <option value="react-fastapi">React + FastAPI</option>
                <option value="react-node">React + Node</option>
                <option value="nextjs">Next.js</option>
                <option value="python-desktop">Python Desktop</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="builder-field builder-wide">
              <span>Target directory (inside repo)</span>
              <input
                type="text"
                value={builderTarget}
                onChange={(e) => setBuilderTarget(e.target.value)}
                placeholder="apps/generated-app"
              />
            </label>
            <label className="builder-field builder-wide">
              <span>Build goal</span>
              <textarea
                value={builderGoal}
                onChange={(e) => setBuilderGoal(e.target.value)}
                placeholder="Build a production-ready task manager with auth, CRUD APIs, and responsive UI."
              />
            </label>
          </div>
          <label className="builder-checkbox">
            <input
              type="checkbox"
              checked={builderIncludeTests}
              onChange={(e) => setBuilderIncludeTests(e.target.checked)}
            />
            <span>Require tests in app builder run</span>
          </label>
          <button
            className="control-btn gate-btn"
            onClick={triggerAppBuilder}
            disabled={builderRunning}
          >
            {builderRunning ? 'Starting...' : 'Start App Builder'}
          </button>
          {builderStatus && <div className="builder-status">{builderStatus}</div>}
        </div>

        <div className="control-section">
          <h4>Release Gate</h4>
          <p className="control-desc">Run multi-agent review pipeline</p>
          <button
            className="control-btn gate-btn"
            onClick={triggerGate}
            disabled={gateRunning}
          >
            {gateRunning ? '🔍 Running...' : '🚀 Run Release Gate'}
          </button>
          {gateHistory.length > 0 && (
            <div className="gate-history">
              <h5>Recent Results</h5>
              {gateHistory.slice(0, 3).map(g => (
                <div key={g.id} className={`gate-result ${g.title.includes('release_ready') ? 'pass' : 'fail'}`}>
                  <span>{g.title}</span>
                  <span className="gate-time">{new Date(g.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="control-section">
          <h4>Office Pulse</h4>
          <p className="control-desc">
            Periodic checks every {pulse.interval_seconds}s
          </p>
          <button className="control-btn pulse-btn" onClick={togglePulse}>
            {pulse.enabled ? '⏸ Stop Pulse' : '💓 Start Pulse'}
          </button>
          <span className={`pulse-status ${pulse.enabled ? 'active' : ''}`}>
            {pulse.enabled ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    </div>
  );
}
