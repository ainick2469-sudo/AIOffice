import { useState, useEffect } from 'react';

export default function AgentProfile({ agentId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    fetch(`/api/agents/${agentId}/profile`)
      .then(r => r.json())
      .then(data => { setProfile(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [agentId]);

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
            <span className="ap-stat-num">{profile.memories?.length || 0}</span>
            <span className="ap-stat-label">Memories</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-num">{profile.backend}</span>
            <span className="ap-stat-label">Backend</span>
          </div>
        </div>

        <div className="ap-section">
          <h4>Model</h4>
          <code className="inline-code">{profile.model}</code>
        </div>

        {profile.memories && profile.memories.length > 0 && (
          <div className="ap-section">
            <h4>Memories ({profile.memories.length})</h4>
            <div className="ap-memory-list">
              {profile.memories.slice(0, 10).map((m, i) => (
                <div key={i} className="ap-memory">
                  <span className="ap-memory-type">{m.type || 'fact'}</span>
                  <span>{m.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
