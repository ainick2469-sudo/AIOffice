function parseUnifiedRows(text) {
  const lines = String(text || '').split('\n');
  const rows = [];
  let oldLine = null;
  let newLine = null;

  lines.forEach((line, index) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push({
        key: `hunk-${index}`,
        kind: 'hunk',
        leftNum: '',
        rightNum: '',
        text: line,
      });
      return;
    }

    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      rows.push({
        key: `meta-${index}`,
        kind: 'meta',
        leftNum: '',
        rightNum: '',
        text: line,
      });
      return;
    }

    if (line.startsWith('-')) {
      rows.push({
        key: `minus-${index}`,
        kind: 'minus',
        leftNum: oldLine ?? '',
        rightNum: '',
        text: line,
      });
      if (oldLine !== null) oldLine += 1;
      return;
    }

    if (line.startsWith('+')) {
      rows.push({
        key: `plus-${index}`,
        kind: 'plus',
        leftNum: '',
        rightNum: newLine ?? '',
        text: line,
      });
      if (newLine !== null) newLine += 1;
      return;
    }

    if (line.startsWith(' ')) {
      rows.push({
        key: `ctx-${index}`,
        kind: 'context',
        leftNum: oldLine ?? '',
        rightNum: newLine ?? '',
        text: line,
      });
      if (oldLine !== null) oldLine += 1;
      if (newLine !== null) newLine += 1;
      return;
    }

    rows.push({
      key: `raw-${index}`,
      kind: 'raw',
      leftNum: '',
      rightNum: '',
      text: line,
    });
  });

  return rows;
}

function sideBySideRows(rows) {
  const paired = [];

  rows.forEach((row) => {
    if (row.kind === 'minus') {
      paired.push({
        key: `${row.key}-sbs`,
        leftNum: row.leftNum,
        leftText: row.text,
        leftKind: 'minus',
        rightNum: '',
        rightText: '',
        rightKind: 'empty',
      });
      return;
    }

    if (row.kind === 'plus') {
      paired.push({
        key: `${row.key}-sbs`,
        leftNum: '',
        leftText: '',
        leftKind: 'empty',
        rightNum: row.rightNum,
        rightText: row.text,
        rightKind: 'plus',
      });
      return;
    }

    paired.push({
      key: `${row.key}-sbs`,
      leftNum: row.leftNum,
      leftText: row.text,
      leftKind: row.kind,
      rightNum: row.rightNum,
      rightText: row.text,
      rightKind: row.kind,
    });
  });

  return paired;
}

export default function DiffViewer({
  filePath = '',
  diffText = '',
  viewMode = 'unified',
  onViewModeChange,
  onCopyDiff,
}) {
  const hasDiff = Boolean(String(diffText || '').trim());
  const rows = parseUnifiedRows(diffText);
  const pairedRows = sideBySideRows(rows);

  return (
    <div className="git-diff-panel">
      <header className="git-diff-header">
        <div>
          <strong>{filePath || 'Select a file to inspect changes'}</strong>
          <span>{hasDiff ? 'Unified diff' : 'Diff unavailable, status only'}</span>
        </div>
        <div className="git-diff-header-actions">
          <div className="git-diff-mode-toggle">
            <button
              type="button"
              className={`ui-btn ${viewMode === 'unified' ? 'ui-btn-primary' : ''}`}
              onClick={() => onViewModeChange?.('unified')}
            >
              Unified
            </button>
            <button
              type="button"
              className={`ui-btn ${viewMode === 'side' ? 'ui-btn-primary' : ''}`}
              onClick={() => onViewModeChange?.('side')}
            >
              Side by side
            </button>
          </div>
          <button type="button" className="ui-btn" onClick={onCopyDiff} disabled={!hasDiff}>
            Copy diff
          </button>
        </div>
      </header>

      {!hasDiff ? (
        <div className="git-diff-empty">
          <h4>No diff available</h4>
          <p>Current backend returned status/log data without file-level patch text for this selection.</p>
        </div>
      ) : viewMode === 'side' ? (
        <div className="git-diff-side">
          <div className="git-diff-side-head">
            <span>Before</span>
            <span>After</span>
          </div>
          <div className="git-diff-side-body">
            {pairedRows.map((row) => (
              <div key={row.key} className="git-diff-side-row">
                <div className={`git-diff-side-cell ${row.leftKind}`}>
                  <span className="ln">{row.leftNum}</span>
                  <code>{row.leftText || '\u00a0'}</code>
                </div>
                <div className={`git-diff-side-cell ${row.rightKind}`}>
                  <span className="ln">{row.rightNum}</span>
                  <code>{row.rightText || '\u00a0'}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="git-diff-unified">
          {rows.map((row) => (
            <div key={row.key} className={`git-diff-row ${row.kind}`}>
              <span className="ln">{row.leftNum}</span>
              <span className="ln">{row.rightNum}</span>
              <code>{row.text || '\u00a0'}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
