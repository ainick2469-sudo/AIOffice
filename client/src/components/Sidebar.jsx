import { useState, useEffect, useRef } from 'react';
import { fetchAgents, fetchChannels, fetchMessages } from '../api';

const CHANNEL_REFRESH_MS = 10000;
const AGENT_REFRESH_MS = 15000;
const UNREAD_REFRESH_MS = 5000;
const UNREAD_SAMPLE_LIMIT = 100;

export default function Sidebar({ currentChannel, onSelectChannel, onAgentClick, theme = 'dark', onToggleTheme }) {
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [backendStatus, setBackendStatus] = useState({
    ollama: false,
    claude: false,
    openai: false,
  });

  const seenMessageIdsRef = useRef({});
  const unreadInitRef = useRef(false);
  const previousUnreadRef = useRef({});
  const audioContextRef = useRef(null);

  const playNotificationDing = () => {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      gain.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.2);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch (err) {
      console.error('Failed to play notification sound:', err);
    }
  };

  const loadChannels = () => {
    fetchChannels().then(setChannels).catch(console.error);
  };

  const loadAgents = () => {
    fetchAgents().then(setAgents).catch(console.error);
  };

  const loadBackendStatus = () => {
    Promise.all([
      fetch('/api/ollama/status').then(r => (r.ok ? r.json() : { available: false })),
      fetch('/api/claude/status').then(r => (r.ok ? r.json() : { available: false })),
      fetch('/api/openai/status').then(r => (r.ok ? r.json() : { available: false })),
    ])
      .then(([ollama, claude, openai]) => {
        setBackendStatus({
          ollama: Boolean(ollama?.available),
          claude: Boolean(claude?.available),
          openai: Boolean(openai?.available),
        });
      })
      .catch(() => {
        setBackendStatus({ ollama: false, claude: false, openai: false });
      });
  };

  useEffect(() => {
    loadChannels();
    loadAgents();
    loadBackendStatus();
    const interval = setInterval(loadChannels, CHANNEL_REFRESH_MS);
    const agentInterval = setInterval(loadAgents, AGENT_REFRESH_MS);
    const statusInterval = setInterval(loadBackendStatus, 15000);
    return () => {
      clearInterval(interval);
      clearInterval(agentInterval);
      clearInterval(statusInterval);
    };
  }, []);

  useEffect(() => {
    if (!currentChannel) return;

    let cancelled = false;
    fetchMessages(currentChannel, 1)
      .then(messages => {
        if (cancelled) return;
        const latestId = messages.length ? messages[messages.length - 1].id : 0;
        seenMessageIdsRef.current[currentChannel] = latestId;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentChannel]);

  useEffect(() => {
    const handleAgentsUpdated = () => {
      loadAgents();
      loadBackendStatus();
    };
    window.addEventListener('agents-updated', handleAgentsUpdated);
    return () => {
      window.removeEventListener('agents-updated', handleAgentsUpdated);
    };
  }, []);

  useEffect(() => {
    if (channels.length === 0) return;

    const validIds = new Set(channels.map(ch => ch.id));
    Object.keys(seenMessageIdsRef.current).forEach(id => {
      if (!validIds.has(id)) delete seenMessageIdsRef.current[id];
    });

    let cancelled = false;

    const syncUnread = async (bootstrap = false) => {
      try {
        const snapshots = await Promise.all(
          channels.map(async (ch) => {
            try {
              const messages = await fetchMessages(ch.id, UNREAD_SAMPLE_LIMIT);
              const latestId = messages.length ? messages[messages.length - 1].id : 0;
              return { channelId: ch.id, latestId, messages };
            } catch (err) {
              console.error(`Failed to fetch messages for channel ${ch.id}:`, err);
              const fallbackSeen = seenMessageIdsRef.current[ch.id] || 0;
              return { channelId: ch.id, latestId: fallbackSeen, messages: [] };
            }
          })
        );

        if (cancelled) return;

        setUnreadCounts(() => {
          const next = {};

          snapshots.forEach(({ channelId, latestId, messages }) => {
            if (bootstrap && seenMessageIdsRef.current[channelId] == null) {
              seenMessageIdsRef.current[channelId] = latestId;
            }

            if (channelId === currentChannel) {
              seenMessageIdsRef.current[channelId] = latestId;
              next[channelId] = 0;
              return;
            }

            const seenId = seenMessageIdsRef.current[channelId];
            if (seenId == null) {
              seenMessageIdsRef.current[channelId] = latestId;
              next[channelId] = 0;
              return;
            }

            let unread = 0;
            for (const msg of messages) {
              if (msg.id > seenId) unread += 1;
            }
            next[channelId] = unread;
          });

          return next;
        });
      } catch (err) {
        console.error('Failed to sync unread counts:', err);
      }
    };

    const bootstrap = !unreadInitRef.current;
    syncUnread(bootstrap).finally(() => {
      unreadInitRef.current = true;
    });

    const interval = setInterval(() => {
      syncUnread(false);
    }, UNREAD_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channels, currentChannel]);

  useEffect(() => {
    let shouldPlay = false;
    for (const [channelId, count] of Object.entries(unreadCounts)) {
      const previousCount = previousUnreadRef.current[channelId] || 0;
      if (channelId !== currentChannel && count > previousCount) {
        shouldPlay = true;
        break;
      }
    }

    previousUnreadRef.current = { ...unreadCounts };
    if (shouldPlay) playNotificationDing();
  }, [unreadCounts, currentChannel]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const agentMap = {};
  agents.forEach(a => {
    agentMap[a.id] = a;
  });

  const createRoom = () => {
    if (!newName.trim()) return;
    fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
      .then(r => r.json())
      .then(ch => {
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

  const handleSelectChannel = (channelId) => {
    setUnreadCounts(prev => {
      if (!prev[channelId]) return prev;
      return { ...prev, [channelId]: 0 };
    });
    onSelectChannel(channelId);

    fetchMessages(channelId, 1)
      .then((messages) => {
        const latestId = messages.length ? messages[messages.length - 1].id : 0;
        seenMessageIdsRef.current[channelId] = latestId;
      })
      .catch(() => {});
  };

  const renderUnreadBadge = (channelId) => {
    const count = unreadCounts[channelId] || 0;
    if (count <= 0) return null;
    return <span className="unread-badge">{count > 99 ? '99+' : count}</span>;
  };

  const isAgentOnline = (agent) => {
    if (!agent?.active) return false;
    if (agent.backend === 'claude') return backendStatus.claude;
    if (agent.backend === 'openai') return backendStatus.openai;
    return backendStatus.ollama;
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>AI Office</h2>
        <span className="version">v0.3</span>
        <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      <div className="channel-section">
        <div className="section-header">
          <h3>Channels</h3>
          <button className="add-room-btn" onClick={() => setShowCreate(!showCreate)} title="New room">
            +
          </button>
        </div>

        {showCreate && (
          <div className="create-room">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Room name..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && createRoom()}
            />
            <button onClick={createRoom}>Create</button>
          </div>
        )}

        {groupChannels.map(ch => (
          <div key={ch.id} className={`channel-row ${currentChannel === ch.id ? 'active' : ''}`}>
            <button className="channel-btn" onClick={() => handleSelectChannel(ch.id)} title={ch.name}>
              <span className="channel-label"># {ch.name}</span>
              {renderUnreadBadge(ch.id)}
            </button>
            {ch.id !== 'main' && (
              <button
                className="delete-room-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirm(ch.id);
                }}
                title="Delete room"
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      {deleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-box" onClick={e => e.stopPropagation()}>
            <p>
              Delete <strong>#{channels.find(c => c.id === deleteConfirm)?.name}</strong>?
            </p>
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
            <button
              key={ch.id}
              className={`channel-btn dm-btn ${currentChannel === ch.id ? 'active' : ''}`}
              onClick={() => handleSelectChannel(ch.id)}
            >
              <span className="channel-main">
                <span className="agent-dot" style={{ backgroundColor: agent?.color || '#6B7280' }} />
                <span className="dm-label">
                  {agent?.emoji || 'AI'} {ch.name.replace('DM: ', '')}
                </span>
              </span>
              {renderUnreadBadge(ch.id)}
            </button>
          );
        })}
      </div>

      <div className="channel-section staff-section">
        <h3>Staff ({agents.length})</h3>
        {agents.map(a => (
          <div
            key={a.id}
            className="staff-item"
            onClick={() => onAgentClick?.(a.id)}
            style={{ cursor: 'pointer' }}
            title={`${a.display_name}'s profile`}
          >
            <span className="agent-dot" style={{ backgroundColor: a.color }} />
            <span className="staff-emoji">{a.emoji}</span>
            <span className="staff-name">{a.display_name}</span>
            <span className={`staff-presence ${isAgentOnline(a) ? 'online' : 'offline'}`}>
              {isAgentOnline(a) ? 'Online' : 'Offline'}
            </span>
            <span className="staff-role">{a.role}</span>
            {(a.backend === 'claude' || a.backend === 'openai') && <span className="staff-badge">API</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
