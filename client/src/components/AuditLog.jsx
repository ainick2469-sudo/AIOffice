import { useState, useEffect } from 'react';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAuditLogs = () => fetch('/api/audit?limit=30').then(r => r.json());

  const refresh = () => {
    setLoading(true);
    fetchAuditLogs()
      .then((data) => { setLogs(data); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let cancelled = false;
    fetchAuditLogs()
      .then((data) => {
        if (cancelled) return;
        setLogs(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel audit-panel">
      <div className="panel-header">
        <h3>Audit Log</h3>
        <button className="refresh-btn" onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="panel-body">
        {loading && <div className="panel-empty">Loading...</div>}
        {!loading && logs.length === 0 && (
          <div className="panel-empty">No tool calls yet</div>
        )}
        {logs.map(log => (
          <div key={log.id} className={`audit-entry ${log.exit_code === 0 ? 'success' : 'error'}`}>
            <div className="audit-header">
              <span className="audit-agent">{log.agent_id}</span>
              <span className={`audit-type type-${log.tool_type}`}>{log.tool_type}</span>
              <span className="audit-time">
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
            </div>
            <div className="audit-command">{log.command}</div>
            {log.output && (
              <pre className="audit-output">{log.output.slice(0, 300)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
