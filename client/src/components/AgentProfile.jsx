import { useState, useEffect } from 'react';

export default function AgentProfile({ agentId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [memories, setMemories] = useState([]);
  const [memFilter, setMemFilter] = useState(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    Promise.all([
      fetch(`/api/agents/${agentId}/profile`).then(r => r.json()),
      fetch(`/api/agents/${agentId}/memories?limit=100`).then(r => r.json()),
    ]).then(([prof, mems]) => {
      if (cancelled) return;
      setProfile(prof);
      setMemories(Array.isArray(mems) ? mems : []);
      setMemFilter(null);
    }).catch(() => {
      if (cancelled) return;
      setProfile({ error: 'Load failed' });
      setMemories([]);
    });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const loadMemories = (type) => {
    setMemFilter(type);
    const url = type
      ? `/api/agents/${agentId}/memories?limit=100&type=${type}`
      : `/api/agents/${agentId}/memories?limit=100`;
    fetch(url).then(r => r.json()).then(m => setMemories(Array.isArray(m) ? m : []));
  };

  const cleanupMemories = () => {
    fetch(`/api/agents/${agentId}/memory/cleanup`, { method: 'POST' })
      .then(r => r.json())
      .then(() => loadMemories(memFilter));
  };

  const typeColors = {
    decision: '#F59E0B', preference: '#8B5CF6', constraint: '#EF4444',
    fact: '#3B82F6', todo: '#10B981', lore: '#EC4899',
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleDateString(); }
    catch { return ''; }
  };

  const loading = profile === null;
  const perf = profile?.performance || {};

  if (!agentId) return null;
  if (loading) return <div className="agent-profile-modal"><div className="ap-loading">Loading...</div></div>;
  if (!profile || profile.error) return <div className="agent-profile-modal"><div className="ap-loading">Agent not found</div></div>;

  return (
    <div className="agent-profile-modal" onClick={onClose}>
      <div className="agent-profile-card" onClick={e => e.stopPropagation()}>
        <button className="ap-close" onClick={onClose}>✕</button>
        <div className="ap-header">
          <span className="ap-emoji">{profile.emoji}</span>
          <div>
            <h2 style={{ color: profile.color }}>{profile.display_name}</h2>
            <span className="ap-role">{profile.role}</span>
          </div>
        </div>

        <div className="ap-stats">
          <div className="ap-stat">
            <span className="ap-stat-num">{profile.message_count}</span>
            <span className="ap-stat-label">Messages</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{memories.length}</span>
            <span className="ap-stat-label">Memories</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{profile.backend}</span>
            <span className="ap-stat-label">Backend</span>
          </div>
        </div>

        <div className="ap-stats">
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.tool_calls || 0}</span>
            <span className="ap-stat-label">Tool Calls</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.tasks_done || 0}</span>
            <span className="ap-stat-label">Tasks Done</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.tasks_blocked || 0}</span>
            <span className="ap-stat-label">Blocked</span>
          </div>
        </div>

        <div className="ap-stats">
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.build_pass || 0}</span>
            <span className="ap-stat-label">Build Pass</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.build_fail || 0}</span>
            <span className="ap-stat-label">Build Fail</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{perf.tests_pass || 0}/{perf.tests_fail || 0}</span>
            <span className="ap-stat-label">Tests P/F</span>
          </div>
        </div>

        <div className="ap-section">
          <h4>Model</h4>
          <code className="inline-code">{profile.model}</code>
        </div>

        <div className="ap-section ap-memories-section">
          <div className="ap-mem-header">
            <h4>Memories ({memories.length})</h4>
            <button className="ap-cleanup-btn" onClick={cleanupMemories} title="Remove duplicates">🧹 Clean</button>
          </div>
          <div className="ap-mem-filters">
            <button className={!memFilter ? 'active' : ''} onClick={() => loadMemories(null)}>All</button>
            {['decision','fact','todo','preference','constraint','lore'].map(t => (
              <button key={t} className={memFilter === t ? 'active' : ''} onClick={() => loadMemories(t)}
                style={memFilter === t ? { background: typeColors[t] + '33', borderColor: typeColors[t] } : {}}>
                {t}
              </button>
            ))}
          </div>
          <div className="ap-memory-scroll">
            {memories.length === 0 && (
              <div className="ap-mem-empty">No memories yet. Start chatting to build memory.</div>
            )}
            {memories.map((m, i) => (
              <div key={i} className="ap-memory">
                <span className="ap-memory-type" style={{ background: (typeColors[m.type] || '#6B7280') + '25',
                  color: typeColors[m.type] || '#6B7280' }}>{m.type || 'fact'}</span>
                <span className="ap-memory-content">{m.content}</span>
                {m.timestamp && <span className="ap-memory-time">{formatTime(m.timestamp)}</span>}
              </div>
            ))}
          </div>
        </div>

        {profile.recent_messages && profile.recent_messages.length > 0 && (
          <div className="ap-section">
            <h4>Recent Messages</h4>
            <div className="ap-recent-list">
              {profile.recent_messages.slice(0, 5).map(msg => (
                <div key={msg.id} className="ap-recent-msg">
                  <span className="ap-recent-channel">#{msg.channel}</span>
                  <span className="ap-recent-text">{msg.content.slice(0, 120)}{msg.content.length > 120 ? '...' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
