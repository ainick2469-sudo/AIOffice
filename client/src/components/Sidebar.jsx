import { useState, useEffect } from 'react';
import { fetchAgents, fetchChannels } from '../api';

export default function Sidebar({ currentChannel, onSelectChannel, onAgentClick }) {
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const loadChannels = () => {
    fetchChannels().then(setChannels).catch(console.error);
  };

  useEffect(() => {
    loadChannels();
    fetchAgents().then(setAgents).catch(console.error);
    const interval = setInterval(loadChannels, 10000);
    return () => clearInterval(interval);
  }, []);

  const agentMap = {};
  agents.forEach(a => { agentMap[a.id] = a; });

  const createRoom = () => {
    if (!newName.trim()) return;
    fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    }).then(r => r.json()).then(ch => {
      setNewName('');
      setShowCreate(false);
      loadChannels();
      if (ch.id) onSelectChannel(ch.id);
    });
  };

  const deleteRoom = (chId, deleteMessages) => {
    fetch(`/api/channels/${chId}?delete_messages=${deleteMessages}`, {
      method: 'DELETE',
    }).then(() => {
      setDeleteConfirm(null);
      loadChannels();
      if (currentChannel === chId) onSelectChannel('main');
    });
  };

  const groupChannels = channels.filter(c => c.type === 'group');
  const dmChannels = channels.filter(c => c.type === 'dm');

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>🏢 AI Office</h2>
        <span className="version">v0.3</span>
      </div>

      <div className="channel-section">
        <div className="section-header">
          <h3>Channels</h3>
          <button className="add-room-btn" onClick={() => setShowCreate(!showCreate)} title="New room">+</button>
        </div>

        {showCreate && (
          <div className="create-room">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Room name..." autoFocus
              onKeyDown={e => e.key === 'Enter' && createRoom()} />
            <button onClick={createRoom}>Create</button>
          </div>
        )}

        {groupChannels.map(ch => (
          <div key={ch.id} className={`channel-row ${currentChannel === ch.id ? 'active' : ''}`}>
            <button className="channel-btn" onClick={() => onSelectChannel(ch.id)} title={ch.name}>
              # {ch.name}
            </button>
            {ch.id !== 'main' && (
              <button className="delete-room-btn"
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(ch.id); }}
                title="Delete room">×</button>
            )}
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-box" onClick={e => e.stopPropagation()}>
            <p>Delete <strong>#{channels.find(c => c.id === deleteConfirm)?.name}</strong>?</p>
            <button className="del-btn del-all" onClick={() => deleteRoom(deleteConfirm, true)}>
              Delete room + all messages
            </button>
            <button className="del-btn del-keep" onClick={() => deleteRoom(deleteConfirm, false)}>
              Delete room, keep messages
            </button>
            <button className="del-btn del-cancel" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="channel-section">
        <h3>Direct Messages</h3>
        {dmChannels.map(ch => {
          const agent = agentMap[ch.agent_id];
          return (
            <button key={ch.id}
              className={`channel-btn dm-btn ${currentChannel === ch.id ? 'active' : ''}`}
              onClick={() => onSelectChannel(ch.id)}>
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
            style={{ cursor: 'pointer' }} title={`${a.display_name}'s profile`}>
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
