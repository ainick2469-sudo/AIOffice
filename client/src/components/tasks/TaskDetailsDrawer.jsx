function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

export default function TaskDetailsDrawer({
  open,
  task,
  draft,
  agents,
  labels,
  notes,
  onClose,
  onFieldChange,
  onSave,
  onDelete,
  onAddLabel,
  onRemoveLabel,
  onNotesChange,
}) {
  if (!open || !task || !draft) return null;

  const statusValue = draft.status || 'backlog';
  const assigneeValue = draft.assigned_to || '';
  const linkedFiles = Array.isArray(task.linked_files) ? task.linked_files : [];
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const dependsOn = Array.isArray(task.depends_on) ? task.depends_on : [];
  const linkedSpec = task.spec_section || '';

  return (
    <aside className="tasks-v2-drawer" aria-label="Task details drawer">
      <header className="tasks-v2-drawer-header">
        <div>
          <h4>Task #{task.id}</h4>
          <p>{formatDate(task.updated_at || task.created_at)}</p>
        </div>
        <button type="button" className="msg-action-btn ui-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="tasks-v2-drawer-body">
        <label>
          Title
          <input
            type="text"
            value={draft.title || ''}
            onChange={(event) => onFieldChange?.('title', event.target.value)}
          />
        </label>

        <label>
          Description
          <textarea
            value={draft.description || ''}
            onChange={(event) => onFieldChange?.('description', event.target.value)}
          />
        </label>

        <div className="tasks-v2-drawer-grid">
          <label>
            Status
            <select
              value={statusValue}
              onChange={(event) => onFieldChange?.('status', event.target.value)}
            >
              <option value="backlog">Backlog</option>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          </label>

          <label>
            Assignee
            <select
              value={assigneeValue}
              onChange={(event) => onFieldChange?.('assigned_to', event.target.value)}
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
          </label>

          <label>
            Branch
            <input
              type="text"
              value={draft.branch || 'main'}
              onChange={(event) => onFieldChange?.('branch', event.target.value)}
            />
          </label>

          <label>
            Priority
            <select
              value={draft.priority || 2}
              onChange={(event) => onFieldChange?.('priority', Number(event.target.value))}
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
            </select>
          </label>
        </div>

        <section className="tasks-v2-drawer-section">
          <h5>Labels</h5>
          <div className="tasks-v2-drawer-labels">
            {(labels || []).map((label) => (
              <button
                key={`${task.id}-${label}`}
                type="button"
                className="tasks-v2-label-chip removable"
                onClick={() => onRemoveLabel?.(label)}
                title="Remove label"
              >
                {label} ×
              </button>
            ))}
            {(labels || []).length === 0 ? <span className="tasks-v2-muted">No labels yet</span> : null}
          </div>
          <button type="button" className="msg-action-btn ui-btn" onClick={onAddLabel}>
            Add Label
          </button>
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Linked Spec Section</h5>
          <p>{linkedSpec || 'Not linked yet.'}</p>
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Linked Files</h5>
          {linkedFiles.length > 0 ? (
            <ul>
              {linkedFiles.map((file) => <li key={`${task.id}-${file}`}><code>{file}</code></li>)}
            </ul>
          ) : (
            <p>No linked files.</p>
          )}
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Dependencies</h5>
          {dependsOn.length > 0 ? <p>{dependsOn.join(', ')}</p> : <p>No dependencies.</p>}
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Subtasks</h5>
          {subtasks.length > 0 ? (
            <ul>
              {subtasks.map((subtask, index) => (
                <li key={`${task.id}-sub-${index}`}>
                  {subtask.done ? '✓' : '○'} {subtask.title}
                </li>
              ))}
            </ul>
          ) : (
            <p>No subtasks.</p>
          )}
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Notes</h5>
          <textarea
            value={notes}
            onChange={(event) => onNotesChange?.(event.target.value)}
            placeholder="Client-only working notes for this task."
          />
        </section>

        <section className="tasks-v2-drawer-section">
          <h5>Activity</h5>
          <p>Activity timeline coming soon.</p>
        </section>
      </div>

      <footer className="tasks-v2-drawer-footer">
        <button type="button" className="control-btn ui-btn" onClick={onSave}>
          Save
        </button>
        <button type="button" className="control-btn ui-btn ui-btn-destructive" onClick={onDelete}>
          Delete
        </button>
      </footer>
    </aside>
  );
}
