function formatWhen(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function TaskRow({
  task,
  index,
  selected,
  onToggleSelect,
  onOpen,
  getTaskLabels,
  agents,
  onSetStatus,
  onSetAssignee,
  onAddLabel,
  onConvertToBoard,
}) {
  const labels = getTaskLabels?.(task) || [];
  return (
    <article className={`tasks-v2-inbox-item ${selected ? 'selected' : ''}`}>
      <div className="tasks-v2-inbox-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggleSelect?.(task.id, index, event.nativeEvent.shiftKey, event.target.checked)}
        />
      </div>

      <button type="button" className="tasks-v2-inbox-main" onClick={() => onOpen?.(task.id)}>
        <div className="tasks-v2-inbox-title-row">
          <strong>{task.title}</strong>
          <span className={`tasks-v2-status-pill status-${task.status}`}>{task.status.replace('_', ' ')}</span>
        </div>
        {task.description ? <p>{task.description}</p> : null}
        <div className="tasks-v2-inbox-meta">
          <span>{task.assigned_to ? (agents?.[task.assigned_to]?.display_name || task.assigned_to) : 'Unassigned'}</span>
          <span>Branch: {task.branch || 'main'}</span>
          <span>Updated: {formatWhen(task.updated_at || task.created_at)}</span>
          {labels.map((label) => (
            <span key={`${task.id}-${label}`} className="tasks-v2-label-chip">{label}</span>
          ))}
        </div>
      </button>

      <div className="tasks-v2-inbox-actions">
        <select
          value={task.status}
          onChange={(event) => onSetStatus?.(task.id, event.target.value)}
          title="Set status"
        >
          <option value="backlog">Backlog</option>
          <option value="in_progress">In Progress</option>
          <option value="review">Review</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
        <select
          value={task.assigned_to || ''}
          onChange={(event) => onSetAssignee?.(task.id, event.target.value)}
          title="Assign"
        >
          <option value="">Unassigned</option>
          {Object.values(agents || {})
            .filter((agent) => agent.id !== 'router')
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.display_name}
              </option>
            ))}
        </select>
        <button type="button" className="msg-action-btn ui-btn" onClick={() => onAddLabel?.(task.id)}>
          Add Label
        </button>
        <button type="button" className="msg-action-btn ui-btn" onClick={onConvertToBoard}>
          Board
        </button>
      </div>
    </article>
  );
}

function Group({
  title,
  tasks,
  offset,
  selectedIds,
  onToggleSelect,
  onOpen,
  getTaskLabels,
  agents,
  onSetStatus,
  onSetAssignee,
  onAddLabel,
  onConvertToBoard,
}) {
  if (!tasks || tasks.length === 0) return null;
  return (
    <section className="tasks-v2-inbox-group">
      <header>
        <h4>{title}</h4>
        <span>{tasks.length}</span>
      </header>
      <div className="tasks-v2-inbox-list">
        {tasks.map((task, localIndex) => (
          <TaskRow
            key={task.id}
            task={task}
            index={offset + localIndex}
            selected={selectedIds.has(task.id)}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
            getTaskLabels={getTaskLabels}
            agents={agents}
            onSetStatus={onSetStatus}
            onSetAssignee={onSetAssignee}
            onAddLabel={onAddLabel}
            onConvertToBoard={onConvertToBoard}
          />
        ))}
      </div>
    </section>
  );
}

export default function InboxView({
  groups,
  orderedTasks,
  selectedIds,
  onToggleSelect,
  onOpenTask,
  getTaskLabels,
  agents,
  onSetStatus,
  onSetAssignee,
  onAddLabel,
  onConvertToBoard,
  selectedCount,
  bulkStatus,
  onBulkStatusChange,
  bulkAssignee,
  onBulkAssigneeChange,
  onApplyBulkStatus,
  onApplyBulkAssignee,
  onBulkAddLabel,
}) {
  const newItems = groups?.newItems || [];
  const triageItems = groups?.triageItems || [];
  const recentItems = groups?.recentItems || [];

  if ((orderedTasks || []).length === 0) {
    return (
      <div className="tasks-v2-empty">
        <h4>Inbox is empty</h4>
        <p>Add a task from Quick Capture or send a message from Spec to generate draft tasks.</p>
      </div>
    );
  }

  let offset = 0;
  const rendered = [
    { title: 'New', items: newItems },
    { title: 'Needs Triage', items: triageItems },
    { title: 'Recently Updated', items: recentItems },
  ];

  return (
    <div className="tasks-v2-inbox">
      {selectedCount > 0 ? (
        <section className="tasks-v2-bulk-bar">
          <strong>{selectedCount} selected</strong>
          <select value={bulkStatus} onChange={(event) => onBulkStatusChange?.(event.target.value)}>
            <option value="">Set status…</option>
            <option value="backlog">Backlog</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
          <button type="button" className="msg-action-btn ui-btn" onClick={onApplyBulkStatus} disabled={!bulkStatus}>
            Apply status
          </button>
          <select value={bulkAssignee} onChange={(event) => onBulkAssigneeChange?.(event.target.value)}>
            <option value="">Assign to…</option>
            <option value="__unassigned__">Unassigned</option>
            {Object.values(agents || {})
              .filter((agent) => agent.id !== 'router')
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.display_name}
                </option>
              ))}
          </select>
          <button type="button" className="msg-action-btn ui-btn" onClick={onApplyBulkAssignee} disabled={!bulkAssignee}>
            Apply assignee
          </button>
          <button type="button" className="msg-action-btn ui-btn" onClick={onBulkAddLabel}>
            Add label
          </button>
        </section>
      ) : null}

      {rendered.map((group) => {
        const section = (
          <Group
            key={group.title}
            title={group.title}
            tasks={group.items}
            offset={offset}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onOpen={onOpenTask}
            getTaskLabels={getTaskLabels}
            agents={agents}
            onSetStatus={onSetStatus}
            onSetAssignee={onSetAssignee}
            onAddLabel={onAddLabel}
            onConvertToBoard={onConvertToBoard}
          />
        );
        offset += group.items.length;
        return section;
      })}
    </div>
  );
}
