export default function QuickCaptureBar({
  capture,
  onChangeField,
  onToggleAdvanced,
  onSubmit,
  agents,
  branchOptions,
  statusOptions,
}) {
  return (
    <section className="tasks-v2-capture">
      <div className="tasks-v2-capture-main">
        <input
          type="text"
          value={capture.title}
          onChange={(event) => onChangeField?.('title', event.target.value)}
          placeholder="Add a task... (use /bug /feature /refactor /qa /doc /idea)"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit?.();
            }
          }}
        />
        <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={onSubmit}>
          Add
        </button>
        <button type="button" className="control-btn ui-btn" onClick={onToggleAdvanced}>
          {capture.advanced ? 'Hide Advanced' : 'Advanced'}
        </button>
      </div>

      {capture.advanced && (
        <div className="tasks-v2-capture-advanced">
          <textarea
            value={capture.description}
            onChange={(event) => onChangeField?.('description', event.target.value)}
            placeholder="Optional description"
          />

          <div className="tasks-v2-capture-row">
            <label>
              Status
              <select
                value={capture.status}
                onChange={(event) => onChangeField?.('status', event.target.value)}
              >
                {(statusOptions || []).map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Assignee
              <select
                value={capture.assigned_to}
                onChange={(event) => onChangeField?.('assigned_to', event.target.value)}
              >
                <option value="">Unassigned</option>
                {Object.values(agents || {})
                  .filter((agent) => agent.id !== 'router')
                  .map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.emoji || 'AI'} {agent.display_name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Branch
              <select
                value={capture.branch}
                onChange={(event) => onChangeField?.('branch', event.target.value)}
              >
                {(branchOptions || []).map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Labels
              <input
                type="text"
                value={capture.labels}
                onChange={(event) => onChangeField?.('labels', event.target.value)}
                placeholder="comma separated"
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
