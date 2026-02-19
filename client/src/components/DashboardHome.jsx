import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useVisibilityInterval from '../hooks/useVisibilityInterval';
import { createStartupRequestMeter } from '../lib/perf/requestMeter';

const AUTO_REFRESH_MS = 90_000;

const EMPTY_DASHBOARD = {
  channels_count: 0,
  agents_count: 0,
  tasks_open_count: 0,
  decisions_count: 0,
  task_status_counts: {
    backlog: 0,
    in_progress: 0,
    review: 0,
    blocked: 0,
  },
  provider_status_summary: {},
  recent_activity: [],
};

export default function DashboardHome({ onJumpToChannel, onOpenTasks, onOpenDecisions }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [details, setDetails] = useState({
    decisions: null,
    performance: null,
    usage: null,
    startup: null,
  });
  const [detailsOpen, setDetailsOpen] = useState({
    decisions: false,
    performance: false,
    usage: false,
    startup: false,
  });

  const refreshAbortRef = useRef(null);
  const detailsAbortRef = useRef({
    decisions: null,
    performance: null,
    usage: null,
    startup: null,
  });
  const isRefreshingRef = useRef(false);
  const detailsRefreshingRef = useRef({
    decisions: false,
    performance: false,
    usage: false,
    startup: false,
  });
  const requestMeterRef = useRef(null);
  if (!requestMeterRef.current) {
    requestMeterRef.current = createStartupRequestMeter('home-dashboard');
  }

  const trackRequest = useCallback((endpoint) => {
    requestMeterRef.current?.track(endpoint);
  }, []);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    try {
      trackRequest('/api/dashboard/summary');
      const resp = await fetch('/api/dashboard/summary', { signal: controller.signal });
      if (!resp.ok) throw new Error(`Dashboard summary failed (${resp.status})`);
      const payload = await resp.json();
      setDashboard({
        ...EMPTY_DASHBOARD,
        ...payload,
        task_status_counts: {
          ...EMPTY_DASHBOARD.task_status_counts,
          ...(payload?.task_status_counts || {}),
        },
        recent_activity: Array.isArray(payload?.recent_activity) ? payload.recent_activity : [],
      });
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Failed to load dashboard summary.');
      }
    } finally {
      if (!silent) setLoading(false);
      if (refreshAbortRef.current === controller) {
        refreshAbortRef.current = null;
      }
      isRefreshingRef.current = false;
    }
  }, [trackRequest]);

  const loadDetails = useCallback(async (kind) => {
    if (!['decisions', 'performance', 'usage', 'startup'].includes(kind)) return;
    if (detailsRefreshingRef.current[kind]) return;
    detailsRefreshingRef.current[kind] = true;
    detailsAbortRef.current[kind]?.abort?.();
    const controller = new AbortController();
    detailsAbortRef.current[kind] = controller;

    const endpointMap = {
      decisions: '/api/decisions?limit=5',
      performance: '/api/performance/agents',
      usage: '/api/usage/summary',
      startup: '/api/health/startup',
    };
    const endpoint = endpointMap[kind];
    try {
      trackRequest(endpoint);
      const resp = await fetch(endpoint, { signal: controller.signal });
      const payload = resp.ok ? await resp.json() : null;
      setDetails((prev) => ({ ...prev, [kind]: payload }));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error(`Failed to load dashboard detail: ${kind}`, err);
      }
    } finally {
      if (detailsAbortRef.current[kind] === controller) {
        detailsAbortRef.current[kind] = null;
      }
      detailsRefreshingRef.current[kind] = false;
    }
  }, [trackRequest]);

  const toggleDetails = useCallback((kind) => {
    setDetailsOpen((prev) => {
      const next = { ...prev, [kind]: !prev[kind] };
      if (next[kind] && details[kind] == null) {
        loadDetails(kind);
      }
      return next;
    });
  }, [details, loadDetails]);

  useVisibilityInterval(() => {
    loadDashboard({ silent: true });
  }, AUTO_REFRESH_MS, { enabled: true });

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
      Object.values(detailsAbortRef.current).forEach((controller) => controller?.abort?.());
      requestMeterRef.current?.stop('dashboard-unmount');
    };
  }, []);

  const topWorkers = useMemo(() => {
    const list = Array.isArray(details.performance) ? details.performance : [];
    return [...list]
      .sort((a, b) => (b.tasks_done || 0) - (a.tasks_done || 0))
      .slice(0, 5);
  }, [details.performance]);

  const taskCounts = dashboard.task_status_counts || EMPTY_DASHBOARD.task_status_counts;
  const activeConversations = Array.isArray(dashboard.recent_activity) ? dashboard.recent_activity : [];
  const startupHealthy = details.startup?.overall_healthy;

  return (
    <div className="panel dashboard-home">
      <div className="panel-header">
        <h3>Office Dashboard</h3>
        <div className="dash-header-actions">
          {details.startup && (
            <span className={`startup-pill ${startupHealthy ? 'ok' : 'degraded'}`}>
              Startup: {startupHealthy ? 'Healthy' : 'Degraded'}
            </span>
          )}
          <span className="dash-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </span>
          <button className="refresh-btn" onClick={() => loadDashboard()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <div className="agent-config-error">{error}</div> : null}

      <div className="panel-body dashboard-grid">
        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Recent Activity</h4>
            <span className="dash-pill">{activeConversations.length}</span>
          </div>
          {loading ? (
            <div className="dash-muted">Loading summary...</div>
          ) : activeConversations.length === 0 ? (
            <div className="dash-muted">No recent channel activity.</div>
          ) : (
            <div className="dash-list">
              {activeConversations.map((activity) => (
                <button
                  key={`${activity.channel_id}-${activity.latest_message_id}`}
                  className="dash-list-item"
                  onClick={() => onJumpToChannel?.(activity.channel_id)}
                >
                  <span className="dash-item-title">{activity.channel_name || activity.channel_id}</span>
                  <span className="dash-item-meta">
                    {activity.latest_sender || 'system'} · {activity.latest_preview || 'New message'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Pending Tasks</h4>
            <button className="dash-link" onClick={onOpenTasks}>
              Open board
            </button>
          </div>
          <div className="dash-stats">
            <div className="dash-stat">
              <span className="dash-stat-value">{taskCounts.backlog || 0}</span>
              <span className="dash-stat-label">Backlog</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">{taskCounts.in_progress || 0}</span>
              <span className="dash-stat-label">In Progress</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">{taskCounts.review || 0}</span>
              <span className="dash-stat-label">Review</span>
            </div>
          </div>
          <div className="dash-muted">
            Open tasks: {dashboard.tasks_open_count || 0}
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Decisions</h4>
            <button className="dash-link" onClick={() => toggleDetails('decisions')}>
              {detailsOpen.decisions ? 'Hide details' : 'Load details'}
            </button>
          </div>
          <div className="dash-muted">Recorded decisions: {dashboard.decisions_count || 0}</div>
          {detailsOpen.decisions && (
            <div className="dash-list">
              {(Array.isArray(details.decisions) ? details.decisions : []).slice(0, 5).map((decision) => (
                <div key={decision.id} className="dash-list-item static">
                  <span className="dash-item-title">
                    {decision.title || decision.description || `Decision #${decision.id}`}
                  </span>
                  <span className="dash-item-meta">{decision.decided_by || 'unknown'}</span>
                </div>
              ))}
              <button className="dash-link" onClick={onOpenDecisions}>
                Open decisions log
              </button>
            </div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Agents</h4>
            <span className="dash-pill">{dashboard.agents_count || 0}</span>
          </div>
          <div className="dash-muted">Active agents in this workspace: {dashboard.agents_count || 0}</div>
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Agent Performance</h4>
            <button className="dash-link" onClick={() => toggleDetails('performance')}>
              {detailsOpen.performance ? 'Hide details' : 'Load details'}
            </button>
          </div>
          {!detailsOpen.performance ? (
            <div className="dash-muted">Load details on demand to keep Home lightweight.</div>
          ) : topWorkers.length === 0 ? (
            <div className="dash-muted">No performance data yet.</div>
          ) : (
            <div className="dash-list">
              {topWorkers.map((item) => (
                <div key={item.agent_id} className="dash-list-item static">
                  <span className="dash-item-title">
                    {item.emoji} {item.display_name}
                  </span>
                  <span className="dash-item-meta">
                    done {item.tasks_done || 0} | tools {item.tool_calls || 0}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>API Cost</h4>
            <button className="dash-link" onClick={() => toggleDetails('usage')}>
              {detailsOpen.usage ? 'Hide details' : 'Load details'}
            </button>
          </div>
          {!detailsOpen.usage ? (
            <div className="dash-muted">Load details on demand to avoid startup request storms.</div>
          ) : details.usage ? (
            <>
              <div className="dash-stats">
                <div className="dash-stat">
                  <span className="dash-stat-value">{details.usage.total_tokens || 0}</span>
                  <span className="dash-stat-label">Tokens</span>
                </div>
                <div className="dash-stat">
                  <span className="dash-stat-value">
                    ${Number(details.usage.total_estimated_cost || 0).toFixed(3)}
                  </span>
                  <span className="dash-stat-label">Cost</span>
                </div>
              </div>
              <div className="dash-muted">
                Remaining budget ${Number(details.usage.remaining_usd || 0).toFixed(2)}
              </div>
            </>
          ) : (
            <div className="dash-muted">No usage data yet.</div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Startup Health</h4>
            <button className="dash-link" onClick={() => toggleDetails('startup')}>
              {detailsOpen.startup ? 'Hide details' : 'Load details'}
            </button>
          </div>
          {!detailsOpen.startup ? (
            <div className="dash-muted">Load details on demand.</div>
          ) : details.startup ? (
            <div className="dash-muted">
              {details.startup.overall_healthy ? 'Healthy startup checks.' : 'Startup checks reported issues.'}
            </div>
          ) : (
            <div className="dash-muted">No startup health data yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}
