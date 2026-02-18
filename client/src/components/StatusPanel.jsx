import { useCallback, useEffect, useMemo, useState } from 'react';

const TOOL_LOG_LIMIT = 20;
const CONSOLE_LIMIT = 50;
const APPROVAL_LIMIT = 25;
const POLL_MS = 5000;

const safeJson = async (response, fallback) => {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
};

const formatShortTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString();
};

export default function StatusPanel({ channel = 'main', onClose = null }) {
  const [activeProject, setActiveProject] = useState({ project: 'ai-office', branch: 'main' });
  const [specState, setSpecState] = useState({ status: 'none', spec_version: null });
  const [approvals, setApprovals] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [toolLogs, setToolLogs] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expandedToolLogs, setExpandedToolLogs] = useState({});
  const [expandedEvents, setExpandedEvents] = useState({});

  const specStatus = String(specState?.status || 'none').toUpperCase();

  const runningProcesses = useMemo(
    () => processes.filter((item) => item.status === 'running'),
    [processes]
  );

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const projectResp = await fetch(`/api/projects/active/${encodeURIComponent(channel)}`);
      const projectPayload = await safeJson(projectResp, {});
      const projectName = projectResp.ok ? (projectPayload?.project || 'ai-office') : 'ai-office';
      const branch = projectResp.ok ? (projectPayload?.branch || 'main') : 'main';
      setActiveProject({ project: projectName, branch });

      const [specResp, approvalsResp, procResp, auditResp, consoleResp] = await Promise.all([
        fetch(`/api/spec/current?channel=${encodeURIComponent(channel)}`),
        fetch(`/api/approvals/pending?channel=${encodeURIComponent(channel)}&project=${encodeURIComponent(projectName)}&limit=${APPROVAL_LIMIT}`),
        fetch(`/api/process/list/${encodeURIComponent(channel)}`),
        fetch(`/api/audit?channel=${encodeURIComponent(channel)}&limit=${TOOL_LOG_LIMIT}`),
        fetch(`/api/console/events/${encodeURIComponent(channel)}?limit=${CONSOLE_LIMIT}`),
      ]);

      const specPayload = await safeJson(specResp, {});
      if (specResp.ok) {
        setSpecState({
          status: specPayload?.status || 'none',
          spec_version: specPayload?.spec_version || null,
        });
      } else {
        setSpecState({ status: 'none', spec_version: null });
      }

      const approvalsPayload = await safeJson(approvalsResp, []);
      setApprovals(Array.isArray(approvalsPayload) ? approvalsPayload : []);

      const procPayload = await safeJson(procResp, {});
      setProcesses(Array.isArray(procPayload?.processes) ? procPayload.processes : []);

      const auditPayload = await safeJson(auditResp, []);
      setToolLogs(Array.isArray(auditPayload) ? auditPayload : []);

      const consolePayload = await safeJson(consoleResp, []);
      setEvents(Array.isArray(consolePayload) ? consolePayload : []);
    } catch (err) {
      setError(err?.message || 'Failed to load status.');
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [busy, channel]);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const stopProcess = async (processId) => {
    if (!processId || busy) return;
    setBusy(true);
    setError('');
    try {
      await fetch('/api/process/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, process_id: processId }),
      });
      await refresh();
    } catch (err) {
      setError(err?.message || 'Failed to stop process.');
    } finally {
      setBusy(false);
    }
  };

  const openPreview = (port) => {
    const safePort = Number(port);
    if (!Number.isFinite(safePort) || safePort <= 0) return;
    window.open(`http://127.0.0.1:${safePort}`, '_blank', 'noopener,noreferrer');
  };

  const toggleToolLog = (id) => {
    setExpandedToolLogs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEvent = (id) => {
    setExpandedEvents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="status-panel">
      <div className="status-header">
        <h3>Status</h3>
        <div className="status-actions">
          <button className="refresh-btn" onClick={() => refresh().catch(() => {})} disabled={busy}>
            {busy ? 'Loading...' : 'Refresh'}
          </button>
          {onClose && (
            <button className="thread-close-btn" onClick={onClose} disabled={busy}>
              Close
            </button>
          )}
        </div>
      </div>

      <div className="status-body">
        {error && <div className="panel-empty audit-error">{error}</div>}
        {loading && <div className="panel-empty">Loading...</div>}

        {!loading && (
          <>
            <div className="status-summary">
              <div><strong>Project:</strong> {activeProject?.project || 'ai-office'} @ {activeProject?.branch || 'main'}</div>
              <div><strong>Spec:</strong> {specStatus}{specState?.spec_version ? ` (${specState.spec_version})` : ''}</div>
              <div><strong>Pending approvals:</strong> {approvals.length}</div>
              <div><strong>Running processes:</strong> {runningProcesses.length}</div>
            </div>

            <div className="status-section">
              <div className="status-section-header">
                <strong>Pending Approvals</strong>
                <span className="status-count">{approvals.length}</span>
              </div>
              {approvals.length === 0 ? (
                <div className="status-empty">None.</div>
              ) : (
                approvals.slice(0, 10).map((item) => (
                  <div key={item.id} className="status-item">
                    <div className="status-item-title">
                      <strong>{item.tool_type}</strong> by <strong>{item.agent_id}</strong>
                      {item.expires_at && (
                        <span className="status-muted">expires {formatShortTime(item.expires_at)}</span>
                      )}
                    </div>
                    <code className="status-code">{item.command}</code>
                  </div>
                ))
              )}
            </div>

            <div className="status-section">
              <div className="status-section-header">
                <strong>Running Processes</strong>
                <span className="status-count">{runningProcesses.length}</span>
              </div>
              {runningProcesses.length === 0 ? (
                <div className="status-empty">None.</div>
              ) : (
                runningProcesses.slice(0, 8).map((proc) => (
                  <div key={proc.id} className="status-item">
                    <div className="status-item-title">
                      <strong>{proc.name}</strong>
                      <span className="status-muted">
                        pid {proc.pid || '-'}{proc.port ? `, :${proc.port}` : ''}
                      </span>
                    </div>
                    <code className="status-code">{proc.command}</code>
                    <div className="status-item-actions">
                      {proc.port && (
                        <button className="refresh-btn" onClick={() => openPreview(proc.port)}>
                          Open
                        </button>
                      )}
                      <button className="refresh-btn warn" onClick={() => stopProcess(proc.id).catch(() => {})} disabled={busy}>
                        Stop
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="status-section">
              <div className="status-section-header">
                <strong>Recent Tool Calls</strong>
                <span className="status-count">{toolLogs.length}</span>
              </div>
              {toolLogs.length === 0 ? (
                <div className="status-empty">No tool calls logged for this channel yet.</div>
              ) : (
                toolLogs.slice(0, TOOL_LOG_LIMIT).map((log) => {
                  const output = String(log.output || '');
                  const expanded = !!expandedToolLogs[log.id];
                  const visible = expanded ? output : output.slice(0, 240);
                  const hasMore = output.length > 240;
                  const ok = Number(log.exit_code || 0) === 0 || log.exit_code === null || typeof log.exit_code === 'undefined';
                  return (
                    <div key={log.id} className={`status-item ${ok ? '' : 'status-item-error'}`}>
                      <div className="status-item-title">
                        <strong>{log.tool_type}</strong> by <strong>{log.agent_id}</strong>
                        <span className="status-muted">{formatShortTime(log.created_at)}</span>
                        {!ok && <span className="status-badge error">exit {log.exit_code}</span>}
                      </div>
                      <code className="status-code">{log.command}</code>
                      {visible && (
                        <pre className="status-output">{visible}</pre>
                      )}
                      {hasMore && (
                        <button className="audit-expand-btn" onClick={() => toggleToolLog(log.id)}>
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="status-section">
              <div className="status-section-header">
                <strong>Recent Console Events</strong>
                <span className="status-count">{events.length}</span>
              </div>
              {events.length === 0 ? (
                <div className="status-empty">No console events for this channel.</div>
              ) : (
                events.slice(0, CONSOLE_LIMIT).map((item) => {
                  const data = item.data && Object.keys(item.data).length ? JSON.stringify(item.data, null, 2) : '';
                  const expanded = !!expandedEvents[item.id];
                  const visible = expanded ? data : data.slice(0, 240);
                  const hasMore = data.length > 240;
                  const severity = item.severity || 'info';
                  return (
                    <div key={item.id} className={`status-item console-entry severity-${severity}`}>
                      <div className="status-item-title">
                        <strong>{item.event_type}</strong> by <strong>{item.source}</strong>
                        <span className="status-muted">{formatShortTime(item.created_at)}</span>
                      </div>
                      {item.message && <div className="status-message">{item.message}</div>}
                      {visible && <pre className="status-output">{visible}</pre>}
                      {hasMore && (
                        <button className="audit-expand-btn" onClick={() => toggleEvent(item.id)}>
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

