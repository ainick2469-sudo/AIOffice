export default function ChatEmptyState({
  isDiscussMode = false,
  onRunBrainstorm = null,
  onOpenSpec = null,
  onOpenSettings = null,
}) {
  return (
    <div className={`empty-chat chat-empty-state ${isDiscussMode ? 'beginner-empty-card' : ''}`}>
      <h4>Start here</h4>
      <p>Start by describing what you want to build.</p>
      <div className="beginner-empty-actions">
        {isDiscussMode ? (
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => onRunBrainstorm?.()}
            data-tooltip="Run a structured team brainstorm prompt to propose options and open questions."
          >
            Run brainstorm
          </button>
        ) : null}
        <button
          type="button"
          className="ui-btn"
          onClick={() => onOpenSpec?.()}
          data-tooltip="Open Spec to define the goal, scope, and acceptance criteria."
        >
          Open Spec
        </button>
        <button
          type="button"
          className="ui-btn"
          onClick={() => onOpenSettings?.()}
          data-tooltip="Open Settings to configure providers and verify keys."
        >
          Configure Providers
        </button>
      </div>
    </div>
  );
}
