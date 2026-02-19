import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QuickCaptureBar from './tasks/QuickCaptureBar';
import TasksView from './tasks/TasksView';
import TaskDetailsDrawer from './tasks/TaskDetailsDrawer';
import '../styles/tasks.css';

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

const QUICK_TYPES = new Set(['bug', 'feature', 'refactor', 'qa', 'doc', 'idea']);

const DEFAULT_CAPTURE = {
  title: '',
  description: '',
  status: 'backlog',
  assigned_to: '',
  branch: 'main',
  labels: '',
  advanced: false,
};

const DEFAULT_FILTERS = {
  search: '',
  status: 'all',
  label: 'all',
  assigned_to: 'all',
  branch: 'all',
};

function storageKey(type, projectName, channel) {
  const project = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  const room = String(channel || 'main').trim().toLowerCase() || 'main';
  return `ai-office:tasks-v2:${type}:${project}:${room}`;
}

function safeReadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function normalizeSubtasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const title = item.trim();
        if (!title) return null;
        return { title, done: false };
      }
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title || '').trim();
      if (!title) return null;
      return { title, done: Boolean(item.done) };
    })
    .filter(Boolean);
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') return null;
  return {
    ...task,
    status: String(task.status || 'backlog').trim() || 'backlog',
    branch: String(task.branch || 'main').trim() || 'main',
    priority: Math.max(1, Math.min(3, Number(task.priority) || 2)),
    subtasks: normalizeSubtasks(task.subtasks),
    linked_files: Array.isArray(task.linked_files) ? task.linked_files.filter(Boolean) : [],
    depends_on: Array.isArray(task.depends_on)
      ? task.depends_on.map((value) => Number(value)).filter(Number.isFinite)
      : [],
  };
}

function normalizeFilters(rawFilters) {
  const raw = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  return {
    ...DEFAULT_FILTERS,
    search: String(raw.search || ''),
    status: String(raw.status || 'all'),
    label: String(raw.label || 'all'),
    assigned_to: String(raw.assigned_to || 'all'),
    branch: String(raw.branch || 'all'),
  };
}

function parseQuickType(rawTitle) {
  const text = String(rawTitle || '').trim();
  const match = text.match(/^\/([a-zA-Z]+)\b/);
  if (!match) return { type: '', title: text };
  const command = match[1].toLowerCase();
  if (!QUICK_TYPES.has(command)) return { type: '', title: text };
  const stripped = text.slice(match[0].length).trim();
  return { type: command, title: stripped };
}

