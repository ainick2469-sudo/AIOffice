import { useState, useEffect } from 'react';
import { fetchAgents, fetchChannels } from '../api';

export default function Sidebar({ currentChannel, onSelectChannel, onAgentClick }) {
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);

  const loadChannels = () => {
    fetchChannels().then(setChannels).catch(console.error);
  };

  useEffect(() => {
    loadChannels();
    fetchAgents().then(setAgents).catch(console.error);
    // Poll channels every 10s to pick up auto-renames
    const interval = setInterval(loadChannels, 10000);
    return () => clearInterval(interval);
  }, []);

  const agentMap = {};
  agents.forEach(a => { agentMap[a.id] = a; });

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>🏢 AI Office</h2>
        <span className="version">v0.3</span>
      </div>

      <div className="channel-section">
        <h3>Channels</h3>
        {channels.filter(c => c.type === 'group').map(ch => (
          <button
            key={ch.id}
            className={`channel-btn ${currentChannel === ch.id ? 'active' : ''}`}
            onClick={() => onSelectChannel(ch.id)}
            title={ch.name}
          >
            # {ch.name}
          </button>
        ))}
      </div>

      <div className="channel-section">
        <h3>Direct Messages</h3>
        {channels.filter(c => c.type === 'dm').map(ch => {
          const agent = agentMap[ch.agent_id];
          return (
            <button
              key={ch.id}
              className={`channel-btn dm-btn ${currentChannel === ch.id ? 'active' : ''}`}
              onClick={() => onSelectChannel(ch.id)}
            >
              <span className="agent-dot" style={{ backgroundColor: agent?.color || '#6B7280' }} />
              {agent?.emoji || '🤖'} {ch.name.replace('DM: ', '')}
            </button>
          );
        })}
      </div>

      <div className="channel-section staff-section">
        <h3>Staff ({agents.length})</h3>
        {agents.map(a => (
          <div key={a.id} className="staff-item" onClick={() => onAgentClick?.(a.id)}
            style={{ cursor: 'pointer' }} title={`Click for ${a.display_name}'s profile`}>
            <span className="agent-dot" style={{ backgroundColor: a.color }} />
            <span className="staff-emoji">{a.emoji}</span>
            <span className="staff-name">{a.display_name}</span>
            <span className="staff-role">{a.role}</span>
            {a.backend === 'claude' && <span className="staff-badge">✨</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
