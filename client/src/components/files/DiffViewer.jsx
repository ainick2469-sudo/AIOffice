function splitLines(value) {
  return String(value || '').split('\n');
}

export default function DiffViewer({
  before = '',
  after = '',
  baselineAvailable = true,
}) {
  if (!baselineAvailable) {
    return (
      <div className="files-diff-empty">
        <h4>Baseline not available</h4>
        <p>The original version was not captured for this file, so diff view cannot compare revisions yet.</p>
      </div>
    );
  }

  const left = splitLines(before);
  const right = splitLines(after);
  const total = Math.max(left.length, right.length);

  return (
    <div className="files-diff-grid">
      <section className="files-diff-pane">
        <header>Before</header>
        <div className="files-diff-body">
          {Array.from({ length: total }).map((_, index) => {
            const line = left[index] ?? '';
            const changed = (left[index] ?? '') !== (right[index] ?? '');
            return (
              <div key={`before-${index}`} className={`files-diff-line ${changed ? 'changed' : ''}`}>
                <span className="files-diff-ln">{index + 1}</span>
                <code>{line || '\u00a0'}</code>
              </div>
            );
          })}
        </div>
      </section>

      <section className="files-diff-pane">
        <header>After</header>
        <div className="files-diff-body">
          {Array.from({ length: total }).map((_, index) => {
            const line = right[index] ?? '';
            const changed = (left[index] ?? '') !== (right[index] ?? '');
            return (
              <div key={`after-${index}`} className={`files-diff-line ${changed ? 'changed' : ''}`}>
                <span className="files-diff-ln">{index + 1}</span>
                <code>{line || '\u00a0'}</code>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
