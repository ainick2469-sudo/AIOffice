const STATUSES = ['backlog', 'in_progress', 'review', 'blocked', 'done'];
const STATUS_LABELS = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};

function assigneeLabel(task, agents) {
  if (!task.assigned_to) return 'Unassigned';
  return agents?.[task.assigned_to]?.display_name || task.assigned_to;
}

export default function BoardView({
  tasks,
  agents,
  getTaskLabels,
  onOpenTask,
  onSetStatus,
}) {
  const grouped = {};
  STATUSES.forEach((status) => {
    grouped[status] = [];
  });
  (tasks || []).forEach((task) => {
    const status = STATUSES.includes(task.status) ? task.status : 'backlog';
    grouped[status].push(task);
  });

  return (
    <div className="tasks-v2-board">
      {STATUSES.map((status) => (
        <section key={status} className="tasks-v2-column">
          <header className="tasks-v2-column-header">
            <h4>{STATUS_LABELS[status]}</h4>
            <span>{grouped[status].length}</span>
          </header>
          <div className="tasks-v2-column-body">
            {grouped[status].map((task) => {
              const labels = getTaskLabels?.(task) || [];
              return (
                <article key={task.id} className="tasks-v2-card">
                  <button type="button" className="tasks-v2-card-main" onClick={() => onOpenTask?.(task.id)}>
                    <strong>{task.title}</strong>
                    {task.description ? <p>{task.description}</p> : null}
                    <div className="tasks-v2-card-meta">
                      <span>{assigneeLabel(task, agents)}</span>
                      <span>{task.branch || 'main'}</span>
                      <span>P{task.priority || 2}</span>
                    </div>
                    {labels.length > 0 ? (
                      <div className="tasks-v2-card-labels">
                        {labels.map((label) => (
                          <span key={`${task.id}-${label}`} className="tasks-v2-label-chip">{label}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                  <div className="tasks-v2-card-actions">
                    <select
                      value={task.status}
                      onChange={(event) => onSetStatus?.(task.id, event.target.value)}
                    >
                      {STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {STATUS_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              );
            })}
            {grouped[status].length === 0 ? (
              <div className="tasks-v2-column-empty">No tasks</div>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
