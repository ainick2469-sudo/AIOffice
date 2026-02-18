import { useEffect, useMemo, useState } from 'react';

function normalizePort(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const port = Math.trunc(n);
  if (port < 1 || port > 65535) return null;
  return port;
}

export default function PreviewPanel({ channel = 'main' }) {
  const [activeProject, setActiveProject] = useState('ai-office');
  const [activeBranch, setActiveBranch] = useState('main');
  const [config, setConfig] = useState(null);
  const [draftCmd, setDraftCmd] = useState('');
  const [draftPort, setDraftPort] = useState('');
  const [processes, setProcesses] = useState([]);
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/active/${encodeURIComponent(channel)}`)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error('Failed to load active project'))))
      .then((data) => {
        if (cancelled) return;
        const project = String(data?.project || 'ai-office').trim() || 'ai-office';
        const branch = String(data?.branch || 'main').trim() || 'main';
        setActiveProject(project);
        setActiveBranch(branch);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load project context.');
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(activeProject)}/build-config`)
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error('Failed to load build config'))))
      .then((data) => {
        if (cancelled) return;
        const cfg = data?.config || {};
        setConfig(cfg);
        setDraftCmd(String(cfg.preview_cmd || '').trim() || String(cfg.run_cmd || '').trim());
        setDraftPort(cfg.preview_port == null ? '' : String(cfg.preview_port));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load build config.');
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      fetch(`/api/process/list/${encodeURIComponent(channel)}?include_logs=true`)
        .then((resp) => (resp.ok ? resp.json() : { processes: [] }))
        .then((data) => {
          if (cancelled) return;
          const list = Array.isArray(data?.processes) ? data.processes : [];
          setProcesses(list);
        })
        .catch(() => {});
    };

    tick();
    const interval = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channel, activeProject]);

  const previewCandidates = useMemo(() => {
    return processes
      .filter((proc) => proc?.status === 'running')
      .filter((proc) => proc?.port || proc?.name === 'preview')
      .filter((proc) => !proc.project || proc.project === activeProject)
      .sort((a, b) => Number(b?.started_at || 0) - Number(a?.started_at || 0));
  }, [processes, activeProject]);

  const selectedProcess = useMemo(() => {
    const byId = previewCandidates.find((proc) => proc.id === selectedProcessId);
    if (byId) return byId;
    const preview = previewCandidates.find((proc) => proc.name === 'preview');
    if (preview) return preview;
    return previewCandidates[0] || null;
  }, [previewCandidates, selectedProcessId]);

  const effectivePort = useMemo(() => {
    const fromProcess = selectedProcess?.port ? Number(selectedProcess.port) : null;
    const fromDraft = normalizePort(draftPort);
    const fromConfig = normalizePort(config?.preview_port);
    return fromProcess || fromDraft || fromConfig || null;
  }, [selectedProcess, draftPort, config]);

  const previewUrl = effectivePort ? `http://127.0.0.1:${effectivePort}` : '';

  const savePreviewConfig = async () => {
    setError('');
    setNotice('');
    const payload = {
      preview_cmd: String(draftCmd || '').trim(),
      preview_port: normalizePort(draftPort),
    };
    const resp = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/build-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      throw new Error(data?.detail || 'Failed to save preview config.');
    }
    setConfig(data?.config || null);
    setNotice('Preview config saved.');
  };

  const startPreview = async () => {
    setError('');
    setNotice('');
    const cmd = String(draftCmd || '').trim() || String(config?.run_cmd || '').trim();
    if (!cmd) {
      setError('No preview command configured. Set preview_cmd (or run_cmd) in project build config.');
      return;
    }
    const resp = await fetch('/api/process/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel,
        command: cmd,
        name: 'preview',
        project: activeProject,
        agent_id: 'user',
        approved: true,
      }),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      setError(data?.detail || 'Failed to start preview process.');
      return;
    }
    setNotice('Preview started.');
    // Let the polling loop pick up the new process quickly.
    if (data?.process?.id) {
      setSelectedProcessId(String(data.process.id));
    }
  };

  const stopPreview = async () => {
    if (!selectedProcess?.id) return;
    setError('');
    setNotice('');
    const resp = await fetch('/api/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, process_id: selectedProcess.id }),
    });
    const data = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      setError(data?.detail || 'Failed to stop preview process.');
      return;
    }
    setNotice('Preview stopped.');
    // Let the polling loop pick up the stopped process quickly.
  };

  const restartPreview = async () => {
    await stopPreview();
    await startPreview();
  };

  const openExternal = () => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noreferrer');
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Preview</h3>
        <div className="preview-meta">
          <span className="pill">Project: {activeProject}</span>
          <span className="pill">Branch: {activeBranch}</span>
        </div>
      </div>

      <div className="panel-body preview-layout">
        <div className="preview-controls">
          <div className="preview-controls-row">
            <button className="control-btn gate-btn" onClick={startPreview}>
              Start Preview
            </button>
            <button className="control-btn" onClick={stopPreview} disabled={!selectedProcess || selectedProcess.status !== 'running'}>
              Stop
            </button>
            <button className="control-btn" onClick={restartPreview} disabled={!selectedProcess}>
              Restart
            </button>
            <button className="control-btn" onClick={openExternal} disabled={!previewUrl}>
              Open In Browser
            </button>
          </div>

          <div className="preview-controls-row">
            <label className="preview-field">
              Preview command
              <input value={draftCmd} onChange={(e) => setDraftCmd(e.target.value)} placeholder="npm run dev -- --host 127.0.0.1 --port 5173" />
            </label>
          </div>

          <div className="preview-controls-row">
            <label className="preview-field">
              Preferred port
              <input value={draftPort} onChange={(e) => setDraftPort(e.target.value)} placeholder="5173" />
            </label>
            <button className="control-btn" onClick={() => savePreviewConfig().catch((err) => setError(err?.message || 'Failed to save config.'))}>
              Save Config
            </button>
          </div>

          <div className="preview-controls-row">
            <label className="preview-field">
              Process
              <select
                value={selectedProcess?.id || ''}
                onChange={(e) => setSelectedProcessId(e.target.value)}
              >
                <option value="">(auto)</option>
                {previewCandidates.map((proc) => (
                  <option key={proc.id} value={proc.id}>
                    {proc.name || proc.id} {proc.port ? `:${proc.port}` : ''} [{proc.status}]
                  </option>
                ))}
              </select>
            </label>
            {selectedProcess && (
              <span className={`pill ${selectedProcess.status === 'running' ? 'pill-ok' : 'pill-warn'}`}>
                {selectedProcess.status}
              </span>
            )}
          </div>

          {error && <div className="agent-config-error">{error}</div>}
          {notice && <div className="agent-config-notice">{notice}</div>}
        </div>

        <div className="preview-surface">
          {!previewUrl && (
            <div className="preview-placeholder">
              <div>No preview URL yet.</div>
              <div className="preview-hint">
                If the process is running but no port is detected, add an explicit port flag to your preview command:
                <code> --port 5173</code> or <code> -p 5173</code>
              </div>
            </div>
          )}

          {previewUrl && (
            <iframe
              title="Preview"
              className="preview-iframe"
              src={previewUrl}
            />
          )}

          <div className="preview-logs">
            <div className="preview-logs-header">Logs</div>
            <pre className="preview-logs-body">
              {(selectedProcess?.logs || []).slice(-200).join('\n') || '(no logs)'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
