import { useState, useEffect } from 'react';

const STATUSES = ['backlog', 'in_progress', 'review', 'blocked', 'done'];
const STATUS_LABELS = {
  backlog: '📋 Backlog',
  in_progress: '🔨 In Progress',
  review: '🔍 Review',
  blocked: '⛔ Blocked',
  done: '✅ Done',
};
const STATUS_COLORS = {
  backlog: '#6B7280',
  in_progress: '#F59E0B',
  review: '#8B5CF6',
  blocked: '#EF4444',
  done: '#10B981',
};

export default function TaskBoard() {
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', assigned_to: '', priority: 1 });

  const load = () => {
    fetch('/api/tasks').then(r => r.json()).then(setTasks).catch(() => {});
    fetch('/api/agents').then(r => r.json()).then(list => {
      const m = {};
      list.forEach(a => { m[a.id] = a; });
      setAgents(m);
    });
  };

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);

  const createTask = (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask),
    }).then(r => r.json()).then(() => {
      setNewTask({ title: '', description: '', assigned_to: '', priority: 1 });
      setShowForm(false);
      load();
    });
  };

  const updateStatus = (taskId, newStatus) => {
    fetch(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).then(() => load());
  };

  const grouped = {};
  STATUSES.forEach(s => { grouped[s] = []; });
  tasks.forEach(t => {
    const s = STATUSES.includes(t.status) ? t.status : 'backlog';
    grouped[s].push(t);
  });

  return (
    <div className="panel task-board">
      <div className="panel-header">
        <h3>Task Board</h3>
        <button className="refresh-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ Cancel' : '+ New Task'}
        </button>
      </div>

      {showForm && (
        <form className="task-form" onSubmit={createTask}>
          <input type="text" placeholder="Task title..." value={newTask.title}
            onChange={e => setNewTask({ ...newTask, title: e.target.value })} autoFocus />
          <textarea placeholder="Description (optional)" value={newTask.description}
            onChange={e => setNewTask({ ...newTask, description: e.target.value })} rows={2} />
          <div className="task-form-row">
            <select value={newTask.assigned_to} onChange={e => setNewTask({ ...newTask, assigned_to: e.target.value })}>
              <option value="">Unassigned</option>
              {Object.values(agents).filter(a => a.id !== 'router').map(a => (
                <option key={a.id} value={a.id}>{a.emoji} {a.display_name}</option>
              ))}
            </select>
            <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: Number(e.target.value) })}>
              <option value={0}>Low</option>
              <option value={1}>Normal</option>
              <option value={2}>High</option>
              <option value={3}>Urgent</option>
            </select>
            <button type="submit">Create</button>
          </div>
        </form>
      )}

      <div className="board-columns">
        {STATUSES.map(status => (
          <div key={status} className="board-column">
            <div className="column-header" style={{ borderTopColor: STATUS_COLORS[status] }}>
              <span>{STATUS_LABELS[status]}</span>
              <span className="column-count">{grouped[status].length}</span>
            </div>
            <div className="column-cards">
              {grouped[status].map(task => (
                <div key={task.id} className={`task-card priority-${task.priority}`}>
                  <div className="task-title">{task.title}</div>
                  {task.description && <div className="task-desc">{task.description}</div>}
                  <div className="task-meta">
                    {task.assigned_to && agents[task.assigned_to] && (
                      <span className="task-assignee" style={{ color: agents[task.assigned_to].color }}>
                        {agents[task.assigned_to].emoji} {agents[task.assigned_to].display_name}
                      </span>
                    )}
                    {task.priority >= 2 && <span className="task-priority-badge">🔥</span>}
                  </div>
                  <div className="task-actions">
                    {STATUSES.filter(s => s !== status).map(s => (
                      <button key={s} className="task-move-btn" onClick={() => updateStatus(task.id, s)}>
                        → {STATUS_LABELS[s].split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {grouped[status].length === 0 && <div className="column-empty">No tasks</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
