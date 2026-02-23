export default function ChatEmptyState({
  isDiscussMode = false,
  onRunBrainstorm = null,
  onOpenSpec = null,
  onOpenSettings = null,
  onUseStarter = null,
}) {
  const starters = [
    'Build a simple todo app with login and dashboard.',
    'Create a FastAPI backend with health checks and tests.',
    'Set up a React app with a polished landing page and preview.',
  ];

  return (
    <div className={`empty-chat chat-empty-state ${isDiscussMode ? 'beginner-empty-card' : ''}`}>
      <h4>Start here</h4>
      <p>Start by describing what you want to build.</p>
      <div className="chat-empty-starters">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            className="ui-btn"
            onClick={() => onUseStarter?.(starter)}
            data-tooltip="Use this as your first prompt, then tailor details for your project."
          >
            {starter}
          </button>
        ))}
      </div>
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
