const MESSAGE_TEMPLATES = [
  { value: 'feat', label: 'feat' },
  { value: 'fix', label: 'fix' },
  { value: 'refactor', label: 'refactor' },
  { value: 'chore', label: 'chore' },
  { value: 'docs', label: 'docs' },
];

export default function CommitPanel({
  commitMessage = '',
  onCommitMessageChange,
  selectedTemplate = 'feat',
  onTemplateChange,
  onApplyTemplate,
  suggestion = '',
  onApplySuggestion,
  onCommit,
  commitDisabled = true,
  stagedCount = 0,
  lastCommit = null,
  notice = '',
}) {
  return (
    <section className="git-commit-panel">
      <header className="git-side-header">
        <h4>Commit & Actions</h4>
        <span>{stagedCount} staged</span>
      </header>

      <div className="git-commit-section">
        <label>
          Commit template
          <div className="git-commit-template-row">
            <select
              value={selectedTemplate}
              onChange={(event) => onTemplateChange?.(event.target.value)}
            >
              {MESSAGE_TEMPLATES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="button" className="ui-btn" onClick={onApplyTemplate}>
              Insert
            </button>
          </div>
        </label>

        <label>
          Commit message
          <textarea
            value={commitMessage}
            onChange={(event) => onCommitMessageChange?.(event.target.value)}
            placeholder="feat: explain what changed"
          />
        </label>

        <div className="git-commit-suggestion">
          <strong>Suggested</strong>
          <span>{suggestion || 'No suggestion yet'}</span>
          <button type="button" className="ui-btn" onClick={onApplySuggestion} disabled={!suggestion}>
            Use suggestion
          </button>
        </div>

        <button
          type="button"
          className="ui-btn ui-btn-primary git-commit-btn"
          onClick={onCommit}
          disabled={commitDisabled}
          title={commitDisabled ? 'Need staged changes and a commit message.' : 'Create commit'}
        >
          Commit changes
        </button>
      </div>

      <div className="git-last-commit">
        <h5>Last commit</h5>
        {lastCommit ? (
          <>
            <code>{lastCommit.hash}</code>
            <p>{lastCommit.message}</p>
            {lastCommit.when ? <span>{lastCommit.when}</span> : null}
          </>
        ) : (
          <p>No commit summary available.</p>
        )}
      </div>

      {notice ? <div className="git-notice">{notice}</div> : null}
    </section>
  );
}
