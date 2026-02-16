import { useEffect, useMemo, useState } from 'react';
import { fetchAgents, fetchChannels, fetchTasks } from '../api';

const REFRESH_MS = 10000;

export default function DashboardHome({ onJumpToChannel, onOpenTasks, onOpenDecisions }) {
  const [loading, setLoading] = useState(true);
  const [activeConversations, setActiveConversations] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [agents, setAgents] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [usageSummary, setUsageSummary] = useState(null);
  const [startupHealth, setStartupHealth] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = async () => {
    try {
      const [channelList, taskList, agentList, decisionsResponse, perfResponse, usageResponse, startupResponse] = await Promise.all([
        fetchChannels(),
        fetchTasks(),
        fetchAgents(),
        fetch('/api/decisions?limit=5').then(r => (r.ok ? r.json() : [])),
        fetch('/api/performance/agents').then(r => (r.ok ? r.json() : [])),
        fetch('/api/usage/summary').then(r => (r.ok ? r.json() : null)),
        fetch('/api/health/startup').then(r => (r.ok ? r.json() : null)),
      ]);

      const conversationChecks = await Promise.all(
        channelList.map(async (ch) => {
          try {
            const res = await fetch(`/api/conversation/${ch.id}`);
            if (!res.ok) return null;
            const status = await res.json();
            if (!status?.active) return null;
            return {
              channelId: ch.id,
              channelName: ch.name,
              messageCount: status.message_count || 0,
            };
          } catch {
            return null;
          }
        })
      );

      const active = conversationChecks
        .filter(Boolean)
        .sort((a, b) => b.messageCount - a.messageCount);

      setActiveConversations(active);
      setTasks(taskList || []);
      setDecisions(Array.isArray(decisionsResponse) ? decisionsResponse : []);
      setAgents(agentList || []);
      setPerformance(Array.isArray(perfResponse) ? perfResponse : []);
      setUsageSummary(usageResponse || null);
      setStartupHealth(startupResponse || null);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const pendingTasks = useMemo(
    () => tasks.filter(t => (t.status || '').toLowerCase() !== 'done'),
    [tasks]
  );

  const taskCounts = useMemo(() => {
    const counts = {
      backlog: 0,
      in_progress: 0,
      review: 0,
    };
    pendingTasks.forEach((task) => {
      const key = (task.status || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counts, key)) {
        counts[key] += 1;
      }
    });
    return counts;
  }, [pendingTasks]);

  const roleGroupedAgents = useMemo(() => {
    const groups = [
      { key: 'technical', label: 'Technical', icon: '⚡', ids: new Set(['builder', 'reviewer', 'qa', 'architect', 'codex', 'ops', 'scribe']) },
      { key: 'creative', label: 'Creative', icon: '🎨', ids: new Set(['spark', 'uiux', 'art', 'lore']) },
      { key: 'management', label: 'Management', icon: '📋', ids: new Set(['producer', 'sage', 'critic']) },
      { key: 'leadership', label: 'Leadership', icon: '⭐', ids: new Set(['director', 'researcher']) },
      { key: 'system', label: 'System', icon: '🤖', ids: new Set(['router']) },
    ];

    const groupMap = Object.fromEntries(groups.map(group => [group.key, { ...group, agents: [] }]));
    const fallback = { key: 'system', label: 'System', icon: '🤖', ids: new Set(), agents: [] };
    for (const agent of agents) {
      const match = groups.find(group => group.ids.has(agent.id));
      if (match) {
        groupMap[match.key].agents.push(agent);
      } else {
        fallback.agents.push(agent);
      }
    }

    const ordered = groups.map(group => groupMap[group.key]);
    if (fallback.agents.length > 0) ordered.push(fallback);
    return ordered;
  }, [agents]);

  const topWorkers = [...performance]
    .sort((a, b) => (b.tasks_done || 0) - (a.tasks_done || 0))
    .slice(0, 5);

  return (
    <div className="panel dashboard-home">
      <div className="panel-header">
        <h3>Office Dashboard</h3>
        <div className="dash-header-actions">
          {startupHealth && (
            <span className={`startup-pill ${startupHealth.overall_healthy ? 'ok' : 'degraded'}`}>
              Startup: {startupHealth.overall_healthy ? 'Healthy' : 'Degraded'}
            </span>
          )}
          <span className="dash-updated">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </span>
          <button className="refresh-btn" onClick={loadDashboard}>
            Refresh
          </button>
        </div>
      </div>

      <div className="panel-body dashboard-grid">
        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Active Conversations</h4>
            <span className="dash-pill">{activeConversations.length}</span>
          </div>
          {loading ? (
            <div className="dash-muted">Loading...</div>
          ) : activeConversations.length === 0 ? (
            <div className="dash-muted">No active conversations right now.</div>
          ) : (
            <div className="dash-list">
              {activeConversations.map((conv) => (
                <button
                  key={conv.channelId}
                  className="dash-list-item"
                  onClick={() => onJumpToChannel?.(conv.channelId)}
                >
                  <span className="dash-item-title">{conv.channelName}</span>
                  <span className="dash-item-meta">{conv.messageCount} msgs</span>
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
              <span className="dash-stat-value">{taskCounts.backlog}</span>
              <span className="dash-stat-label">Backlog</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">{taskCounts.in_progress}</span>
              <span className="dash-stat-label">In Progress</span>
            </div>
            <div className="dash-stat">
              <span className="dash-stat-value">{taskCounts.review}</span>
              <span className="dash-stat-label">Review</span>
            </div>
          </div>
          {pendingTasks.length === 0 ? (
            <div className="dash-muted">No pending tasks.</div>
          ) : (
            <div className="dash-list">
              {pendingTasks.slice(0, 5).map(task => (
                <div key={task.id} className="dash-list-item static">
                  <span className="dash-item-title">{task.title}</span>
                  <span className="dash-item-meta">{task.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Recent Decisions</h4>
            <button className="dash-link" onClick={onOpenDecisions}>
              Open log
            </button>
          </div>
          {decisions.length === 0 ? (
            <div className="dash-muted">No decisions recorded yet.</div>
          ) : (
            <div className="dash-list">
              {decisions.slice(0, 5).map(decision => (
                <div key={decision.id} className="dash-list-item static">
                  <span className="dash-item-title">
                    {decision.title || decision.description || `Decision #${decision.id}`}
                  </span>
                  <span className="dash-item-meta">
                    {decision.decided_by || 'unknown'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Agent Status</h4>
            <span className="dash-pill">{agents.length} online</span>
          </div>
          <div className="dash-list">
            {roleGroupedAgents.map(group => (
              <div key={group.key} className="dash-list-item static">
                <span className="dash-item-title">
                  {group.icon} {group.label} ({group.agents.length})
                </span>
                <span className="dash-item-meta">
                  {group.agents.length
                    ? group.agents.map(agent => agent.display_name).join(', ')
                    : 'none'}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-header">
            <h4>Agent Performance</h4>
            <span className="dash-pill">{performance.length}</span>
          </div>
          {topWorkers.length === 0 ? (
            <div className="dash-muted">No performance data yet.</div>
          ) : (
            <div className="dash-list">
              {topWorkers.map(item => (
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
            <span className="dash-pill">
              ${Number(usageSummary?.total_estimated_cost || 0).toFixed(3)}
            </span>
          </div>
          {usageSummary ? (
            <>
              <div className="dash-stats">
                <div className="dash-stat">
                  <span className="dash-stat-value">{usageSummary.total_tokens || 0}</span>
                  <span className="dash-stat-label">Tokens</span>
                </div>
                <div className="dash-stat">
                  <span className="dash-stat-value">
                    ${Number(usageSummary.budget_usd || 0).toFixed(2)}
                  </span>
                  <span className="dash-stat-label">Budget</span>
                </div>
              </div>
              <div className={`dash-muted ${usageSummary.budget_exceeded ? 'cost-danger' : usageSummary.budget_warning ? 'cost-warn' : ''}`}>
                {usageSummary.budget_exceeded
                  ? `Budget exceeded. Remaining $${Number(usageSummary.remaining_usd || 0).toFixed(2)}`
                  : usageSummary.budget_warning
                    ? `Budget warning. Remaining $${Number(usageSummary.remaining_usd || 0).toFixed(2)}`
                    : `Remaining budget $${Number(usageSummary.remaining_usd || 0).toFixed(2)}`}
              </div>
            </>
          ) : (
            <div className="dash-muted">No usage data yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}