function mergeUnique(values) {
  return Array.from(new Set((values || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function taskSortValue(task) {
  const date = new Date(task?.updated_at || task?.created_at || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isRecentlyCreated(task) {
  const created = new Date(task?.created_at || 0).getTime();
  if (!Number.isFinite(created) || created <= 0) return false;
  const ageMs = Date.now() - created;
  return ageMs <= 24 * 60 * 60 * 1000;
}

function isNeedsTriage(task) {
  const unassigned = !String(task?.assigned_to || '').trim();
  const status = String(task?.status || 'backlog').trim();
  const lightDetails = !String(task?.description || '').trim();
  return status === 'backlog' || unassigned || lightDetails;
}

export default function TaskBoard({ channel = 'main', beginnerMode = false }) {
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState({});
  const [activeProject, setActiveProject] = useState('ai-office');
  const [activeBranch, setActiveBranch] = useState('main');
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [viewMode, setViewMode] = useState('inbox');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [capture, setCapture] = useState(DEFAULT_CAPTURE);
  const [localMeta, setLocalMeta] = useState({});
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedDraft, setSelectedDraft] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');

  const lastSelectionIndexRef = useRef(-1);

  const viewModeKey = useMemo(() => storageKey('view', activeProject, channel), [activeProject, channel]);
  const filtersKey = useMemo(() => storageKey('filters', activeProject, channel), [activeProject, channel]);
  const localMetaKey = useMemo(() => storageKey('meta', activeProject, channel), [activeProject, channel]);

  const load = useCallback(async () => {
    const scopedProject = (activeProject || 'ai-office').trim() || 'ai-office';
    const tasksUrl = showAllProjects
      ? `/api/tasks?channel=${encodeURIComponent(channel)}`
      : `/api/tasks?channel=${encodeURIComponent(channel)}&project_name=${encodeURIComponent(scopedProject)}`;

    try {
      const [taskResp, agentResp] = await Promise.all([fetch(tasksUrl), fetch('/api/agents')]);
      const taskPayload = taskResp.ok ? await taskResp.json() : [];
      const agentPayload = agentResp.ok ? await agentResp.json() : [];

      const normalizedTasks = Array.isArray(taskPayload)
        ? taskPayload.map(normalizeTask).filter(Boolean)
        : [];
      setTasks(normalizedTasks);

      const nextAgents = {};
      (Array.isArray(agentPayload) ? agentPayload : []).forEach((agent) => {
        if (agent?.id) nextAgents[agent.id] = agent;
      });
      setAgents(nextAgents);
    } catch {
      // keep existing state on fetch failure
    }
  }, [activeProject, channel, showAllProjects]);

  useEffect(() => {
    const initial = setTimeout(() => {
      load();
    }, 0);
    const interval = setInterval(load, 6000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [load]);

  useEffect(() => {
    fetch(`/api/projects/active/${channel}`)
      .then((response) => response.json())
      .then((data) => {
        const project = String(data?.project || 'ai-office').trim() || 'ai-office';
        const branch = String(data?.branch || 'main').trim() || 'main';
        setActiveProject(project);
        setActiveBranch(branch);
        setCapture((prev) => ({ ...prev, branch }));
      })
      .catch(() => {
        setActiveProject('ai-office');
        setActiveBranch('main');
      });
  }, [channel]);

  useEffect(() => {
    const onNewTask = (event) => {
      const detail = event?.detail || {};
      const title = String(detail.title || '').trim();
      const description = String(detail.description || '').trim();
      setCapture((prev) => ({
        ...prev,
        title,
        description,
        advanced: true,
        branch: activeBranch || 'main',
      }));
    };
    window.addEventListener('taskboard:new-task', onNewTask);
    return () => window.removeEventListener('taskboard:new-task', onNewTask);
  }, [activeBranch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const rawMode = localStorage.getItem(viewModeKey);
      if (rawMode === 'board' || rawMode === 'list' || rawMode === 'inbox') {
        setViewMode(rawMode);
      } else {
        setViewMode('inbox');
      }
      const storedFilters = safeReadJSON(filtersKey, DEFAULT_FILTERS);
      setFilters(normalizeFilters(storedFilters));
      setShowAllProjects(Boolean(storedFilters?._showAllProjects));
      setLocalMeta(safeReadJSON(localMetaKey, {}));
      setSelectedIds(new Set());
      setBulkStatus('');
      setBulkAssignee('');
    }, 0);
    return () => clearTimeout(timer);
  }, [viewModeKey, filtersKey, localMetaKey]);

  useEffect(() => {
    localStorage.setItem(viewModeKey, viewMode);
  }, [viewMode, viewModeKey]);

  useEffect(() => {
    safeWriteJSON(filtersKey, { ...filters, _showAllProjects: showAllProjects });
  }, [filters, filtersKey, showAllProjects]);

  useEffect(() => {
    safeWriteJSON(localMetaKey, localMeta);
  }, [localMeta, localMetaKey]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    const onGlobalEscape = (event) => {
      if (!drawerOpen) return;
      setDrawerOpen(false);
      if (event?.detail) event.detail.handled = true;
    };
    const onResetUi = () => {
      setDrawerOpen(false);
      setSelectedTaskId(null);
      setSelectedDraft(null);
      setSelectedIds(new Set());
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [drawerOpen]);

  const branchOptions = useMemo(() => {
    const values = new Set(['main']);
    tasks.forEach((task) => values.add(task.branch || 'main'));
    if (activeBranch) values.add(activeBranch);
    return Array.from(values).sort();
  }, [tasks, activeBranch]);

  const availableLabels = useMemo(() => {
    const labelValues = [];
    tasks.forEach((task) => {
      if (Array.isArray(task.labels)) {
        labelValues.push(...task.labels);
      }
      const meta = localMeta?.[task.id];
      if (meta?.type) labelValues.push(meta.type);
      if (Array.isArray(meta?.labels)) labelValues.push(...meta.labels);
    });
    return mergeUnique(labelValues).sort((a, b) => a.localeCompare(b));
  }, [tasks, localMeta]);

  const getTaskLabels = useCallback(
    (task) => {
      const fromTask = Array.isArray(task?.labels) ? task.labels : [];
      const meta = localMeta?.[task?.id];
      const fromMeta = Array.isArray(meta?.labels) ? meta.labels : [];
      const typeLabel = meta?.type ? [meta.type] : [];
      return mergeUnique([...fromTask, ...fromMeta, ...typeLabel]);
    },
    [localMeta]
  );

  const getTaskNotes = useCallback(
    (taskId) => String(localMeta?.[taskId]?.notes || ''),
    [localMeta]
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const search = filters.search.trim().toLowerCase();
      if (search) {
        const labels = getTaskLabels(task).join(' ').toLowerCase();
        const blob = `${task.title || ''} ${task.description || ''} ${labels}`.toLowerCase();
        if (!blob.includes(search)) return false;
      }

      if (filters.status !== 'all' && task.status !== filters.status) return false;
      if (filters.assigned_to !== 'all') {
        if (filters.assigned_to === 'unassigned') {
          if (task.assigned_to) return false;
        } else if (task.assigned_to !== filters.assigned_to) {
          return false;
        }
      }
      if (filters.branch !== 'all' && task.branch !== filters.branch) return false;
      if (filters.label !== 'all' && !getTaskLabels(task).includes(filters.label)) return false;
      return true;
    });
  }, [tasks, filters, getTaskLabels]);

  const orderedInboxTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => taskSortValue(b) - taskSortValue(a));
  }, [filteredTasks]);

  const groups = useMemo(() => {
    const seen = new Set();
    const newItems = [];
    const triageItems = [];
    const recentItems = [];

    orderedInboxTasks.forEach((task) => {
      if (!seen.has(task.id) && isRecentlyCreated(task)) {
        seen.add(task.id);
        newItems.push(task);
      }
    });
    orderedInboxTasks.forEach((task) => {
      if (!seen.has(task.id) && isNeedsTriage(task)) {
        seen.add(task.id);
        triageItems.push(task);
      }
    });
    orderedInboxTasks.forEach((task) => {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        recentItems.push(task);
      }
    });

    return { newItems, triageItems, recentItems };
  }, [orderedInboxTasks]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  useEffect(() => {
    if (!selectedTask?.id) return;
    window.dispatchEvent(new CustomEvent('chat-context:add', {
      detail: {
        id: `task:${selectedTask.id}`,
        type: 'task',
        label: `${selectedTask.title || 'Task'} (#${selectedTask.id})`,
        value: String(selectedTask.id),
      },
    }));
  }, [selectedTask?.id, selectedTask?.title]);

  const selectedCount = selectedIds.size;

  const activeFilterCount = useMemo(() => {
    let total = 0;
    if (filters.search.trim()) total += 1;
    if (filters.status !== 'all') total += 1;
    if (filters.label !== 'all') total += 1;
    if (filters.assigned_to !== 'all') total += 1;
    if (filters.branch !== 'all') total += 1;
    if (showAllProjects) total += 1;
    return total;
  }, [filters, showAllProjects]);

  const clearFilters = () => {
    setShowAllProjects(false);
    setFilters(DEFAULT_FILTERS);
  };

  const showBeginnerEmpty = beginnerMode && filteredTasks.length === 0;

  const setTaskMeta = (taskId, patch) => {
    if (!taskId) return;
    setLocalMeta((prev) => {
      const current = prev?.[taskId] || {};
      const nextEntry = { ...current, ...patch };
      return { ...prev, [taskId]: nextEntry };
    });
  };

  const updateTaskStatus = async (taskId, status) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) return;
      const updated = normalizeTask(await response.json());
      if (!updated) return;
      setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      setSelectedDraft((prev) => (prev?.id === updated.id ? { ...prev, status: updated.status } : prev));
    } catch {
      // ignore task update failures
    }
  };

  const updateTaskRecord = async (taskId, patch) => {
    const current = tasks.find((task) => task.id === taskId);
    if (!current) return;
    const merged = normalizeTask({ ...current, ...patch });
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(merged.title || '').trim(),
          description: String(merged.description || '').trim(),
          status: merged.status || 'backlog',
          assigned_to: merged.assigned_to || null,
          branch: String(merged.branch || 'main').trim() || 'main',
          priority: Number(merged.priority) || 2,
          subtasks: normalizeSubtasks(merged.subtasks),
          linked_files: Array.isArray(merged.linked_files) ? merged.linked_files : [],
          depends_on: Array.isArray(merged.depends_on) ? merged.depends_on : [],
        }),
      });
      if (!response.ok) return;
      const updated = normalizeTask(await response.json());
      if (!updated) return;
      setTasks((prev) => prev.map((task) => (task.id === updated.id ? updated : task)));
      setSelectedDraft((prev) => (prev?.id === updated.id ? { ...updated } : prev));
    } catch {
      // ignore task update failures
    }
  };

  const openTask = (taskId) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    setSelectedTaskId(taskId);
    setSelectedDraft({ ...task });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const saveDraftTask = async () => {
    if (!selectedDraft?.id) return;
    await updateTaskRecord(selectedDraft.id, selectedDraft);
  };

  const deleteTask = async () => {
    if (!selectedDraft?.id) return;
    try {
      await fetch(`/api/tasks/${selectedDraft.id}`, { method: 'DELETE' });
      setTasks((prev) => prev.filter((task) => task.id !== selectedDraft.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedDraft.id);
        return next;
      });
      setDrawerOpen(false);
      setSelectedTaskId(null);
      setSelectedDraft(null);
    } catch {
      // ignore task deletion failures
    }
  };

  const handleCaptureField = (key, value) => {
    setCapture((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCaptureAdvanced = () => {
    setCapture((prev) => ({ ...prev, advanced: !prev.advanced }));
  };

  const createTask = async () => {
    const { type, title } = parseQuickType(capture.title);
    if (!title) return;
    const uiLabels = mergeUnique([
      ...String(capture.labels || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      type,
    ]);

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: String(capture.description || '').trim(),
          status: capture.status || 'backlog',
          assigned_to: capture.assigned_to || null,
          channel,
          project_name: (activeProject || 'ai-office').trim() || 'ai-office',
          branch: (capture.branch || activeBranch || 'main').trim() || 'main',
        }),
      });
      if (!response.ok) return;
      const created = normalizeTask(await response.json());
      if (created) {
        setTasks((prev) => [created, ...prev]);
        if (uiLabels.length > 0) {
          setTaskMeta(created.id, {
            labels: mergeUnique(uiLabels),
            type,
          });
        }
      } else {
        load();
      }
      setCapture({
        ...DEFAULT_CAPTURE,
        branch: activeBranch || 'main',
      });
      setViewMode('inbox');
    } catch {
      // ignore task creation failures
    }
  };

  const onToggleSelect = (taskId, index, withShift, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const source = orderedInboxTasks;

      if (withShift && lastSelectionIndexRef.current >= 0 && source.length > 0) {
        const start = Math.min(lastSelectionIndexRef.current, index);
        const end = Math.max(lastSelectionIndexRef.current, index);
        const shouldSelect = checked !== false;
        for (let cursor = start; cursor <= end; cursor += 1) {
          const current = source[cursor];
          if (!current) continue;
          if (shouldSelect) {
            next.add(current.id);
          } else {
            next.delete(current.id);
          }
        }
      } else if (checked === true) {
        next.add(taskId);
      } else if (checked === false) {
        next.delete(taskId);
      } else if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }

      return next;
    });
    lastSelectionIndexRef.current = index;
  };

  const applyBulkStatus = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    await Promise.all(Array.from(selectedIds).map((taskId) => updateTaskStatus(taskId, bulkStatus)));
    setBulkStatus('');
  };

  const applyBulkAssignee = async () => {
    if (!bulkAssignee || selectedIds.size === 0) return;
    const value = bulkAssignee === '__unassigned__' ? '' : bulkAssignee;
    await Promise.all(Array.from(selectedIds).map((taskId) => updateTaskRecord(taskId, { assigned_to: value || null })));
    setBulkAssignee('');
  };

  const addLabelToTask = (taskId) => {
    const value = window.prompt('Add label');
    const label = String(value || '').trim();
    if (!label) return;
    const existing = localMeta?.[taskId]?.labels || [];
    setTaskMeta(taskId, { labels: mergeUnique([...existing, label]) });
  };

  const removeLabelFromTask = (taskId, label) => {
    const existing = localMeta?.[taskId]?.labels || [];
    const nextPatch = { labels: existing.filter((item) => item !== label) };
    if (localMeta?.[taskId]?.type === label) {
      nextPatch.type = '';
    }
    setTaskMeta(taskId, nextPatch);
  };

  const addBulkLabel = () => {
    if (selectedIds.size === 0) return;
    const value = window.prompt('Add label to selected tasks');
    const label = String(value || '').trim();
    if (!label) return;
    setLocalMeta((prev) => {
      const next = { ...prev };
      Array.from(selectedIds).forEach((taskId) => {
        const existing = Array.isArray(next?.[taskId]?.labels) ? next[taskId].labels : [];
        next[taskId] = {
          ...(next[taskId] || {}),
          labels: mergeUnique([...existing, label]),
        };
      });
      return next;
    });
  };

  const triageSuggestion = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const selectedTasks = orderedInboxTasks.filter((task) => selectedIds.has(task.id));
    if (selectedTasks.length === 0) return null;
    const titles = selectedTasks.map((task) => String(task.title || '').toLowerCase());
    const needsBug = titles.some((title) => title.includes('bug') || title.includes('fix') || title.includes('error'));
    const suggestion = {
      status: needsBug ? 'in_progress' : 'backlog',
      label: needsBug ? 'bug' : 'feature',
      owner: selectedTasks.some((task) => !task.assigned_to) ? 'pam' : '',
    };
    return suggestion;
  }, [orderedInboxTasks, selectedIds]);

  const applySuggestion = async () => {
    if (!triageSuggestion || selectedIds.size === 0) return;
    if (triageSuggestion.status) {
      await Promise.all(Array.from(selectedIds).map((taskId) => updateTaskStatus(taskId, triageSuggestion.status)));
    }
    if (triageSuggestion.owner) {
      await Promise.all(Array.from(selectedIds).map((taskId) => updateTaskRecord(taskId, { assigned_to: triageSuggestion.owner })));
    }
    if (triageSuggestion.label) {
      setLocalMeta((prev) => {
        const next = { ...prev };
        Array.from(selectedIds).forEach((taskId) => {
          const existing = Array.isArray(next?.[taskId]?.labels) ? next[taskId].labels : [];
          next[taskId] = {
            ...(next[taskId] || {}),
            labels: mergeUnique([...existing, triageSuggestion.label]),
          };
        });
        return next;
      });
    }
  };

  return (
    <section className="panel task-board tasks-v2-shell">
      <header className="panel-header tasks-v2-header">
        <div className="tasks-v2-header-copy">
          <h3>Tasks</h3>
          <p>
            Project: <strong>{activeProject}</strong> · Channel: <strong>{channel}</strong>
          </p>
        </div>

        <div className="tasks-v2-header-actions">
          <div className="tasks-v2-view-toggle" role="tablist" aria-label="Task views">
            <button
              type="button"
              className={`ui-btn ${viewMode === 'inbox' ? 'ui-btn-primary' : ''}`}
              onClick={() => setViewMode('inbox')}
            >
              Inbox
            </button>
            <button
              type="button"
              className={`ui-btn ${viewMode === 'board' ? 'ui-btn-primary' : ''}`}
              onClick={() => setViewMode('board')}
            >
              Board
            </button>
            <button
              type="button"
              className={`ui-btn ${viewMode === 'list' ? 'ui-btn-primary' : ''}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          <button type="button" className="ui-btn" onClick={load}>
            Refresh
          </button>
        </div>
      </header>

      <QuickCaptureBar
        capture={capture}
        onChangeField={handleCaptureField}
        onToggleAdvanced={toggleCaptureAdvanced}
        onSubmit={createTask}
        agents={agents}
        branchOptions={branchOptions}
        statusOptions={STATUS_OPTIONS}
      />

      <section className="tasks-v2-filterbar">
        <div className="tasks-v2-filter-grid">
          <label className="tasks-v2-filter-chip">
            <span>Search</span>
            <input
              type="text"
              value={filters.search}
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Search title, description, labels…"
            />
          </label>

          <label className="tasks-v2-filter-chip">
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label className="tasks-v2-filter-chip">
            <span>Label</span>
            <select
              value={filters.label}
              onChange={(event) => setFilters((prev) => ({ ...prev, label: event.target.value }))}
            >
              <option value="all">All labels</option>
              {availableLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="tasks-v2-filter-chip">
            <span>Assignee</span>
            <select
              value={filters.assigned_to}
              onChange={(event) => setFilters((prev) => ({ ...prev, assigned_to: event.target.value }))}
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {Object.values(agents)
                .filter((agent) => agent.id !== 'router')
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </option>
                ))}
            </select>
          </label>

          <label className="tasks-v2-filter-chip">
            <span>Branch</span>
            <select
              value={filters.branch}
              onChange={(event) => setFilters((prev) => ({ ...prev, branch: event.target.value }))}
            >
              <option value="all">All branches</option>
              {branchOptions.map((branchOption) => (
                <option key={branchOption} value={branchOption}>
                  {branchOption}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="tasks-v2-filter-actions">
          <button
            type="button"
            className={`ui-btn ${showAllProjects ? 'ui-btn-primary' : ''}`}
            onClick={() => setShowAllProjects((prev) => !prev)}
          >
            {showAllProjects ? 'Showing all projects' : 'This project only'}
          </button>
          <button type="button" className="ui-btn" onClick={clearFilters}>
            Clear filters
          </button>
          <span className="tasks-v2-filter-count">{activeFilterCount} active</span>
        </div>
      </section>

      {viewMode === 'inbox' && triageSuggestion ? (
        <section className="tasks-v2-triage-suggestions">
          <div>
            <h4>Triage Suggestions</h4>
            <p>
              Suggested status: <strong>{triageSuggestion.status.replace('_', ' ')}</strong>
              {' '}· label: <strong>{triageSuggestion.label}</strong>
              {' '}· owner: <strong>{triageSuggestion.owner || 'keep current'}</strong>
            </p>
          </div>
          <button type="button" className="ui-btn" onClick={applySuggestion}>
            Apply suggestions
          </button>
        </section>
      ) : null}

      <div className={`tasks-v2-content ${drawerOpen ? 'with-drawer' : ''}`}>
        <div className="tasks-v2-main">
          {showBeginnerEmpty ? (
            <div className="beginner-empty-card">
              <h4>Capture your first tasks</h4>
              <p>Use Quick Capture for one starter task, then generate more from the spec when ready.</p>
              <div className="beginner-empty-actions">
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  onClick={() => {
                    setCapture((prev) => ({
                      ...prev,
                      title: prev.title || 'Define MVP scope',
                      description: prev.description || 'List must-have features and acceptance criteria.',
                      advanced: true,
                    }));
                  }}
                >
                  Add starter task
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => window.dispatchEvent(new CustomEvent('workspace:open-tab', { detail: { tab: 'spec' } }))}
                >
                  Open spec
                </button>
              </div>
            </div>
          ) : null}

          <TasksView
            viewMode={viewMode}
            groups={groups}
            filteredTasks={filteredTasks}
            orderedInboxTasks={orderedInboxTasks}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onOpenTask={openTask}
            getTaskLabels={getTaskLabels}
            agents={agents}
            onSetStatus={updateTaskStatus}
            onSetAssignee={(taskId, assignee) => updateTaskRecord(taskId, { assigned_to: assignee || null })}
            onAddLabel={addLabelToTask}
            onConvertToBoard={() => setViewMode('board')}
            selectedCount={selectedCount}
            bulkStatus={bulkStatus}
            onBulkStatusChange={setBulkStatus}
            bulkAssignee={bulkAssignee}
            onBulkAssigneeChange={setBulkAssignee}
            onApplyBulkStatus={applyBulkStatus}
            onApplyBulkAssignee={applyBulkAssignee}
            onBulkAddLabel={addBulkLabel}
          />
        </div>

        <TaskDetailsDrawer
          open={drawerOpen}
          task={selectedTask}
          draft={selectedDraft}
          agents={agents}
          labels={selectedTask ? getTaskLabels(selectedTask) : []}
          notes={selectedTask ? getTaskNotes(selectedTask.id) : ''}
          onClose={closeDrawer}
          onFieldChange={(key, value) => setSelectedDraft((prev) => (prev ? { ...prev, [key]: value } : prev))}
          onSave={saveDraftTask}
          onDelete={deleteTask}
          onAddLabel={() => selectedTask && addLabelToTask(selectedTask.id)}
          onRemoveLabel={(label) => selectedTask && removeLabelFromTask(selectedTask.id, label)}
          onNotesChange={(value) => selectedTask && setTaskMeta(selectedTask.id, { notes: value })}
        />
      </div>
    </section>
  );
}
