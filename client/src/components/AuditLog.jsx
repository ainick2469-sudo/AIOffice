import { useCallback, useEffect, useMemo, useState } from 'react';

const LIMIT = 300;

const TOOL_OPTIONS = [
  { value: '', label: 'All tools' },
  { value: 'read', label: 'Read' },
  { value: 'search', label: 'Search' },
  { value: 'write', label: 'Write' },
  { value: 'run', label: 'Run' },
  { value: 'task', label: 'Task' },
];

const RISK_OPTIONS = [
  { value: '', label: 'All risk levels' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const clearTargets = {
  logs: {
    endpoint: '/api/audit/logs',
    confirmText: 'Clear all audit tool logs? This cannot be undone.',
  },
  decisions: {
    endpoint: '/api/audit/decisions',
    confirmText: 'Clear all decisions from the audit trail? This cannot be undone.',
  },
  all: {
    endpoint: '/api/audit/all',
    confirmText: 'Clear ALL audit logs and decisions? This cannot be undone.',
  },
};

const toLocalInputValue = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function AuditLog({ onAuditChanged }) {
  const [logs, setLogs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    agentId: '',
    toolType: '',
    channel: '',
    taskId: '',
    riskLevel: '',
    query: '',
    dateFrom: '',
    dateTo: '',
  });
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [expandedOutputs, setExpandedOutputs] = useState({});

  const fetchAuditLogs = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(LIMIT) });
    if (filters.agentId) params.set('agent_id', filters.agentId);
    if (filters.toolType) params.set('tool_type', filters.toolType);
    if (filters.channel.trim()) params.set('channel', filters.channel.trim());
    if (filters.taskId.trim()) params.set('task_id', filters.taskId.trim());
    if (filters.riskLevel) params.set('risk_level', filters.riskLevel);
    if (filters.query.trim()) params.set('q', filters.query.trim());
    if (filters.dateFrom) params.set('date_from', filters.dateFrom);
    if (filters.dateTo) params.set('date_to', filters.dateTo);

    const response = await fetch(`/api/audit?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to load audit log (${response.status})`);
    }
    return response.json();
  }, [filters.agentId, filters.toolType, filters.channel, filters.taskId, filters.riskLevel, filters.query, filters.dateFrom, filters.dateTo]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAuditLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || 'Failed to load audit log.');
      setLogs([]);
    } finally {
      setLoading(false);
      onAuditChanged?.();
    }
  }, [fetchAuditLogs, onAuditChanged]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (cancelled) return;
        setAgents(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const groupedLogs = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const log of logs) {
      const date = new Date(log.created_at);
      const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
      const key = `${safeDate.toLocaleDateString()} ${safeDate.getHours().toString().padStart(2, '0')}:00`;
      if (!map.has(key)) {
        const group = { key, label: key, items: [] };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key).items.push(log);
    }
    return groups;
  }, [logs]);

  const getSeverityClass = (log) => {
    if (Number(log.exit_code) !== 0) return 'severity-error';
    if (log.tool_type === 'read' || log.tool_type === 'search') return 'severity-read';
    if (log.tool_type === 'write' || log.tool_type === 'task') return 'severity-write';
    if (log.tool_type === 'run') return 'severity-run';
    return 'severity-neutral';
  };

  const toggleGroup = (groupKey) => {
    setCollapsedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const toggleOutput = (logId) => {
    setExpandedOutputs(prev => ({ ...prev, [logId]: !prev[logId] }));
  };

  const clearAudit = async (target) => {
    const config = clearTargets[target];
    if (!config) return;
    const confirmed = window.confirm(config.confirmText);
    if (!confirmed) return;

    setClearing(true);
    setError('');
    try {
      const response = await fetch(config.endpoint, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Clear failed (${response.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err?.message || 'Failed to clear audit data.');
    } finally {
      setClearing(false);
    }
  };

  const exportAudit = async () => {
    const params = new URLSearchParams();
    if (filters.channel.trim()) params.set('channel', filters.channel.trim());
    if (filters.taskId.trim()) params.set('task_id', filters.taskId.trim());
    if (filters.toolType) params.set('tool_type', filters.toolType);
    if (filters.riskLevel) params.set('risk_level', filters.riskLevel);
    const response = await fetch(`/api/audit/export?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Export failed (${response.status})`);
    }
    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel audit-panel">
      <div className="panel-header">
        <h3>Audit Log</h3>
        <div className="audit-header-actions">
          <button className="refresh-btn" onClick={refresh} disabled={loading || clearing}>
            Refresh
          </button>
          <button className="refresh-btn" onClick={() => exportAudit().catch((err) => setError(err?.message || 'Export failed.'))} disabled={loading || clearing}>
            Export
          </button>
          <button className="refresh-btn warn" onClick={() => clearAudit('logs')} disabled={loading || clearing}>
            Clear Logs
          </button>
          <button className="refresh-btn warn" onClick={() => clearAudit('decisions')} disabled={loading || clearing}>
            Clear Decisions
          </button>
          <button className="refresh-btn danger" onClick={() => clearAudit('all')} disabled={loading || clearing}>
            Clear All
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div className="audit-filter-bar">
          <input
            type="text"
            placeholder="Search command/output..."
            value={filters.query}
            onChange={(event) => setFilters(prev => ({ ...prev, query: event.target.value }))}
          />
          <select
            value={filters.agentId}
            onChange={(event) => setFilters(prev => ({ ...prev, agentId: event.target.value }))}
          >
            <option value="">All agents</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.display_name}
              </option>
            ))}
          </select>
          <select
            value={filters.toolType}
            onChange={(event) => setFilters(prev => ({ ...prev, toolType: event.target.value }))}
          >
            {TOOL_OPTIONS.map((item) => (
              <option key={item.value || 'all-tools'} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Channel (e.g. main)"
            value={filters.channel}
            onChange={(event) => setFilters(prev => ({ ...prev, channel: event.target.value }))}
          />
          <input
            type="text"
            placeholder="Task ID"
            value={filters.taskId}
            onChange={(event) => setFilters(prev => ({ ...prev, taskId: event.target.value }))}
          />
          <select
            value={filters.riskLevel}
            onChange={(event) => setFilters(prev => ({ ...prev, riskLevel: event.target.value }))}
          >
            {RISK_OPTIONS.map((item) => (
              <option key={item.value || 'all-risk'} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={toLocalInputValue(filters.dateFrom)}
            onChange={(event) => setFilters(prev => ({ ...prev, dateFrom: event.target.value }))}
          />
          <input
            type="datetime-local"
            value={toLocalInputValue(filters.dateTo)}
            onChange={(event) => setFilters(prev => ({ ...prev, dateTo: event.target.value }))}
          />
        </div>

        {error && <div className="panel-empty audit-error">{error}</div>}
        {loading && <div className="panel-empty">Loading...</div>}
        {!loading && logs.length === 0 && (
          <div className="panel-empty">No audit entries match current filters.</div>
        )}

        {!loading && groupedLogs.map((group) => (
          <div key={group.key} className="audit-group">
            <button className="audit-group-header" onClick={() => toggleGroup(group.key)}>
              <span>{collapsedGroups[group.key] ? '▶' : '▼'} {group.label}</span>
              <span>{group.items.length}</span>
            </button>
            {!collapsedGroups[group.key] && group.items.map((log) => {
              const output = log.output || '';
              const expanded = !!expandedOutputs[log.id];
              const visibleOutput = expanded ? output : output.slice(0, 320);
              const hasMore = output.length > 320;
              return (
                <div key={log.id} className={`audit-entry ${getSeverityClass(log)}`}>
                  <div className="audit-header">
                    <span className="audit-agent">{log.agent_id}</span>
                    <span className={`audit-type type-${log.tool_type}`}>{log.tool_type}</span>
                    <span className="audit-time">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                  <div className="audit-command">{log.command}</div>
                  {log.args && (
                    <div className="audit-args">{log.args}</div>
                  )}
                  {output && (
                    <div className="audit-output-wrap">
                      <pre className="audit-output">{visibleOutput}</pre>
                      {hasMore && (
                        <button className="audit-expand-btn" onClick={() => toggleOutput(log.id)}>
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
