import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchMessages, fetchAgents } from '../api';
import useWebSocket from '../hooks/useWebSocket';
import MessageContent from './MessageContent';

const HISTORY_LIMIT = 200;
const MAX_ATTACHMENTS = 8;

export default function ChatRoom({ channel }) {
  const { connected, messages, setMessages, send, typingAgents, lastEvent } = useWebSocket(channel);
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState({});
  const [convoStatus, setConvoStatus] = useState(null);
  const [collabMode, setCollabMode] = useState({ mode: 'chat', active: false });
  const [activeProject, setActiveProject] = useState({ project: 'ai-office', path: '' });
  const [workStatus, setWorkStatus] = useState({ running: false, processed: 0, errors: 0 });
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [channelName, setChannelName] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [threadRootId, setThreadRootId] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const bottomRef = useRef(null);
  const statusInterval = useRef(null);
  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const loadedReactionIdsRef = useRef(new Set());

  // Load agents
  useEffect(() => {
    fetchAgents()
      .then(list => {
        const map = {};
        list.forEach((agent) => {
          map[agent.id] = agent;
        });
        setAgents(map);
      })
      .catch(console.error);
  }, []);

  // Fetch custom channel name
  useEffect(() => {
    setChannelName(null);
    fetch('/api/channels')
      .then(r => r.json())
      .then((chs) => {
        const ch = chs.find(c => c.id === channel);
        if (ch) setChannelName(ch.name);
      });

    const interval = setInterval(() => {
      fetch('/api/channels')
        .then(r => r.json())
        .then((chs) => {
          const ch = chs.find(c => c.id === channel);
          if (ch) setChannelName(ch.name);
        });
    }, 15000);
    return () => clearInterval(interval);
  }, [channel]);

  // Load history on channel switch
  useEffect(() => {
    fetchMessages(channel, HISTORY_LIMIT)
      .then(history => {
        setMessages(history);
      })
      .catch(console.error);
  }, [channel, setMessages]);

  // Reset local message composition state on channel switch.
  useEffect(() => {
    setReplyTo(null);
    setThreadRootId(null);
    setAttachments([]);
    setUploadError('');
    setDragActive(false);
    dragDepthRef.current = 0;
    loadedReactionIdsRef.current = new Set();
    setReactionsByMessage({});
  }, [channel]);

  // Poll conversation status
  useEffect(() => {
    const poll = () => {
      fetch(`/api/conversation/${channel}`)
        .then(r => r.json())
        .then(setConvoStatus)
        .catch(() => {});
      fetch(`/api/collab-mode/${channel}`)
        .then(r => r.json())
        .then(setCollabMode)
        .catch(() => {});
      fetch(`/api/projects/active/${channel}`)
        .then(r => r.json())
        .then(setActiveProject)
        .catch(() => {});
      fetch(`/api/work/status/${channel}`)
        .then(r => r.json())
        .then(setWorkStatus)
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

  useEffect(() => {
    const missing = messages
      .map(msg => msg.id)
      .filter(id => !loadedReactionIdsRef.current.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(
      missing.map(id =>
        fetch(`/api/messages/${id}/reactions`)
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setReactionsByMessage((prev) => {
        const next = { ...prev };
        results.forEach((summary, idx) => {
          const id = missing[idx];
          loadedReactionIdsRef.current.add(id);
          next[id] = summary?.reactions || {};
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [messages]);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'reaction_update' && lastEvent.message_id) {
      setReactionsByMessage(prev => ({
        ...prev,
        [lastEvent.message_id]: lastEvent.summary?.reactions || {},
      }));
      loadedReactionIdsRef.current.add(lastEvent.message_id);
    }
    if (lastEvent.type === 'project_switched' && lastEvent.active) {
      setActiveProject(lastEvent.active);
    }
  }, [lastEvent]);

  const messageMap = useMemo(() => {
    const map = new Map();
    messages.forEach((message) => {
      map.set(message.id, message);
    });
    return map;
  }, [messages]);

  const childCounts = useMemo(() => {
    const counts = {};
    messages.forEach((message) => {
      if (message.parent_id) {
        counts[message.parent_id] = (counts[message.parent_id] || 0) + 1;
      }
    });
    return counts;
  }, [messages]);

  const threadMessageIds = useMemo(() => {
    if (!threadRootId) return new Set();

    const ids = new Set([threadRootId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const message of messages) {
        if (message.parent_id && ids.has(message.parent_id) && !ids.has(message.id)) {
          ids.add(message.id);
          expanded = true;
        }
      }
    }
    return ids;
  }, [messages, threadRootId]);

  const threadMessages = useMemo(
    () => messages.filter(message => threadMessageIds.has(message.id)),
    [messages, threadMessageIds]
  );

  const threadRootMessage = threadRootId ? messageMap.get(threadRootId) : null;

  const summarize = (text, max = 90) => {
    if (!text) return '';
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    return `${flat.slice(0, max - 3)}...`;
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImageType = (mimeType) => (mimeType || '').startsWith('image/');

  const getSender = (msg) => {
    if (msg.sender === 'user') return { name: 'You', color: '#3B82F6', emoji: 'Y' };
    if (msg.sender === 'system') return { name: 'System', color: '#F59E0B', emoji: 'S' };
    const agent = agents[msg.sender];
    return agent
      ? { name: agent.display_name, color: agent.color, emoji: agent.emoji || 'A' }
      : { name: msg.sender, color: '#6B7280', emoji: 'A' };
  };

  const getMsgClass = (msg) => {
    if (msg.sender === 'user') return 'msg-user';
    if (msg.sender === 'system' || msg.msg_type === 'system') return 'msg-system';
    if (msg.msg_type === 'review') return 'msg-agent msg-review';
    if (msg.msg_type === 'decision') return 'msg-agent msg-decision';
    if (msg.msg_type === 'tool_result') return 'msg-agent msg-tool-result';
    return 'msg-agent';
  };

  const getRootId = (message) => {
    let currentId = message.id;
    let safety = 0;
    while (safety < 80) {
      const current = messageMap.get(currentId);
      if (!current || !current.parent_id) return currentId;
      currentId = current.parent_id;
      safety += 1;
    }
    return message.id;
  };

  const startReply = (message) => {
    const sender = getSender(message);
    setReplyTo({
      id: message.id,
      sender: sender.name,
      content: summarize(message.content),
    });
  };

  const openThread = (message) => {
    setThreadRootId(getRootId(message));
  };

  const getMessageDate = (msg) => {
    const value = msg.created_at || '';
    const iso = value.endsWith('Z') ? value : `${value}Z`;
    return new Date(iso);
  };

  const getMessageTime = (msg) => getMessageDate(msg).toLocaleTimeString();

  const shouldShowTime = (messagesList, index) => {
    if (index <= 0) return true;
    const current = messagesList[index];
    const previous = messagesList[index - 1];
    if (!previous) return true;
    if (current.sender !== previous.sender) return true;

    const gapMs = getMessageDate(current).getTime() - getMessageDate(previous).getTime();
    return Math.abs(gapMs) > 90000;
  };

  const uploadSingleFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/files/upload', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.error) {
      const msg = payload.error || `Upload failed (${response.status})`;
      throw new Error(msg);
    }

    return {
      id: payload.file_name || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      originalName: payload.original_name || file.name,
      fileName: payload.file_name || file.name,
      path: payload.path || `uploads/${payload.file_name}`,
      url: payload.url || `/uploads/${payload.file_name}`,
      size: payload.size ?? file.size ?? 0,
      contentType: payload.content_type || file.type || 'application/octet-stream',
    };
  };

  const addFiles = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (remainingSlots === 0) {
      setUploadError(`Max ${MAX_ATTACHMENTS} attachments per message.`);
      return;
    }

    const toUpload = incoming.slice(0, remainingSlots);
    setUploadError('');
    setIsUploading(true);

    try {
      const uploaded = [];
      for (const file of toUpload) {
        // Upload sequentially to keep ordering predictable.
        const result = await uploadSingleFile(file);
        uploaded.push(result);
      }
      setAttachments(prev => [...prev, ...uploaded]);
      if (incoming.length > remainingSlots) {
        setUploadError(`Only ${MAX_ATTACHMENTS} attachments are allowed per message.`);
      }
    } catch (err) {
      setUploadError(err?.message || 'File upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const removeAttachment = (attachmentId) => {
    setAttachments(prev => prev.filter(file => file.id !== attachmentId));
  };

  const hasFilePayload = (event) =>
    Array.from(event.dataTransfer?.types || []).includes('Files');

  const handleDragEnter = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  };

  const handleDrop = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    addFiles(event.dataTransfer.files);
  };

  const handleFileInputChange = (event) => {
    addFiles(event.target.files);
    event.target.value = '';
  };

  const buildOutgoingMessage = (text, files) => {
    const sections = [];
    if (text) sections.push(text);
    if (files.length > 0) {
      const listLines = files.map((file) => {
        const meta = `${file.contentType}, ${formatBytes(file.size)}`;
        let line = `- [${file.originalName}](${file.url}) (${meta}) saved as \`${file.path}\``;
        if (isImageType(file.contentType)) {
          line += `\n  ![${file.originalName}](${file.url})`;
        }
        return line;
      });
      sections.push(`Attachments:\n${listLines.join('\n')}`);
    }
    return sections.join('\n\n');
  };

  const handleSend = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text && attachments.length === 0) return;

    const content = buildOutgoingMessage(text, attachments);
    send(content, 'message', replyTo?.id || null);
    setInput('');
    setReplyTo(null);
    setAttachments([]);
    setUploadError('');
  };

  const stopConversation = () => {
    fetch(`/api/conversation/${channel}/stop`, { method: 'POST' })
      .then(r => r.json())
      .then(() => setConvoStatus(prev => ({ ...prev, active: false })));
  };

  const stopWork = () => {
    fetch('/api/work/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    })
      .then(r => r.json())
      .then(setWorkStatus)
      .catch(() => {});
  };

  const toggleReaction = (messageId, emoji) => {
    fetch(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emoji,
        actor_id: 'user',
        actor_type: 'user',
      }),
    })
      .then(r => r.json())
      .then((payload) => {
        if (!payload?.summary) return;
        setReactionsByMessage(prev => ({
          ...prev,
          [messageId]: payload.summary.reactions || {},
        }));
        loadedReactionIdsRef.current.add(messageId);
      })
      .catch(() => {});
  };

  const reactionEntries = (messageId) => Object.entries(reactionsByMessage[messageId] || {});

  const channelLabel = channelName
    ? (channel === 'main' ? `# ${channelName}` : channelName)
    : (
      channel === 'main'
        ? '# Main Room'
        : `DM: ${agents[channel.replace('dm:', '')]?.display_name || channel}`
    );

  const isActive = convoStatus?.active;

  return (
    <div className="chat-room">
      <div className="chat-header">
        <div className="chat-header-left">
          <h2>{channelLabel}</h2>
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
          <span className="status-text">{connected ? 'Connected' : 'Reconnecting...'}</span>
          <span className={`convo-status ${collabMode?.active ? 'active' : ''}`}>
            Mode: {collabMode?.mode || 'chat'}
          </span>
          <span className="convo-status">
            Project: {activeProject?.project || 'ai-office'}
          </span>
        </div>
        <div className="chat-header-right">
          {isActive && (
            <>
              <span className="convo-status active">
                Active ({convoStatus.message_count} msgs)
              </span>
              <button className="stop-btn" onClick={stopConversation}>
                Stop
              </button>
            </>
          )}
          {workStatus?.running && (
            <>
              <span className="convo-status active">
                Working... ({workStatus.processed || 0})
              </span>
              <button className="stop-btn" onClick={stopWork}>
                Stop Work
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className={`chat-content ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive && (
          <div className="chat-drop-overlay">
            Drop files to attach
          </div>
        )}

        <div className="message-list">
          {messages.length === 0 && (
            <div className="empty-chat">No messages yet. Say something!</div>
          )}

          {messages.map((msg, index) => {
            const sender = getSender(msg);
            const parent = msg.parent_id ? messageMap.get(msg.parent_id) : null;
            const inOpenThread = threadRootId ? threadMessageIds.has(msg.id) : false;
            const hasThread = Boolean(msg.parent_id) || (childCounts[msg.id] || 0) > 0;
            const showTime = shouldShowTime(messages, index);
            return (
              <div
                key={msg.id}
                className={`message ${getMsgClass(msg)} ${inOpenThread ? 'message-in-thread' : ''}`}
              >
                {parent && (
                  <button className="msg-parent-preview" onClick={() => openThread(parent)}>
                    Replying to {getSender(parent).name}: {summarize(parent.content, 70)}
                  </button>
                )}

                <div className="msg-header">
                  <span className="msg-emoji">{sender.emoji}</span>
                  <span className="msg-sender" style={{ color: sender.color }}>
                    {sender.name}
                  </span>
                  {showTime && <span className="msg-time">{getMessageTime(msg)}</span>}
                </div>

                <div className="msg-body">
                  <MessageContent content={msg.content} />
                </div>

                <div className="msg-actions">
                  <button className="msg-action-btn" onClick={() => startReply(msg)}>
                    Reply
                  </button>
                  {hasThread && (
                    <button className="msg-action-btn" onClick={() => openThread(msg)}>
                      {childCounts[msg.id] ? `Thread (${childCounts[msg.id]})` : 'View thread'}
                    </button>
                  )}
                  <button className="msg-action-btn" onClick={() => toggleReaction(msg.id, '👍')}>
                    👍
                  </button>
                  <button className="msg-action-btn" onClick={() => toggleReaction(msg.id, '✅')}>
                    ✅
                  </button>
                  <button className="msg-action-btn" onClick={() => toggleReaction(msg.id, '⚠️')}>
                    ⚠️
                  </button>
                </div>
                {reactionEntries(msg.id).length > 0 && (
                  <div className="msg-reactions">
                    {reactionEntries(msg.id).map(([emoji, info]) => (
                      <button
                        key={`${msg.id}-${emoji}`}
                        className="msg-reaction-chip"
                        onClick={() => toggleReaction(msg.id, emoji)}
                        title={`${info.count} reaction(s)`}
                      >
                        {emoji} {info.count}
                      </button>
                    ))}
                  </div>
                )}
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

        {threadRootId && (
          <aside className="thread-panel">
            <div className="thread-header">
              <h3>Thread</h3>
              <button className="thread-close-btn" onClick={() => setThreadRootId(null)}>
                Close
              </button>
            </div>

            {!threadRootMessage ? (
              <div className="thread-body">
                <div className="panel-empty">
                  Thread root is outside loaded history.
                </div>
              </div>
            ) : (
              <div className="thread-body">
                {threadMessages.map((msg) => {
                  const sender = getSender(msg);
                  const parent = msg.parent_id ? messageMap.get(msg.parent_id) : null;
                  return (
                    <div key={msg.id} className="thread-msg">
                      {parent && (
                        <div className="thread-parent">
                          In reply to {getSender(parent).name}: {summarize(parent.content, 70)}
                        </div>
                      )}
                      <div className="msg-header">
                        <span className="msg-emoji">{sender.emoji}</span>
                        <span className="msg-sender" style={{ color: sender.color }}>
                          {sender.name}
                        </span>
                        <span className="msg-time">{getMessageTime(msg)}</span>
                      </div>
                      <div className="msg-body">
                        <MessageContent content={msg.content} />
                      </div>
                      <div className="thread-actions">
                        <button className="msg-action-btn" onClick={() => startReply(msg)}>
                          Reply
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        {uploadError && (
          <div className="upload-error">
            {uploadError}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((file) => (
              <div key={file.id} className="attachment-chip">
                {isImageType(file.contentType) && (
                  <img className="attachment-thumb" src={file.url} alt={file.originalName} />
                )}
                <div className="attachment-meta">
                  <span className="attachment-name" title={file.originalName}>{file.originalName}</span>
                  <span className="attachment-size">{formatBytes(file.size)}</span>
                </div>
                <button
                  type="button"
                  className="attachment-remove-btn"
                  onClick={() => removeAttachment(file.id)}
                  title="Remove attachment"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {replyTo && (
          <div className="replying-bar">
            <span>
              Replying to <strong>{replyTo.sender}</strong>: {replyTo.content}
            </span>
            <button type="button" className="reply-cancel-btn" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="file-input-hidden"
        />

        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? 'Uploading...' : 'Attach'}
        </button>

        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={isActive ? 'Jump in - agents are talking...' : `Message ${channelLabel}...`}
          autoFocus
        />
        <button type="submit" disabled={!connected || isUploading}>Send</button>
      </form>
    </div>
  );
}
