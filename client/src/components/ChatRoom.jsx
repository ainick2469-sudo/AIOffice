import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchMessages, fetchAgents } from '../api';
import useWebSocket from '../hooks/useWebSocket';
import MessageContent from './MessageContent';
import StatusPanel from './StatusPanel';
import ContextStrip from './chat/ContextStrip';
import MessageActionsMenu from './chat/MessageActionsMenu';
import {
  clearChatDraft,
  loadChatDraft,
  saveChatDraft,
} from '../lib/storage/chatDrafts';
import { useBeginnerMode } from './beginner/BeginnerModeContext';
import useEscapeKey from '../hooks/useEscapeKey';
import useBodyScrollLock from '../hooks/useBodyScrollLock';

const HISTORY_LIMIT = 200;
const MAX_ATTACHMENTS = 8;
const SPEC_SECTION_OPTIONS = [
  { key: 'problem_goal', label: 'Problem / Goal' },
  { key: 'target_platform', label: 'Target Platform' },
  { key: 'core_loop', label: 'Core Loop' },
  { key: 'features', label: 'Features' },
  { key: 'non_goals', label: 'Non-Goals' },
  { key: 'ux_notes', label: 'UX Notes' },
  { key: 'data_state_model', label: 'Data / State Model' },
  { key: 'acceptance_criteria', label: 'Acceptance Criteria' },
  { key: 'risks_unknowns', label: 'Risks + Unknowns' },
];

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function pinStorageKey(projectName, channel) {
  const project = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  const room = String(channel || 'main').trim().toLowerCase() || 'main';
  return `ai-office:chat-pins:${project}:${room}`;
}

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function makeContextId(type, value) {
  const source = `${type}:${value}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  return source;
}

function normalizeContext(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim();
  const type = String(item.type || 'context').trim();
  const label = String(item.label || '').trim();
  const value = String(item.value || '').trim();
  if (!id || !label) return null;
  return { id, type, label, value };
}

function isNearBottom(node, threshold = 120) {
  if (!node) return true;
  const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
  return distance <= threshold;
}

function formatProviderName(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'openai') return 'OpenAI';
  if (value === 'claude') return 'Claude';
  if (value === 'ollama') return 'Ollama';
  return value;
}

function formatCredentialSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'agent_override') return 'agent_override';
  if (value === 'provider_default') return 'provider_default';
  if (value === 'fallback_ollama') return 'fallback_ollama';
  if (value === 'local') return 'local';
  return value;
}

function getMessageProvenance(message) {
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : null;
  if (!meta) return '';
  const provider = formatProviderName(meta.provider);
  const model = String(meta.model || '').trim();
  const source = formatCredentialSource(meta.credential_source);
  const parts = [];
  if (provider) parts.push(`Provider: ${provider}`);
  if (model) parts.push(`Model: ${model}`);
  if (source) parts.push(`Source: ${source}`);
  if (!parts.length) return '';
  if (meta.fallback) parts.push('FALLBACK: OLLAMA');
  return parts.join(' | ');
}

export default function ChatRoom({
  channel = 'main',
  workspaceMode = 'build',
  beginnerMode = false,
  onBeginnerBrainstorm = null,
  prefillText = '',
  queuedMessage = null,
  onPrefillConsumed = null,
  onRequestOpenTab = null,
  showStatusPanel = true,
  onBackToWorkspace = null,
  compact = false,
}) {
  const { connected, messages, setMessages, send, typingAgents, lastEvent } = useWebSocket(channel);
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState({});
  const [convoStatus, setConvoStatus] = useState(null);
  const [collabMode, setCollabMode] = useState({ mode: 'chat', active: false });
  const [activeProject, setActiveProject] = useState({ project: 'ai-office', path: '', branch: 'main' });
  const [autonomyMode, setAutonomyMode] = useState('SAFE');
  const [permissionPolicy, setPermissionPolicy] = useState({ mode: 'ask', expires_at: null });
  const [specState, setSpecState] = useState({ project: 'ai-office', status: 'none', spec_version: null });
  const [workStatus, setWorkStatus] = useState({ running: false, processed: 0, errors: 0 });
  const [processState, setProcessState] = useState({ total: 0, running: 0, items: [] });
  const [reactionsByMessage, setReactionsByMessage] = useState({});
  const [channelName, setChannelName] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [threadRootId, setThreadRootId] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [clockMs, setClockMs] = useState(Date.now());
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [activeApproval, setActiveApproval] = useState(null);
  const [approvalListOpen, setApprovalListOpen] = useState(false);
  const [trustMinutes, setTrustMinutes] = useState(30);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [dismissedApprovals, setDismissedApprovals] = useState(() => new Set());
  const [processActionBusy, setProcessActionBusy] = useState(false);
  const [chatContexts, setChatContexts] = useState([]);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextPickerTab, setContextPickerTab] = useState('files');
  const [contextSearch, setContextSearch] = useState('');
  const [contextOptions, setContextOptions] = useState({ files: [], spec: [], tasks: [] });
  const [contextOptionsLoading, setContextOptionsLoading] = useState(false);
  const [openActionMessageId, setOpenActionMessageId] = useState(null);
  const [specActionModal, setSpecActionModal] = useState({ open: false, message: null, sectionKey: 'ux_notes' });
  const [pinnedMap, setPinnedMap] = useState({});
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatNotice, setChatNotice] = useState('');
  const [statusPanelOpen, setStatusPanelOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('ai-office-status-panel-open');
      if (saved === null) return true;
      return saved !== 'false';
    } catch {
      return true;
    }
  });
  const bottomRef = useRef(null);
  const messageListRef = useRef(null);
  const statusInterval = useRef(null);
  const lastQueuedMessageIdRef = useRef(null);
  const nearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const draftScope = useMemo(
    () => ({
      project: activeProject?.project || 'ai-office',
      channel,
      mode: workspaceMode === 'discuss-draft' ? 'discuss' : workspaceMode,
    }),
    [activeProject?.project, channel, workspaceMode]
  );
  const pinsKey = useMemo(
    () => pinStorageKey(activeProject?.project || 'ai-office', channel),
    [activeProject?.project, channel]
  );
  const { setDiscussMessageCount } = useBeginnerMode();
  const isDiscussMode = workspaceMode === 'discuss' || workspaceMode === 'discuss-draft';

  useBodyScrollLock(
    Boolean(contextPickerOpen || specActionModal.open || activeApproval),
    contextPickerOpen
      ? 'chat-context-picker'
      : specActionModal.open
        ? 'chat-spec-insert-modal'
        : activeApproval
          ? 'chat-approval-modal'
          : 'chat'
  );

  useEffect(() => {
    const text = String(prefillText || '');
    if (!text.trim()) return;
    setInput(text);
    onPrefillConsumed?.();
  }, [prefillText, onPrefillConsumed]);

  useEffect(() => {
    const queuedId = queuedMessage?.id;
    const text = String(queuedMessage?.text || '').trim();
    if (!queuedId || !text) return;
    if (lastQueuedMessageIdRef.current === queuedId) return;
    lastQueuedMessageIdRef.current = queuedId;
    send(text, 'message', null);
  }, [queuedMessage?.id, queuedMessage?.text, send]);

  useEffect(() => {
    if (String(prefillText || '').trim()) return;
    const draft = loadChatDraft(draftScope);
    setInput(String(draft?.text || ''));
    setChatContexts(Array.isArray(draft?.contexts) ? draft.contexts.map(normalizeContext).filter(Boolean) : []);
  }, [draftScope, prefillText]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveChatDraft(draftScope, { text: input, contexts: chatContexts });
    }, 250);
    return () => clearTimeout(timer);
  }, [draftScope, input, chatContexts]);

  useEffect(() => {
    if (!isDiscussMode) return;
    setDiscussMessageCount(activeProject?.project || 'ai-office', messages.length);
  }, [isDiscussMode, activeProject?.project, messages.length, setDiscussMessageCount]);

  useEffect(() => {
    const pins = safeReadJson(pinsKey, {});
    setPinnedMap(pins && typeof pins === 'object' ? pins : {});
  }, [pinsKey]);

  useEffect(() => {
    try {
      localStorage.setItem('ai-office-status-panel-open', statusPanelOpen ? 'true' : 'false');
    } catch {
      // ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [statusPanelOpen]);

  useEffect(() => {
    if (!showStatusPanel) {
      setStatusPanelOpen(false);
    }
  }, [showStatusPanel]);
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
    setApprovalQueue([]);
    setActiveApproval(null);
    setApprovalListOpen(false);
    setDismissedApprovals(new Set());
    setContextPickerOpen(false);
    setContextSearch('');
    setOpenActionMessageId(null);
    setSpecActionModal({ open: false, message: null, sectionKey: 'ux_notes' });
    setShowJumpToLatest(false);
    setUnreadCount(0);
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
        .then((project) => {
          setActiveProject(project);
          const projectName = project?.project || 'ai-office';
          return fetch(`/api/projects/${projectName}/autonomy-mode`)
            .then(resp => (resp.ok ? resp.json() : { mode: 'SAFE' }))
            .then((modePayload) => {
              setAutonomyMode(modePayload?.mode || 'SAFE');
            });
        })
        .catch(() => {
          setAutonomyMode('SAFE');
          setActiveProject({ project: 'ai-office', path: '', branch: 'main' });
        });
      fetch(`/api/work/status/${channel}`)
        .then(r => r.json())
        .then(setWorkStatus)
        .catch(() => {});
      fetch(`/api/process/list/${channel}`)
        .then(r => (r.ok ? r.json() : { processes: [] }))
        .then((data) => {
          const items = Array.isArray(data?.processes) ? data.processes : [];
          const running = items.filter((item) => item.status === 'running').length;
          setProcessState({ total: items.length, running, items });
        })
        .catch(() => setProcessState({ total: 0, running: 0, items: [] }));
      fetch(`/api/permissions?channel=${encodeURIComponent(channel)}`)
        .then(r => (r.ok ? r.json() : { mode: 'ask', expires_at: null }))
        .then(setPermissionPolicy)
        .catch(() => setPermissionPolicy({ mode: 'ask', expires_at: null }));
    };
    poll();
    statusInterval.current = setInterval(poll, 2000);
    return () => clearInterval(statusInterval.current);
  }, [channel]);

  // Reload pending approvals on channel load and websocket reconnect (in case events were missed).
  useEffect(() => {
    if (!connected) return;
    const projectName = activeProject?.project || 'ai-office';
    fetch(`/api/approvals/pending?channel=${encodeURIComponent(channel)}&project=${encodeURIComponent(projectName)}`)
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((payload) => {
        const items = Array.isArray(payload?.requests) ? payload.requests : [];
        items.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        setApprovalQueue(items);
      })
      .catch(() => {});
  }, [channel, connected, activeProject?.project]);

  // Load spec status when channel/project changes (avoid polling full spec content every tick).
  useEffect(() => {
    fetch(`/api/spec/current?channel=${encodeURIComponent(channel)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!payload?.ok) return;
        setSpecState({
          project: payload.project || activeProject?.project || 'ai-office',
          status: payload.status || 'none',
          spec_version: payload.spec_version || null,
        });
      })
      .catch(() => {});
  }, [channel, activeProject?.project]);

  const scrollToLatest = (behavior = 'smooth') => {
    const list = messageListRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    setUnreadCount(0);
  };

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const nextCount = messages.length;
    const prevCount = prevMessageCountRef.current;
    const appended = nextCount > prevCount;
    prevMessageCountRef.current = nextCount;

    if (!appended && typingAgents.length === 0) return;

    if (nearBottomRef.current) {
      const behavior = prevCount === 0 ? 'auto' : 'smooth';
      scrollToLatest(behavior);
    } else if (appended) {
      setShowJumpToLatest(true);
      setUnreadCount((value) => value + (nextCount - prevCount));
    }
  }, [messages, typingAgents]);

  useEffect(() => {
    const interval = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const closeTransientUi = useCallback(() => {
    if (specActionModal.open) {
      setSpecActionModal({ open: false, message: null, sectionKey: 'ux_notes' });
      return true;
    }
    if (contextPickerOpen) {
      setContextPickerOpen(false);
      return true;
    }
    if (openActionMessageId) {
      setOpenActionMessageId(null);
      return true;
    }
    if (activeApproval) {
      setDismissedApprovals((prev) => {
        const next = new Set(prev);
        if (activeApproval.id) next.add(activeApproval.id);
        return next;
      });
      setActiveApproval(null);
      return true;
    }
    if (approvalListOpen) {
      setApprovalListOpen(false);
      return true;
    }
    if (threadRootId) {
      setThreadRootId(null);
      return true;
    }
    return false;
  }, [
    activeApproval,
    approvalListOpen,
    contextPickerOpen,
    openActionMessageId,
    specActionModal.open,
    threadRootId,
  ]);

  useEscapeKey((event) => {
    const handled = closeTransientUi();
    if (handled) {
      event.preventDefault();
    }
  }, true);

  useEffect(() => {
    const onGlobalEscape = (event) => {
      const handled = closeTransientUi();
      if (handled && event?.detail) {
        event.detail.handled = true;
      }
    };
    const onResetUi = () => {
      setApprovalQueue([]);
      setActiveApproval(null);
      setApprovalListOpen(false);
      setContextPickerOpen(false);
      setSpecActionModal({ open: false, message: null, sectionKey: 'ux_notes' });
      setThreadRootId(null);
      setOpenActionMessageId(null);
      setDismissedApprovals(new Set());
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [closeTransientUi]);

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
      const projectName = lastEvent.active?.project || 'ai-office';
      fetch(`/api/projects/${projectName}/autonomy-mode`)
        .then(r => (r.ok ? r.json() : { mode: 'SAFE' }))
        .then((payload) => setAutonomyMode(payload?.mode || 'SAFE'))
        .catch(() => setAutonomyMode('SAFE'));
    }
    if (lastEvent.type === 'kill_switch') {
      setAutonomyMode(lastEvent.autonomy_mode || 'SAFE');
      setPermissionPolicy((prev) => ({
        ...prev,
        mode: lastEvent.permission_mode || 'ask',
        expires_at: null,
      }));
    }
    if (lastEvent.type === 'approval_request' && lastEvent.request?.id) {
      setDismissedApprovals((prev) => {
        const next = new Set(prev);
        next.delete(lastEvent.request.id);
        return next;
      });
      setApprovalQueue(prev => {
        if (prev.some(item => item.id === lastEvent.request.id)) return prev;
        return [...prev, lastEvent.request];
      });
    }
    if (lastEvent.type === 'approval_resolved' && lastEvent.request_id) {
      setApprovalQueue(prev => prev.filter(item => item.id !== lastEvent.request_id));
      setActiveApproval(prev => (prev?.id === lastEvent.request_id ? null : prev));
    }
    if (lastEvent.type === 'approval_expired' && lastEvent.request_id) {
      setApprovalQueue(prev => prev.filter(item => item.id !== lastEvent.request_id));
      setActiveApproval(prev => (prev?.id === lastEvent.request_id ? null : prev));
    }
  }, [lastEvent]);

  useEffect(() => {
    if (activeApproval?.id && approvalQueue.some(item => item.id === activeApproval.id)) return;
    if (approvalQueue.length === 0) {
      setActiveApproval(null);
      return;
    }
    const nextItem = approvalQueue.find((item) => !dismissedApprovals.has(item.id));
    setActiveApproval(nextItem || null);
  }, [approvalQueue, activeApproval, dismissedApprovals]);

  useEffect(() => {
    if (!openActionMessageId) return undefined;
    const onMouseDown = (event) => {
      const inside = event.target?.closest?.('.msg-actions-menu');
      if (!inside) setOpenActionMessageId(null);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [openActionMessageId]);

  useEffect(() => {
    if (!chatNotice) return undefined;
    const timer = setTimeout(() => setChatNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [chatNotice]);

  const fetchContextOptions = useCallback(async () => {
    setContextOptionsLoading(true);
    try {
      const projectName = activeProject?.project || 'ai-office';
      const [filesResp, specResp, tasksResp] = await Promise.all([
        fetch(`/api/files/tree?channel=${encodeURIComponent(channel)}&path=.`),
        fetch(`/api/spec/current?channel=${encodeURIComponent(channel)}`),
        fetch(`/api/tasks?channel=${encodeURIComponent(channel)}&project_name=${encodeURIComponent(projectName)}`),
      ]);

      const filesPayload = filesResp.ok ? await filesResp.json() : [];
      const specPayload = specResp.ok ? await specResp.json() : {};
      const tasksPayload = tasksResp.ok ? await tasksResp.json() : [];

      const files = (Array.isArray(filesPayload) ? filesPayload : [])
        .filter((item) => item?.type === 'file' && item?.path)
        .slice(0, 120)
        .map((item) => ({
          id: `file:${item.path}`,
          type: 'file',
          label: item.path,
          value: item.path,
        }));

      const specSections = (() => {
        const specMd = String(specPayload?.spec_md || '');
        const headings = specMd
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('## '))
          .map((line, index) => ({
            id: `spec:${index}:${line.replace(/^##\s+/, '')}`,
            type: 'spec',
            label: line.replace(/^##\s+/, ''),
            value: line.replace(/^##\s+/, ''),
          }));
        if (headings.length > 0) return headings.slice(0, 40);
        return SPEC_SECTION_OPTIONS.map((section) => ({
          id: `spec:${section.key}`,
          type: 'spec',
          label: section.label,
          value: section.key,
        }));
      })();

      const tasks = (Array.isArray(tasksPayload) ? tasksPayload : [])
        .slice(0, 120)
        .map((task) => ({
          id: `task:${task.id}`,
          type: 'task',
          label: `${task.title || 'Untitled task'} (#${task.id})`,
          value: String(task.id),
        }));

      setContextOptions({ files, spec: specSections, tasks });
    } catch {
      setContextOptions({ files: [], spec: [], tasks: [] });
    } finally {
      setContextOptionsLoading(false);
    }
  }, [activeProject?.project, channel]);

  useEffect(() => {
    if (!contextPickerOpen) return;
    fetchContextOptions();
  }, [contextPickerOpen, fetchContextOptions]);

  useEffect(() => {
    const onAdd = (event) => {
      const item = normalizeContext(event?.detail);
      if (!item) return;
      setChatContexts((prev) => {
        if (prev.some((entry) => entry.id === item.id)) return prev;
        return [...prev, item];
      });
    };
    window.addEventListener('chat-context:add', onAdd);
    return () => window.removeEventListener('chat-context:add', onAdd);
  }, []);

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

  const formatElapsed = (seconds) => {
    const total = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  };

  const copyMessage = async (msg) => {
    const ok = await copyToClipboard(msg?.content || '');
    if (!ok) return;
    setChatNotice('Message copied.');
  };

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

  const buildOutgoingMessage = (text, files, contexts) => {
    const sections = [];
    if (text) sections.push(text);
    if (Array.isArray(contexts) && contexts.length > 0) {
      const contextLines = contexts.map((ctx) => `- [${ctx.type}] ${ctx.label}${ctx.value ? ` (\`${ctx.value}\`)` : ''}`);
      sections.push(`Context:\n${contextLines.join('\n')}`);
    }
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

  const sendCurrentMessage = () => {
    const text = input.trim();
    if (!text && attachments.length === 0 && chatContexts.length === 0) return;

    const content = buildOutgoingMessage(text, attachments, chatContexts);
    send(content, 'message', replyTo?.id || null);
    setInput('');
    clearChatDraft(draftScope);
    setReplyTo(null);
    setAttachments([]);
    setUploadError('');
    setOpenActionMessageId(null);
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    setUnreadCount(0);
  };

  const handleSend = (event) => {
    event.preventDefault();
    sendCurrentMessage();
  };

  const stopConversation = () => {
    fetch(`/api/conversation/${channel}/stop`, { method: 'POST' })
      .then(r => r.json())
      .then(() => setConvoStatus(prev => ({ ...prev, active: false })));
  };

  const clearChat = async () => {
    const confirmed = window.confirm('Clear all messages in this channel? This cannot be undone.');
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/channels/${channel}/messages`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || `Clear chat failed (${response.status})`);
      }

      const systemMessage = payload?.system_message || null;
      if (connected && systemMessage) {
        setMessages([]);
      } else {
        setMessages(systemMessage ? [systemMessage] : []);
      }
      setReactionsByMessage({});
      loadedReactionIdsRef.current = new Set(systemMessage?.id ? [systemMessage.id] : []);
      setThreadRootId(null);
      setReplyTo(null);
    } catch (err) {
      window.alert(err?.message || 'Failed to clear chat.');
    }
  };

  const approveSpec = async () => {
    const typed = window.prompt("Type 'APPROVE SPEC' to approve the spec and unlock mutating tools:");
    if (!typed) return;
    try {
      const res = await fetch('/api/spec/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, confirm_text: typed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.error) {
        throw new Error(payload?.detail || payload?.error || 'Failed to approve spec');
      }
      setSpecState((prev) => ({
        ...prev,
        project: payload.project || prev.project,
        status: payload.status || 'approved',
        spec_version: payload.spec_version || prev.spec_version,
      }));
    } catch (err) {
      window.alert(err?.message || 'Failed to approve spec.');
    }
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

  const runKillSwitch = () => {
    const confirmed = window.confirm('Kill switch will stop all running processes in this channel and set autonomy mode to SAFE. Continue?');
    if (!confirmed) return;

    fetch('/api/process/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    })
      .then(r => r.json())
      .then((payload) => {
        setAutonomyMode(payload?.autonomy_mode || 'SAFE');
        setPermissionPolicy((prev) => ({
          ...prev,
          mode: payload?.permission_mode || 'ask',
          expires_at: null,
        }));
        refreshProcesses();
      })
      .catch(() => {});
  };

  const refreshProcesses = () => {
    fetch(`/api/process/list/${channel}`)
      .then(r => (r.ok ? r.json() : { processes: [] }))
      .then((data) => {
        const items = Array.isArray(data?.processes) ? data.processes : [];
        const running = items.filter((item) => item.status === 'running').length;
        setProcessState({ total: items.length, running, items });
      })
      .catch(() => setProcessState({ total: 0, running: 0, items: [] }));
  };

  const stopHeaderProcess = (processId) => {
    if (!processId || processActionBusy) return;
    setProcessActionBusy(true);
    fetch('/api/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, process_id: processId }),
    })
      .then(() => refreshProcesses())
      .finally(() => setProcessActionBusy(false));
  };

  const resolveApproval = async (approved, opts = {}) => {
    if (!activeApproval?.id || approvalBusy) return;
    const { trustSession = false, grant = null } = opts || {};
    setApprovalBusy(true);
    try {
      if (approved && grant?.scope) {
        const grantBody = {
          channel,
          project_name: activeProject?.project || 'ai-office',
          scope: grant.scope,
          grant_level: grant.grant_level || 'chat',
          minutes: Number.isFinite(Number(grant.minutes)) ? Number(grant.minutes) : 10,
          request_id: activeApproval.id,
          created_by: 'user',
        };
        await fetch('/api/permissions/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(grantBody),
        }).catch(() => null);
      } else if (approved && trustSession) {
        const trustResp = await fetch('/api/permissions/trust_session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, minutes: trustMinutes }),
        });
        const trustPayload = await trustResp.json().catch(() => ({}));
        if (trustResp.ok && trustPayload?.mode) {
          setPermissionPolicy(trustPayload);
        }
      }

      await fetch('/api/permissions/approval-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: activeApproval.id,
          approved,
          decided_by: 'user',
        }),
      });
    } finally {
      setApprovalBusy(false);
      setApprovalQueue(prev => prev.filter(item => item.id !== activeApproval.id));
      setDismissedApprovals((prev) => {
        const next = new Set(prev);
        next.delete(activeApproval.id);
        return next;
      });
      setActiveApproval(null);
    }
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

  const addContextItem = (item) => {
    const normalized = normalizeContext(item);
    if (!normalized) return;
    setChatContexts((prev) => {
      if (prev.some((entry) => entry.id === normalized.id || (entry.type === normalized.type && entry.value === normalized.value))) {
        return prev;
      }
      return [...prev, normalized];
    });
    setContextPickerOpen(false);
  };

  const removeContextItem = (id) => {
    setChatContexts((prev) => prev.filter((entry) => entry.id !== id));
  };

  const contextSearchNeedle = contextSearch.trim().toLowerCase();
  const contextListByTab = contextPickerTab === 'spec'
    ? contextOptions.spec
    : contextPickerTab === 'tasks'
      ? contextOptions.tasks
      : contextOptions.files;
  const filteredContextOptions = (Array.isArray(contextListByTab) ? contextListByTab : [])
    .filter((item) => !contextSearchNeedle || String(item.label || '').toLowerCase().includes(contextSearchNeedle))
    .slice(0, 80);

  const togglePinMessage = (message) => {
    if (!message?.id) return;
    setPinnedMap((prev) => {
      const next = { ...prev };
      if (next[message.id]) {
        delete next[message.id];
      } else {
        next[message.id] = {
          id: message.id,
          snippet: summarize(message.content, 120),
          created_at: message.created_at,
        };
      }
      safeWriteJson(pinsKey, next);
      return next;
    });
  };

  const createTaskFromMessage = (message) => {
    if (!message) return;
    const lines = String(message.content || '').split('\n');
    const firstLine = String(lines[0] || '').trim();
    const title = firstLine.slice(0, 90) || 'Task from chat message';
    const description = String(message.content || '').trim();
    window.dispatchEvent(new CustomEvent('taskboard:new-task', {
      detail: { title, description },
    }));
    onRequestOpenTab?.('tasks');
    setChatNotice('Drafted task in Tasks panel.');
  };

  const openSpecInsertForMessage = (message) => {
    setSpecActionModal({
      open: true,
      message,
      sectionKey: specActionModal.sectionKey || 'ux_notes',
    });
  };

  const applySpecInsert = () => {
    const sectionKey = specActionModal.sectionKey || 'ux_notes';
    const content = String(specActionModal?.message?.content || '').trim();
    if (!content) {
      setSpecActionModal({ open: false, message: null, sectionKey });
      return;
    }
    window.dispatchEvent(new CustomEvent('specpanel:insert-draft', {
      detail: {
        sectionKey,
        text: content,
        sourceMessageId: specActionModal?.message?.id || null,
      },
    }));
    onRequestOpenTab?.('spec');
    setSpecActionModal({ open: false, message: null, sectionKey });
    setChatNotice('Added excerpt to Spec draft.');
  };

  const messageDepth = (message) => {
    let depth = 0;
    let current = message;
    let safety = 0;
    while (current?.parent_id && safety < 80) {
      depth += 1;
      current = messageMap.get(current.parent_id);
      safety += 1;
    }
    return depth;
  };

  const channelLabel = channelName
    ? (channel === 'main' ? `# ${channelName}` : channelName)
    : (
      channel === 'main'
        ? '# Main Room'
        : `DM: ${agents[channel.replace('dm:', '')]?.display_name || channel}`
    );

  const isActive = convoStatus?.active;
  const warRoomActive = collabMode?.active && collabMode?.mode === 'warroom';
  const warRoomIssue = collabMode?.issue || collabMode?.topic || 'incident';
  const warRoomElapsed = warRoomActive
    ? formatElapsed(Math.floor(clockMs / 1000) - Number(collabMode?.started_at || 0))
    : '';
  const sprintActive = collabMode?.active && collabMode?.mode === 'sprint';
  const sprintGoal = collabMode?.goal || collabMode?.topic || 'current goal';
  const sprintRemaining = sprintActive
    ? Math.max(0, Number(collabMode?.ends_at || 0) - Math.floor(clockMs / 1000))
    : 0;
  const sprintLabel = `SPRINT - ${formatElapsed(sprintRemaining)} remaining - Goal: ${sprintGoal}`;
  const approvalMode = (permissionPolicy?.ui_mode || (permissionPolicy?.mode || 'ask').toUpperCase()).toUpperCase();
  const approvalExpiry = permissionPolicy?.expires_at ? ` until ${new Date(permissionPolicy.expires_at).toLocaleTimeString()}` : '';
  const specStatus = String(specState?.status || 'none').toUpperCase();
  const specChipClass = String(specState?.status || '').toLowerCase() === 'approved'
    ? 'active'
    : (String(specState?.status || '').toLowerCase() === 'draft' ? 'warn' : '');
  const approvalCountdownSeconds = activeApproval?.expires_at
    ? Math.max(0, Math.floor((new Date(activeApproval.expires_at).getTime() - clockMs) / 1000))
    : null;
  const runningProcesses = processState.items.filter((item) => item.status === 'running');
  const processSummaryTitle = runningProcesses.length
    ? runningProcesses
      .map((item) => `${item.name} (pid ${item.pid || '-'}${item.port ? `, :${item.port}` : ''})`)
      .join('\n')
    : 'No running processes';
  const breadcrumbMode = String(workspaceMode || 'build').replace('-', ' ');

  return (
    <div className={`chat-room ${compact ? 'chat-room-compact' : ''}`}>
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-breadcrumb">
            {activeProject?.project || 'ai-office'} → {breadcrumbMode} → Chat
          </div>
          <h2>{channelLabel}</h2>
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
          <span className="status-text">{connected ? 'Connected' : 'Reconnecting...'}</span>
          <span className="convo-status">
            Project: {activeProject?.project || 'ai-office'} @ {activeProject?.branch || 'main'}
          </span>
          {!compact && (
            <>
              <span className={`convo-status ${collabMode?.active ? 'active' : ''} ${warRoomActive ? 'warroom' : ''} ${sprintActive ? 'sprint' : ''}`}>
                {warRoomActive
                  ? `WAR ROOM — ${warRoomIssue} — ${warRoomElapsed}`
                  : sprintActive
                    ? sprintLabel
                  : `Mode: ${collabMode?.mode || 'chat'}`}
              </span>
              <span className={`convo-status ${specChipClass}`}>
                Spec: {specStatus}
              </span>
              <span className={`convo-status ${autonomyMode === 'SAFE' ? '' : 'active'}`}>
                Autonomy: {autonomyMode}
              </span>
              <span className={`convo-status ${approvalMode === 'AUTO' ? 'active' : ''}`}>
                Approval: {approvalMode}{approvalExpiry}
              </span>
            </>
          )}
          <span
            className={`convo-status ${approvalQueue.length > 0 ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setApprovalListOpen(prev => !prev)}
            title={approvalQueue.length > 0 ? 'Click to view pending approvals' : 'No pending approvals'}
          >
            Pending: {approvalQueue.length}
          </span>
          <span className={`convo-status ${processState.running > 0 ? 'active' : ''}`} title={processSummaryTitle}>
            Processes: {processState.running} running
          </span>
        </div>
        <div className="chat-header-right">
          {typeof onBackToWorkspace === 'function' && (
            <button className="stop-btn" onClick={onBackToWorkspace}>
              Back to Workspace
            </button>
          )}
          {!compact && (
            <>
              <button className="stop-btn" onClick={refreshProcesses}>
                Refresh Proc
              </button>
              <button className="stop-btn" onClick={() => setStatusPanelOpen(prev => !prev)}>
                {statusPanelOpen ? 'Hide Status' : 'Show Status'}
              </button>
              <button className="stop-btn" onClick={runKillSwitch}>
                Kill Switch
              </button>
            </>
          )}
          <button className="stop-btn" onClick={clearChat}>
            Clear Chat
          </button>
          {!compact && String(specState?.status || '').toLowerCase() === 'draft' && (
            <button className="stop-btn" onClick={approveSpec}>
              Approve Spec
            </button>
          )}
          {!compact && isActive && (
            <>
              <span className="convo-status active">
                Active ({convoStatus.message_count} msgs)
              </span>
              <button className="stop-btn" onClick={stopConversation}>
                Stop
              </button>
            </>
          )}
          {!compact && workStatus?.running && (
            <>
              <span className="convo-status active">
                Working... ({workStatus.processed || 0})
              </span>
              <button className="stop-btn" onClick={stopWork}>
                Stop Work
              </button>
            </>
          )}
          {!compact && runningProcesses.slice(0, 2).map((proc) => (
            <button
              key={proc.id}
              className="stop-btn"
              onClick={() => stopHeaderProcess(proc.id)}
              disabled={processActionBusy}
              title={proc.command}
            >
              Stop {proc.name}
            </button>
          ))}
        </div>
      </div>

      {approvalListOpen && approvalQueue.length > 0 && (
        <div className="approval-queue-panel">
          <div className="approval-queue-header">
            <strong>Pending Approvals</strong>
            <button className="msg-action-btn" onClick={() => setApprovalListOpen(false)}>
              Close
            </button>
          </div>
          <div className="approval-queue-body">
            {approvalQueue.map((item) => (
              <button
                key={item.id}
                className="approval-queue-item"
                onClick={() => {
                  setDismissedApprovals((prev) => {
                    const next = new Set(prev);
                    next.delete(item.id);
                    return next;
                  });
                  setActiveApproval(item);
                  setApprovalListOpen(false);
                }}
                disabled={!item?.id}
              >
                <div className="approval-queue-title">
                  <strong>{item.tool_type}</strong> by <strong>{item.agent_id}</strong>
                </div>
                <div className="approval-queue-command">
                  <code>{item.command}</code>
                </div>
                {item.expires_at && (
                  <div className="approval-queue-meta">
                    Expires at {new Date(item.expires_at).toLocaleTimeString()}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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

        <div
          ref={messageListRef}
          className="message-list"
          onScroll={(event) => {
            const nearBottom = isNearBottom(event.currentTarget);
            nearBottomRef.current = nearBottom;
            if (nearBottom) {
              setShowJumpToLatest(false);
              setUnreadCount(0);
            } else if (messages.length > 0) {
              setShowJumpToLatest(true);
            }
          }}
        >
          {messages.length === 0 && (
            <div className={`empty-chat ${beginnerMode && isDiscussMode ? 'beginner-empty-card' : ''}`}>
              {beginnerMode && isDiscussMode ? (
                <>
                  <h4>Kick off project discussion</h4>
                  <p>Ask the room to brainstorm scope, risks, and first implementation steps.</p>
                  <div className="beginner-empty-actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary"
                      onClick={() => {
                        if (typeof onBeginnerBrainstorm === 'function') {
                          onBeginnerBrainstorm();
                          return;
                        }
                        send(
                          'Brainstorm this project idea with tradeoffs, scope options, and the recommended first milestone.',
                          'message',
                          null
                        );
                      }}
                    >
                      Run brainstorm
                    </button>
                  </div>
                </>
              ) : (
                'No messages yet. Say something!'
              )}
            </div>
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
                {getMessageProvenance(msg) ? (
                  <div className="msg-provenance">{getMessageProvenance(msg)}</div>
                ) : null}

                <div className="msg-actions">
                  {hasThread && (
                    <button className="msg-action-btn" onClick={() => openThread(msg)}>
                      {childCounts[msg.id] ? `Thread (${childCounts[msg.id]})` : 'View thread'}
                    </button>
                  )}
                  {pinnedMap[msg.id] ? <span className="ui-chip">Pinned</span> : null}
                  <button className="msg-action-btn" onClick={() => toggleReaction(msg.id, '👍')}>
                    👍
                  </button>
                  <MessageActionsMenu
                    open={openActionMessageId === msg.id}
                    pinned={Boolean(pinnedMap[msg.id])}
                    onToggle={() => setOpenActionMessageId((prev) => (prev === msg.id ? null : msg.id))}
                    onCopy={() => {
                      copyMessage(msg);
                      setOpenActionMessageId(null);
                    }}
                    onReply={() => {
                      startReply(msg);
                      setOpenActionMessageId(null);
                    }}
                    onPinToggle={() => {
                      togglePinMessage(msg);
                      setOpenActionMessageId(null);
                    }}
                    onCreateTask={() => {
                      createTaskFromMessage(msg);
                      setOpenActionMessageId(null);
                    }}
                    onAddToSpec={() => {
                      openSpecInsertForMessage(msg);
                      setOpenActionMessageId(null);
                    }}
                  />
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

        {showJumpToLatest && (
          <button
            type="button"
            className="chat-jump-latest"
            onClick={() => scrollToLatest('smooth')}
          >
            Jump to latest{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        )}

        {showStatusPanel && statusPanelOpen && (
          <StatusPanel channel={channel} onClose={() => setStatusPanelOpen(false)} />
        )}

        {threadRootId && (
          <aside className="thread-panel">
            <div className="thread-header">
              <h3>Thread</h3>
              <button className="thread-close-btn" onClick={() => setThreadRootId(null)}>
                Back to main chat
              </button>
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
                  const depth = messageDepth(msg);
                  return (
                    <div key={msg.id} className="thread-msg" style={{ marginLeft: `${Math.min(depth, 4) * 10}px` }}>
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
        <ContextStrip
          items={chatContexts}
          onRemove={removeContextItem}
          onOpenPicker={() => {
            setContextPickerOpen(true);
            setContextPickerTab('files');
            setContextSearch('');
          }}
        />

        {chatNotice && <div className="agent-config-notice chat-notice">{chatNotice}</div>}

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

        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault();
              sendCurrentMessage();
            }
          }}
          rows={3}
          placeholder={isActive ? 'Jump in - agents are talking...' : `Message ${channelLabel}...`}
        />
        <div className="chat-send-controls">
          <span className="chat-send-hint">Enter for newline · Ctrl+Enter to send</span>
          <button type="submit" disabled={!connected || isUploading}>Send</button>
        </div>
      </form>

      {contextPickerOpen && (
        <div className="approval-modal-backdrop">
          <div className="approval-modal chat-context-modal">
            <h3>Add Context</h3>
            <p>Select references to include with your next message.</p>
            <div className="chat-context-tabs">
              <button
                type="button"
                className={`ui-btn ${contextPickerTab === 'files' ? 'ui-btn-primary' : ''}`}
                onClick={() => setContextPickerTab('files')}
              >
                Files
              </button>
              <button
                type="button"
                className={`ui-btn ${contextPickerTab === 'spec' ? 'ui-btn-primary' : ''}`}
                onClick={() => setContextPickerTab('spec')}
              >
                Spec
              </button>
              <button
                type="button"
                className={`ui-btn ${contextPickerTab === 'tasks' ? 'ui-btn-primary' : ''}`}
                onClick={() => setContextPickerTab('tasks')}
              >
                Tasks
              </button>
            </div>
            <input
              className="ui-input"
              type="text"
              value={contextSearch}
              onChange={(event) => setContextSearch(event.target.value)}
              placeholder="Filter context items..."
            />
            <div className="chat-context-results">
              {contextOptionsLoading ? (
                <div className="panel-empty">Loading context options...</div>
              ) : filteredContextOptions.length === 0 ? (
                <div className="panel-empty">No matching context found.</div>
              ) : (
                filteredContextOptions.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="chat-context-result"
                    onClick={() =>
                      addContextItem({
                        id: makeContextId(item.type, item.value),
                        type: item.type,
                        label: item.label,
                        value: item.value,
                      })
                    }
                  >
                    <span className="ui-chip">{item.type}</span>
                    <span>{item.label}</span>
                  </button>
                ))
              )}
            </div>
            <div className="approval-actions">
              <button type="button" className="msg-action-btn ui-btn" onClick={() => setContextPickerOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {specActionModal.open && (
        <div className="approval-modal-backdrop">
          <div className="approval-modal chat-spec-insert-modal">
            <h3>Add to Spec</h3>
            <p>Select the spec section where this chat excerpt should be inserted.</p>
            <select
              className="ui-input"
              value={specActionModal.sectionKey}
              onChange={(event) =>
                setSpecActionModal((prev) => ({ ...prev, sectionKey: event.target.value }))
              }
            >
              {SPEC_SECTION_OPTIONS.map((section) => (
                <option key={section.key} value={section.key}>
                  {section.label}
                </option>
              ))}
            </select>
            <pre className="approval-preview">{specActionModal?.message?.content || ''}</pre>
            <div className="approval-actions">
              <button
                type="button"
                className="msg-action-btn ui-btn"
                onClick={() => setSpecActionModal({ open: false, message: null, sectionKey: specActionModal.sectionKey || 'ux_notes' })}
              >
                Cancel
              </button>
              <button type="button" className="msg-action-btn ui-btn ui-btn-primary" onClick={applySpecInsert}>
                Add to Spec
              </button>
            </div>
          </div>
        </div>
      )}

      {activeApproval && (
        <div className="approval-modal-backdrop">
          <div className="approval-modal">
            <h3>Tool Approval Required</h3>
            <p><strong>Tool:</strong> {activeApproval.tool_type}</p>
            <p><strong>Agent:</strong> {activeApproval.agent_id}</p>
            <p><strong>Command:</strong> <code>{activeApproval.command}</code></p>
            {activeApproval.expires_at ? (
              <p>
                <strong>Expires:</strong>{' '}
                {approvalCountdownSeconds !== null
                  ? `${formatElapsed(approvalCountdownSeconds)} remaining`
                  : new Date(activeApproval.expires_at).toLocaleTimeString()}
              </p>
            ) : null}
            {activeApproval.missing_scope ? (
              <p><strong>Scope needed:</strong> <code>{activeApproval.missing_scope}</code></p>
            ) : null}
            {activeApproval.preview ? (
              <pre className="approval-preview">{activeApproval.preview}</pre>
            ) : (
              <pre className="approval-preview">{JSON.stringify(activeApproval.args || {}, null, 2)}</pre>
            )}
            <div className="approval-actions">
              <button className="msg-action-btn" onClick={() => resolveApproval(true)} disabled={approvalBusy}>
                Approve Once
              </button>
              {activeApproval.missing_scope ? (
                <>
                  <button
                    className="msg-action-btn"
                    onClick={() => resolveApproval(true, { grant: { scope: activeApproval.missing_scope, grant_level: 'chat', minutes: 10 } })}
                    disabled={approvalBusy}
                  >
                    Grant {activeApproval.missing_scope} 10 min + Approve
                  </button>
                  <button
                    className="msg-action-btn"
                    onClick={() => resolveApproval(true, { grant: { scope: activeApproval.missing_scope, grant_level: 'project' } })}
                    disabled={approvalBusy}
                  >
                    Grant {activeApproval.missing_scope} for Project + Approve
                  </button>
                </>
              ) : (
                <>
                  <div className="approval-controls">
                    <label htmlFor="trust-minutes">AUTO window</label>
                    <select
                      id="trust-minutes"
                      value={trustMinutes}
                      onChange={(e) => setTrustMinutes(Number(e.target.value))}
                      disabled={approvalBusy}
                    >
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>60 min</option>
                      <option value={120}>120 min</option>
                    </select>
                  </div>
                  <button
                    className="msg-action-btn"
                    onClick={() => resolveApproval(true, { trustSession: true })}
                    disabled={approvalBusy}
                  >
                    Enable AUTO + Approve
                  </button>
                </>
              )}
              <button className="stop-btn" onClick={() => resolveApproval(false)} disabled={approvalBusy}>
                Deny
              </button>
              <button
                className="msg-action-btn"
                onClick={() => {
                  setDismissedApprovals((prev) => {
                    const next = new Set(prev);
                    if (activeApproval?.id) next.add(activeApproval.id);
                    return next;
                  });
                  setActiveApproval(null);
                }}
                disabled={approvalBusy}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
