function formatWhen(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return value || 'Unknown';
  return date.toLocaleString();
}

export default function CheckpointPanel({
  checkpoints = [],
  onRestore,
  onDelete,
}) {
  return (
    <section className="git-checkpoint-panel">
      <header className="git-side-header">
        <h4>Safe Checkpoints</h4>
        <span>{checkpoints.length}</span>
      </header>

      {checkpoints.length === 0 ? (
        <div className="git-checkpoint-empty">
          No checkpoints yet. Create one before risky changes to make rollback easy.
        </div>
      ) : (
        <div className="git-checkpoint-list">
          {checkpoints.map((checkpoint) => (
            <article key={checkpoint.id} className="git-checkpoint-row">
              <div className="git-checkpoint-main">
                <strong>{checkpoint.name || checkpoint.id}</strong>
                <span>{formatWhen(checkpoint.created_at)}</span>
                {checkpoint.commit ? <code>{checkpoint.commit}</code> : null}
                {checkpoint.note ? <p>{checkpoint.note}</p> : null}
              </div>
              <div className="git-checkpoint-actions">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => onRestore?.(checkpoint)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => onDelete?.(checkpoint)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
