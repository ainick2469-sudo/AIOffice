import InboxView from './InboxView';
import BoardView from './BoardView';

function ListView({ tasks, getTaskLabels, onOpenTask, onSetStatus }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="tasks-v2-empty">
        <h4>No tasks found</h4>
        <p>Adjust filters or add a new task from Quick Capture.</p>
      </div>
    );
  }
  return (
    <div className="tasks-v2-list">
      {tasks.map((task) => (
        <article key={task.id} className="tasks-v2-list-row">
          <button type="button" className="tasks-v2-list-main" onClick={() => onOpenTask?.(task.id)}>
            <strong>{task.title}</strong>
            <span>{task.description || 'No description'}</span>
          </button>
          <div className="tasks-v2-list-meta">
            <span className={`tasks-v2-status-pill status-${task.status}`}>{task.status.replace('_', ' ')}</span>
            <span>{task.branch || 'main'}</span>
            <span>P{task.priority || 2}</span>
            {(getTaskLabels?.(task) || []).map((label) => (
              <span key={`${task.id}-${label}`} className="tasks-v2-label-chip">{label}</span>
            ))}
          </div>
          <select
            value={task.status}
            onChange={(event) => onSetStatus?.(task.id, event.target.value)}
          >
            <option value="backlog">Backlog</option>
            <option value="in_progress">In Progress</option>
            <option value="review">Review</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        </article>
      ))}
    </div>
  );
}

export default function TasksView({
  viewMode,
  groups,
  filteredTasks,
  orderedInboxTasks,
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
  if (viewMode === 'board') {
    return (
      <BoardView
        tasks={filteredTasks}
        agents={agents}
        getTaskLabels={getTaskLabels}
        onOpenTask={onOpenTask}
        onSetStatus={onSetStatus}
      />
    );
  }

  if (viewMode === 'list') {
    return (
      <ListView
        tasks={filteredTasks}
        getTaskLabels={getTaskLabels}
        onOpenTask={onOpenTask}
        onSetStatus={onSetStatus}
      />
    );
  }

  return (
    <InboxView
      groups={groups}
      orderedTasks={orderedInboxTasks}
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      onOpenTask={onOpenTask}
      getTaskLabels={getTaskLabels}
      agents={agents}
      onSetStatus={onSetStatus}
      onSetAssignee={onSetAssignee}
      onAddLabel={onAddLabel}
      onConvertToBoard={onConvertToBoard}
      selectedCount={selectedCount}
      bulkStatus={bulkStatus}
      onBulkStatusChange={onBulkStatusChange}
      bulkAssignee={bulkAssignee}
      onBulkAssigneeChange={onBulkAssigneeChange}
      onApplyBulkStatus={onApplyBulkStatus}
      onApplyBulkAssignee={onApplyBulkAssignee}
      onBulkAddLabel={onBulkAddLabel}
    />
  );
}
