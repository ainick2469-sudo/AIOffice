import { useState, useEffect, useRef } from 'react';
import { fetchMessages, fetchAgents } from '../api';
import useWebSocket from '../hooks/useWebSocket';
import MessageContent from './MessageContent';

export default function ChatRoom({ channel }) {
  const { connected, messages, setMessages, send, typingAgents } = useWebSocket(channel);
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState({});
  const [convoStatus, setConvoStatus] = useState(null);
  const [channelName, setChannelName] = useState(null);
  const bottomRef = useRef(null);
  const statusInterval = useRef(null);

  // Load agents
  useEffect(() => {
    fetchAgents().then(list => {
      const map = {};
      list.forEach(a => { map[a.id] = a; });
      setAgents(map);
    });
  }, []);

  // Fetch custom channel name
  useEffect(() => {
    setChannelName(null);
    fetch('/api/channels').then(r => r.json()).then(chs => {
      const ch = chs.find(c => c.id === channel);
      if (ch) setChannelName(ch.name);
    });
    // Re-check every 15s for auto-renames
    const interval = setInterval(() => {
      fetch('/api/channels').then(r => r.json()).then(chs => {
        const ch = chs.find(c => c.id === channel);
        if (ch) setChannelName(ch.name);
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [channel]);

  // Load history on channel switch
  useEffect(() => {
    fetchMessages(channel).then(history => {
      setMessages(history);
    }).catch(console.error);
  }, [channel, setMessages]);

  // Poll conversation status
  useEffect(() => {
    const poll = () => {
      fetch(`/api/conversation/${channel}`)
        .then(r => r.json())
        .then(setConvoStatus)
        .catch(() => {});
    };
    poll();
    statusInterval.current = setInterval(poll, 2000);
    return () => clearInterval(statusInterval.current);
  }, [channel]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingAgents]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    send(text);
    setInput('');
  };

  const stopConversation = () => {
    fetch(`/api/conversation/${channel}/stop`, { method: 'POST' })
      .then(r => r.json())
      .then(() => setConvoStatus(prev => ({ ...prev, active: false })));
  };

  const getSender = (msg) => {
    if (msg.sender === 'user') return { name: 'You', color: '#3B82F6', emoji: '🧑' };
    if (msg.sender === 'system') return { name: 'System', color: '#F59E0B', emoji: '⚙️' };
    const agent = agents[msg.sender];
    return agent
      ? { name: agent.display_name, color: agent.color, emoji: agent.emoji || '🤖' }
      : { name: msg.sender, color: '#6B7280', emoji: '🤖' };
  };

  const getMsgClass = (msg) => {
    if (msg.sender === 'user') return 'msg-user';
    if (msg.sender === 'system' || msg.msg_type === 'system') return 'msg-system';
    if (msg.msg_type === 'review') return 'msg-agent msg-review';
    if (msg.msg_type === 'decision') return 'msg-agent msg-decision';
    if (msg.msg_type === 'tool_result') return 'msg-agent msg-tool-result';
    return 'msg-agent';
  };

  const channelLabel = channelName
    ? (channel === 'main' ? `# ${channelName}` : channelName)
    : (channel === 'main' ? '# Main Room' : `DM: ${agents[channel.replace('dm:', '')]?.display_name || channel}`);

  const isActive = convoStatus?.active;

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>{channelLabel}</h2>
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
          <span className="status-text">{connected ? 'Connected' : 'Reconnecting...'}</span>
        </div>
        <div className="chat-header-right">
          {isActive && (
            <>
              <span className="convo-status active">
                💬 Active ({convoStatus.message_count} msgs)
              </span>
              <button className="stop-btn" onClick={stopConversation}>
                ⏹ Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-chat">No messages yet. Say something!</div>
        )}
        {messages.map((msg) => {
          const sender = getSender(msg);
          return (
            <div key={msg.id} className={`message ${getMsgClass(msg)}`}>
              <div className="msg-header">
                <span className="msg-emoji">{sender.emoji}</span>
                <span className="msg-sender" style={{ color: sender.color }}>
                  {sender.name}
                </span>
                <span className="msg-time">
                  {new Date(msg.created_at + 'Z').toLocaleTimeString()}
                </span>
              </div>
              <div className="msg-body"><MessageContent content={msg.content} /></div>
            </div>
          );
        })}
        {typingAgents.length > 0 && (
          <div className="typing-indicator">
            {typingAgents.map(a => a.display_name).join(', ')}
            {typingAgents.length === 1 ? ' is' : ' are'} thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isActive ? `Jump in — agents are talking...` : `Message ${channelLabel}...`}
          autoFocus
        />
        <button type="submit" disabled={!connected}>Send</button>
      </form>
    </div>
  );
}
