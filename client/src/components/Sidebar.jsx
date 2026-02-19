import { useCallback, useEffect, useRef, useState } from 'react';
import useVisibilityInterval from '../hooks/useVisibilityInterval';
import { createStartupRequestMeter } from '../lib/perf/requestMeter';

const CHANNEL_REFRESH_MS = 30_000;
const AGENT_REFRESH_MS = 45_000;
const STATUS_REFRESH_MS = 45_000;
const ACTIVITY_REFRESH_MS = 30_000;
const ACTIVITY_LIMIT = 200;
const VISIBLE_UNREAD_LIMIT = 20;
const SEEN_KEY_PREFIX = 'ai-office:seen-msg:global:';

function readSeenMessageId(channelId) {
  if (!channelId) return null;
  try {
    const raw = localStorage.getItem(`${SEEN_KEY_PREFIX}${channelId}`);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSeenMessageId(channelId, messageId) {
  if (!channelId || !Number.isFinite(messageId)) return;
  try {
    localStorage.setItem(`${SEEN_KEY_PREFIX}${channelId}`, String(Math.max(0, Math.trunc(messageId))));
  } catch {
    // ignore storage failures
  }
}

export default function Sidebar({
  currentChannel,
  onSelectChannel,
  onAgentClick,
  theme = 'dark',
  onToggleTheme,
}) {
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
  const [dmExpanded, setDmExpanded] = useState(false);
  const [channelActivity, setChannelActivity] = useState({});

  const seenMessageIdsRef = useRef({});
  const previousUnreadRef = useRef({});
  const audioContextRef = useRef(null);
  const requestMeterRef = useRef(null);
  if (!requestMeterRef.current) {
    requestMeterRef.current = createStartupRequestMeter('sidebar');
  }

  const channelsAbortRef = useRef(null);
  const agentsAbortRef = useRef(null);
  const statusAbortRef = useRef(null);
  const activityAbortRef = useRef(null);

  const channelsRefreshingRef = useRef(false);
  const agentsRefreshingRef = useRef(false);
  const statusRefreshingRef = useRef(false);
  const activityRefreshingRef = useRef(false);

  const trackRequest = useCallback((endpoint) => {
    requestMeterRef.current?.track(endpoint);
  }, []);

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

  const loadChannels = useCallback(async () => {
    if (channelsRefreshingRef.current) return;
    channelsRefreshingRef.current = true;
    channelsAbortRef.current?.abort();
    const controller = new AbortController();
    channelsAbortRef.current = controller;
    try {
      trackRequest('/api/channels');
      const resp = await fetch('/api/channels', { signal: controller.signal });
      if (!resp.ok) throw new Error(`Failed to load channels (${resp.status})`);
      const payload = await resp.json();
      setChannels(Array.isArray(payload) ? payload : []);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Failed to load channels:', err);
      }
    } finally {
      if (channelsAbortRef.current === controller) {
        channelsAbortRef.current = null;
      }
      channelsRefreshingRef.current = false;
    }
  }, [trackRequest]);

  const loadAgents = useCallback(async () => {
    if (agentsRefreshingRef.current) return;
    agentsRefreshingRef.current = true;
    agentsAbortRef.current?.abort();
    const controller = new AbortController();
    agentsAbortRef.current = controller;
    try {
      trackRequest('/api/agents?active_only=true');
      const resp = await fetch('/api/agents?active_only=true', { signal: controller.signal });
      if (!resp.ok) throw new Error(`Failed to load agents (${resp.status})`);
      const payload = await resp.json();
      setAgents(Array.isArray(payload) ? payload : []);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Failed to load agents:', err);
      }
    } finally {
      if (agentsAbortRef.current === controller) {
        agentsAbortRef.current = null;
      }
      agentsRefreshingRef.current = false;
    }
  }, [trackRequest]);

  const loadBackendStatus = useCallback(async () => {
    if (statusRefreshingRef.current) return;
    statusRefreshingRef.current = true;
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    try {
      const statuses = await Promise.all([
        (async () => {
          trackRequest('/api/ollama/status');
          const r = await fetch('/api/ollama/status', { signal: controller.signal });
          return r.ok ? r.json() : { available: false };
        })(),
        (async () => {
          trackRequest('/api/claude/status');
          const r = await fetch('/api/claude/status', { signal: controller.signal });
          return r.ok ? r.json() : { available: false };
        })(),
        (async () => {
          trackRequest('/api/openai/status');
          const r = await fetch('/api/openai/status', { signal: controller.signal });
          return r.ok ? r.json() : { available: false };
        })(),
      ]);
      setBackendStatus({
        ollama: Boolean(statuses[0]?.available),
        claude: Boolean(statuses[1]?.available),
        openai: Boolean(statuses[2]?.available),
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setBackendStatus({ ollama: false, claude: false, openai: false });
      }
    } finally {
      if (statusAbortRef.current === controller) {
        statusAbortRef.current = null;
      }
      statusRefreshingRef.current = false;
    }
  }, [trackRequest]);

  const loadChannelActivity = useCallback(async () => {
    if (!channels.length || activityRefreshingRef.current) return;
    activityRefreshingRef.current = true;
    activityAbortRef.current?.abort();
    const controller = new AbortController();
    activityAbortRef.current = controller;
    try {
      trackRequest('/api/channels/activity');
      const resp = await fetch(`/api/channels/activity?limit=${ACTIVITY_LIMIT}`, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Failed to load channel activity (${resp.status})`);
      const payload = await resp.json();
      const rows = Array.isArray(payload?.activity)
        ? payload.activity
        : Array.isArray(payload)
          ? payload
          : [];

      const activityMap = {};
      rows.forEach((entry) => {
        const channelId = String(entry?.channel_id || '').trim();
        if (!channelId) return;
        const latestMessageId = Number(entry?.latest_message_id || 0);
        activityMap[channelId] = {
          ...entry,
          latest_message_id: Number.isFinite(latestMessageId) ? latestMessageId : 0,
        };
      });
      setChannelActivity(activityMap);

      const visibleChannels = channels
        .filter((ch) => ch?.type === 'group' || (dmExpanded && ch?.type === 'dm'))
        .slice(0, VISIBLE_UNREAD_LIMIT);
      const relevantIds = new Set(visibleChannels.map((ch) => ch.id));
      if (currentChannel) relevantIds.add(currentChannel);

      const nextUnread = {};
      relevantIds.forEach((channelId) => {
        const latestId = Number(activityMap[channelId]?.latest_message_id || 0);
        if (!Number.isFinite(latestId)) return;

        if (seenMessageIdsRef.current[channelId] == null) {
          const persisted = readSeenMessageId(channelId);
          if (persisted != null) {
            seenMessageIdsRef.current[channelId] = persisted;
          }
        }

        if (currentChannel === channelId) {
          seenMessageIdsRef.current[channelId] = latestId;
          writeSeenMessageId(channelId, latestId);
          nextUnread[channelId] = 0;
          return;
        }

        if (seenMessageIdsRef.current[channelId] == null) {
          seenMessageIdsRef.current[channelId] = latestId;
          writeSeenMessageId(channelId, latestId);
          nextUnread[channelId] = 0;
          return;
        }

        const seenId = Number(seenMessageIdsRef.current[channelId] || 0);
        nextUnread[channelId] = latestId > seenId ? 1 : 0;
      });

      setUnreadCounts(nextUnread);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('Failed to load channel activity:', err);
      }
    } finally {
      if (activityAbortRef.current === controller) {
        activityAbortRef.current = null;
      }
      activityRefreshingRef.current = false;
    }
  }, [channels, currentChannel, dmExpanded, trackRequest]);

  useEffect(() => {
    loadChannels();
    loadAgents();
    loadBackendStatus();
    return () => {
      channelsAbortRef.current?.abort();
      agentsAbortRef.current?.abort();
      statusAbortRef.current?.abort();
      activityAbortRef.current?.abort();
      requestMeterRef.current?.stop('sidebar-unmount');
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [loadAgents, loadBackendStatus, loadChannels]);

  useVisibilityInterval(loadChannels, CHANNEL_REFRESH_MS, { enabled: true });
  useVisibilityInterval(loadAgents, AGENT_REFRESH_MS, { enabled: true });
  useVisibilityInterval(loadBackendStatus, STATUS_REFRESH_MS, { enabled: true });
  useVisibilityInterval(loadChannelActivity, ACTIVITY_REFRESH_MS, { enabled: channels.length > 0 });

  useEffect(() => {
    loadChannelActivity();
  }, [loadChannelActivity]);

  useEffect(() => {
    if (!currentChannel) return;
    const latestForCurrent = Number(channelActivity[currentChannel]?.latest_message_id || 0);
    if (!Number.isFinite(latestForCurrent) || latestForCurrent <= 0) return;
    seenMessageIdsRef.current[currentChannel] = latestForCurrent;
    writeSeenMessageId(currentChannel, latestForCurrent);
    setUnreadCounts((prev) => {
      if (!prev[currentChannel]) return prev;
      return { ...prev, [currentChannel]: 0 };
    });
  }, [channelActivity, currentChannel]);

  useEffect(() => {
    const validIds = new Set(channels.map((ch) => ch.id));
    Object.keys(seenMessageIdsRef.current).forEach((id) => {
      if (!validIds.has(id)) delete seenMessageIdsRef.current[id];
    });
  }, [channels]);

  useEffect(() => {
    const handleAgentsUpdated = () => {
      loadAgents();
      loadBackendStatus();
    };
    window.addEventListener('agents-updated', handleAgentsUpdated);
    return () => {
      window.removeEventListener('agents-updated', handleAgentsUpdated);
    };
  }, [loadAgents, loadBackendStatus]);

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
  }, [currentChannel, unreadCounts]);

  const agentMap = {};
  agents.forEach((agent) => {
    agentMap[agent.id] = agent;
  });

  const createRoom = () => {
    if (!newName.trim()) return;
    fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    })
      .then((r) => r.json())
      .then((ch) => {
        setNewName('');
        setShowCreate(false);
        loadChannels();
        if (ch.id) onSelectChannel(ch.id);
      });
  };

  const deleteRoom = (chId, deleteMessages) => {
    fetch(`/api/channels/${chId}?delete_messages=${deleteMessages}`, { method: 'DELETE' }).then(() => {
      setDeleteConfirm(null);
      loadChannels();
      if (currentChannel === chId) onSelectChannel('main');
    });
  };

  const handleSelectChannel = (channelId) => {
    const latestMessageId = Number(channelActivity[channelId]?.latest_message_id || 0);
    if (Number.isFinite(latestMessageId) && latestMessageId > 0) {
      seenMessageIdsRef.current[channelId] = latestMessageId;
      writeSeenMessageId(channelId, latestMessageId);
    }
    setUnreadCounts((prev) => {
      if (!prev[channelId]) return prev;
      return { ...prev, [channelId]: 0 };
    });
    onSelectChannel(channelId);
  };

  const renderUnreadBadge = (channelId) => {
    const count = unreadCounts[channelId] || 0;
    if (count <= 0) return null;
    return <span className="unread-badge">New</span>;
  };

  const isAgentOnline = (agent) => {
    if (!agent?.active) return false;
    if (agent.backend === 'claude') return backendStatus.claude;
    if (agent.backend === 'openai') return backendStatus.openai;
    return backendStatus.ollama;
  };

  const groupChannels = channels.filter((c) => c.type === 'group');
  const dmChannels = channels.filter((c) => c.type === 'dm');

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
          <div className="section-header-actions">
            <button className="add-room-btn" onClick={() => { loadChannels(); loadChannelActivity(); }} title="Refresh channels">
              ↻
            </button>
            <button className="add-room-btn" onClick={() => setShowCreate(!showCreate)} title="New room">
              +
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="create-room">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Room name..."
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && createRoom()}
            />
            <button onClick={createRoom}>Create</button>
          </div>
        )}

        {groupChannels.map((ch) => (
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
          <div className="delete-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>
              Delete <strong>#{channels.find((c) => c.id === deleteConfirm)?.name}</strong>?
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
        <div className="section-header">
          <h3>Direct Messages</h3>
          <button
            className="add-room-btn"
            onClick={() => setDmExpanded((prev) => !prev)}
            title={dmExpanded ? 'Collapse direct messages' : 'Expand direct messages'}
          >
            {dmExpanded ? '−' : '+'}
          </button>
        </div>
        {dmExpanded &&
          dmChannels.map((ch) => {
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
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="staff-item"
            onClick={() => onAgentClick?.(agent.id)}
            style={{ cursor: 'pointer' }}
            title={`${agent.display_name}'s profile`}
          >
            <span className="agent-dot" style={{ backgroundColor: agent.color }} />
            <span className="staff-emoji">{agent.emoji}</span>
            <span className="staff-name">{agent.display_name}</span>
            <span className={`staff-presence ${isAgentOnline(agent) ? 'online' : 'offline'}`}>
              {isAgentOnline(agent) ? 'Online' : 'Offline'}
            </span>
            <span className="staff-role">{agent.role}</span>
            {(agent.backend === 'claude' || agent.backend === 'openai') && <span className="staff-badge">API</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
