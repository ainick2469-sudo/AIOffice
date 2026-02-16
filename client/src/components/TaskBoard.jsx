import { useEffect, useMemo, useState } from 'react';

const STATUSES = ['backlog', 'in_progress', 'review', 'blocked', 'done'];
const STATUS_LABELS = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};
const STATUS_COLORS = {
  backlog: '#6B7280',
  in_progress: '#F59E0B',
  review: '#8B5CF6',
  blocked: '#EF4444',
  done: '#10B981',
};
const PRIORITY_LABELS = { 1: 'P1', 2: 'P2', 3: 'P3' };

const blankTask = {
  title: '',
  description: '',
  assigned_to: '',
  priority: 2,
  subtasks: [],
  linked_files: [],
  depends_on: [],
};

function normalizeSubtasks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return { title: item.trim(), done: false };
      }
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title || '').trim();
      if (!title) return null;
      return { title, done: Boolean(item.done) };
    })
    .filter(Boolean);
}

function normalizeTask(task) {
  return {
    ...task,
    priority: Math.max(1, Math.min(3, Number(task.priority) || 2)),
    subtasks: normalizeSubtasks(task.subtasks),
    linked_files: Array.isArray(task.linked_files) ? task.linked_files.filter(Boolean) : [],
    depends_on: Array.isArray(task.depends_on)
      ? task.depends_on.map((value) => Number(value)).filter(Number.isFinite)
      : [],
  };
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState(blankTask);
  const [filters, setFilters] = useState({
    search: '',
    assigned_to: 'all',
    priority: 'all',
    status: 'all',
  });
  const [selectedTask, setSelectedTask] = useState(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newLinkedFile, setNewLinkedFile] = useState('');

  const load = () => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((list) => setTasks(Array.isArray(list) ? list.map(normalizeTask) : []))
      .catch(() => {});

    fetch('/api/agents')
      .then((r) => r.json())
      .then((list) => {
        const next = {};
        (list || []).forEach((agent) => {
          next[agent.id] = agent;
        });
        setAgents(next);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const search = filters.search.trim().toLowerCase();
      if (search) {
        const blob = `${task.title} ${task.description || ''}`.toLowerCase();
        if (!blob.includes(search)) return false;
      }
      if (filters.assigned_to !== 'all') {
        if (filters.assigned_to === 'unassigned' && task.assigned_to) return false;
        if (filters.assigned_to !== 'unassigned' && task.assigned_to !== filters.assigned_to) return false;
      }
      if (filters.priority !== 'all' && String(task.priority) !== String(filters.priority)) return false;
      if (filters.status !== 'all' && task.status !== filters.status) return false;
      return true;
    });
  }, [tasks, filters]);

  const grouped = useMemo(() => {
    const next = {};
    STATUSES.forEach((status) => {
      next[status] = [];
    });
    filteredTasks.forEach((task) => {
      const status = STATUSES.includes(task.status) ? task.status : 'backlog';
      next[status].push(task);
    });
    return next;
  }, [filteredTasks]);

  const resetNewTask = () => setNewTask(blankTask);

  const createTask = (event) => {
    event.preventDefault();
    if (!newTask.title.trim()) return;

    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newTask,
        title: newTask.title.trim(),
        description: (newTask.description || '').trim(),
      }),
    })
      .then((r) => r.json())
      .then(() => {
        setShowForm(false);
        resetNewTask();
        load();
      })
      .catch(() => {});
  };

  const updateTaskStatus = (taskId, status) => {
    fetch(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then((r) => r.json())
      .then((updated) => {
        setTasks((prev) => prev.map((task) => (task.id === updated.id ? normalizeTask(updated) : task)));
        if (selectedTask?.id === updated.id) {
          setSelectedTask(normalizeTask(updated));
        }
      })
      .catch(() => {});
  };

  const openTask = (task) => {
    setSelectedTask(normalizeTask(task));
    setNewSubtaskTitle('');
    setNewLinkedFile('');
  };

  const saveTask = () => {
    if (!selectedTask) return;
    fetch(`/api/tasks/${selectedTask.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: selectedTask.title.trim(),
        description: (selectedTask.description || '').trim(),
        status: selectedTask.status,
        assigned_to: selectedTask.assigned_to || null,
        priority: selectedTask.priority,
        subtasks: normalizeSubtasks(selectedTask.subtasks),
        linked_files: selectedTask.linked_files || [],
        depends_on: selectedTask.depends_on || [],
      }),
    })
      .then((r) => r.json())
      .then((updated) => {
        const next = normalizeTask(updated);
        setTasks((prev) => prev.map((task) => (task.id === next.id ? next : task)));
        setSelectedTask(next);
      })
      .catch(() => {});
  };

  const deleteTask = () => {
    if (!selectedTask) return;
    fetch(`/api/tasks/${selectedTask.id}`, { method: 'DELETE' })
      .then(() => {
        setTasks((prev) => prev.filter((task) => task.id !== selectedTask.id));
        setSelectedTask(null);
      })
      .catch(() => {});
  };

  const setTaskField = (key, value) => {
    setSelectedTask((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const moveSelectedTask = (direction) => {
    if (!selectedTask) return;
    const currentIndex = STATUSES.indexOf(selectedTask.status);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= STATUSES.length) return;
    const nextStatus = STATUSES[nextIndex];
    setTaskField('status', nextStatus);
    updateTaskStatus(selectedTask.id, nextStatus);
  };

  const addSubtask = () => {
    const title = newSubtaskTitle.trim();
    if (!title || !selectedTask) return;
    setTaskField('subtasks', [...selectedTask.subtasks, { title, done: false }]);
    setNewSubtaskTitle('');
  };

  const toggleSubtask = (index) => {
    if (!selectedTask) return;
    const subtasks = selectedTask.subtasks.map((item, idx) => {
      if (idx !== index) return item;
      return { ...item, done: !item.done };
    });
    setTaskField('subtasks', subtasks);
  };

  const removeSubtask = (index) => {
    if (!selectedTask) return;
    setTaskField('subtasks', selectedTask.subtasks.filter((_, idx) => idx !== index));
  };

  const addLinkedFile = () => {
    const value = newLinkedFile.trim();
    if (!value || !selectedTask) return;
    if (selectedTask.linked_files.includes(value)) {
      setNewLinkedFile('');
      return;
    }
    setTaskField('linked_files', [...selectedTask.linked_files, value]);
    setNewLinkedFile('');
  };

  const removeLinkedFile = (index) => {
    if (!selectedTask) return;
    setTaskField('linked_files', selectedTask.linked_files.filter((_, idx) => idx !== index));
  };

  const assigneeLabel = (task) => {
    if (!task.assigned_to) return 'Unassigned';
    const agent = agents[task.assigned_to];
    return agent ? `${agent.emoji || 'AI'} ${agent.display_name}` : task.assigned_to;
  };

  const parsedDependsOn = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => Number(entry.trim()))
      .filter((id) => Number.isFinite(id));

  return (
    <div className="panel task-board">
      <div className="panel-header">
        <h3>Task Board</h3>
        <button className="refresh-btn" onClick={() => setShowForm((prev) => !prev)}>
          {showForm ? 'Cancel' : '+ New Task'}
        </button>
      </div>

      {showForm && (
        <form className="task-form" onSubmit={createTask}>
          <input
            type="text"
            value={newTask.title}
            placeholder="Task title"
            onChange={(event) => setNewTask((prev) => ({ ...prev, title: event.target.value }))}
            autoFocus
          />
          <textarea
            rows={2}
            value={newTask.description}
            placeholder="Description"
            onChange={(event) => setNewTask((prev) => ({ ...prev, description: event.target.value }))}
          />
          <div className="task-form-row">
            <select
              value={newTask.assigned_to}
              onChange={(event) => setNewTask((prev) => ({ ...prev, assigned_to: event.target.value }))}
            >
              <option value="">Unassigned</option>
              {Object.values(agents)
                .filter((agent) => agent.id !== 'router')
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.emoji || 'AI'} {agent.display_name}
                  </option>
                ))}
            </select>
            <select
              value={newTask.priority}
              onChange={(event) => setNewTask((prev) => ({ ...prev, priority: Number(event.target.value) }))}
            >
              <option value={1}>Priority 1</option>
              <option value={2}>Priority 2</option>
              <option value={3}>Priority 3</option>
            </select>
            <button type="submit">Create</button>
          </div>
        </form>
      )}

      <div className="task-filters">
        <input
          type="text"
          placeholder="Filter by text"
          value={filters.search}
          onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
        />
        <select
          value={filters.assigned_to}
          onChange={(event) => setFilters((prev) => ({ ...prev, assigned_to: event.target.value }))}
        >
          <option value="all">All Assignees</option>
          <option value="unassigned">Unassigned</option>
          {Object.values(agents)
            .filter((agent) => agent.id !== 'router')
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.display_name}
              </option>
            ))}
        </select>
        <select
          value={filters.priority}
          onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}
        >
          <option value="all">All Priorities</option>
          <option value="1">P1</option>
          <option value="2">P2</option>
          <option value="3">P3</option>
        </select>
        <select
          value={filters.status}
          onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
        >
          <option value="all">All Statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div className="board-columns">
        {STATUSES.map((status) => (
          <div key={status} className="board-column">
            <div className="column-header" style={{ borderTopColor: STATUS_COLORS[status] }}>
              <span>{STATUS_LABELS[status]}</span>
              <span className="column-count">{grouped[status].length}</span>
            </div>
            <div className="column-cards">
              {grouped[status].map((task) => (
                <article key={task.id} className={`task-card priority-${task.priority}`}>
                  <button className="task-card-main" onClick={() => openTask(task)}>
                    <div className="task-title-row">
                      <div className="task-title">{task.title}</div>
                      <span className={`task-priority-pill p${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                    </div>
                    {task.description && <div className="task-desc">{task.description}</div>}
                    <div className="task-meta">
                      <span className="task-assignee">{assigneeLabel(task)}</span>
                      <span>{task.subtasks.filter((item) => item.done).length}/{task.subtasks.length} subtasks</span>
                    </div>
                  </button>
                  <div className="task-actions">
                    <button
                      className="task-move-btn"
                      onClick={() => updateTaskStatus(task.id, STATUSES[Math.max(0, STATUSES.indexOf(task.status) - 1)])}
                      disabled={STATUSES.indexOf(task.status) === 0}
                    >
                      Back
                    </button>
                    <button
                      className="task-move-btn"
                      onClick={() => updateTaskStatus(task.id, STATUSES[Math.min(STATUSES.length - 1, STATUSES.indexOf(task.status) + 1)])}
                      disabled={STATUSES.indexOf(task.status) === STATUSES.length - 1}
                    >
                      Next
                    </button>
                  </div>
                </article>
              ))}
              {grouped[status].length === 0 && <div className="column-empty">No tasks</div>}
            </div>
          </div>
        ))}
      </div>

      {selectedTask && (
        <div className="task-modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="task-modal" onClick={(event) => event.stopPropagation()}>
            <div className="task-modal-header">
              <h4>Task #{selectedTask.id}</h4>
              <button className="task-modal-close" onClick={() => setSelectedTask(null)}>Close</button>
            </div>

            <div className="task-modal-grid">
              <label>
                Title
                <input
                  type="text"
                  value={selectedTask.title}
                  onChange={(event) => setTaskField('title', event.target.value)}
                />
              </label>
              <label>
                Status
                <select
                  value={selectedTask.status}
                  onChange={(event) => setTaskField('status', event.target.value)}
                >
                  {STATUSES.map((statusItem) => (
                    <option key={statusItem} value={statusItem}>{STATUS_LABELS[statusItem]}</option>
                  ))}
                </select>
              </label>
              <label>
                Assignee
                <select
                  value={selectedTask.assigned_to || ''}
                  onChange={(event) => setTaskField('assigned_to', event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {Object.values(agents)
                    .filter((agent) => agent.id !== 'router')
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.display_name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={selectedTask.priority}
                  onChange={(event) => setTaskField('priority', Number(event.target.value))}
                >
                  <option value={1}>Priority 1</option>
                  <option value={2}>Priority 2</option>
                  <option value={3}>Priority 3</option>
                </select>
              </label>
              <label className="task-modal-full">
                Description
                <textarea
                  rows={3}
                  value={selectedTask.description || ''}
                  onChange={(event) => setTaskField('description', event.target.value)}
                />
              </label>
              <label className="task-modal-full">
                Depends On (comma-separated task IDs)
                <input
                  type="text"
                  value={(selectedTask.depends_on || []).join(', ')}
                  onChange={(event) => setTaskField('depends_on', parsedDependsOn(event.target.value))}
                />
              </label>
            </div>

            <section className="task-modal-section">
              <h5>Subtasks</h5>
              <div className="task-inline-form">
                <input
                  type="text"
                  value={newSubtaskTitle}
                  placeholder="New subtask title"
                  onChange={(event) => setNewSubtaskTitle(event.target.value)}
                />
                <button onClick={addSubtask}>Add</button>
              </div>
              <ul className="task-detail-list">
                {selectedTask.subtasks.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(item.done)}
                        onChange={() => toggleSubtask(index)}
                      />
                      {item.title}
                    </label>
                    <button onClick={() => removeSubtask(index)}>Remove</button>
                  </li>
                ))}
                {selectedTask.subtasks.length === 0 && <li>No subtasks</li>}
              </ul>
            </section>

            <section className="task-modal-section">
              <h5>Linked Files</h5>
              <div className="task-inline-form">
                <input
                  type="text"
                  value={newLinkedFile}
                  placeholder="src/file.py"
                  onChange={(event) => setNewLinkedFile(event.target.value)}
                />
                <button onClick={addLinkedFile}>Add</button>
              </div>
              <ul className="task-detail-list">
                {selectedTask.linked_files.map((path, index) => (
                  <li key={`${path}-${index}`}>
                    <code>{path}</code>
                    <button onClick={() => removeLinkedFile(index)}>Remove</button>
                  </li>
                ))}
                {selectedTask.linked_files.length === 0 && <li>No linked files</li>}
              </ul>
            </section>

            <div className="task-modal-actions">
              <button className="task-move-btn" onClick={() => moveSelectedTask(-1)}>Move Left</button>
              <button className="task-move-btn" onClick={() => moveSelectedTask(1)}>Move Right</button>
              <button className="refresh-btn" onClick={saveTask}>Save</button>
              <button className="stop-btn" onClick={deleteTask}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
