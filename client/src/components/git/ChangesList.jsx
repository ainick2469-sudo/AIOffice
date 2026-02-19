function truncateMiddle(path) {
  const value = String(path || '');
  if (value.length <= 52) return value;
  const start = value.slice(0, 24);
  const end = value.slice(-24);
  return `${start}…${end}`;
}

function statusLabel(item) {
  const code = String(item?.statusCode || '').toUpperCase();
  if (code === 'M') return 'Modified';
  if (code === 'A') return 'Added';
  if (code === 'D') return 'Deleted';
  if (code === 'R') return 'Renamed';
  if (code === 'C') return 'Copied';
  if (code === 'U') return 'Conflict';
  if (code === '?') return 'Untracked';
  return 'Changed';
}

function FileRow({
  item,
  selected,
  onSelect,
  canToggle,
  toggleLabel,
  onToggle,
  disabledReason = '',
}) {
  const changeSummary = item?.changeSummary || '';
  return (
    <button
      type="button"
      className={`git-change-row ${selected ? 'active' : ''}`}
      onClick={() => onSelect?.(item.path)}
      title={item.path}
    >
      <div className="git-change-row-main">
        <span className={`git-status-chip status-${String(item.statusCode || '?').toLowerCase()}`}>
          {String(item.statusCode || '?').toUpperCase()}
        </span>
        <span className="git-change-path">{truncateMiddle(item.path)}</span>
        {changeSummary ? <span className="git-change-count">{changeSummary}</span> : null}
      </div>
      <div className="git-change-row-meta">
        <span>{statusLabel(item)}</span>
        <button
          type="button"
          className="ui-btn"
          disabled={!canToggle}
          title={!canToggle ? disabledReason : toggleLabel}
          onClick={(event) => {
            event.stopPropagation();
            if (canToggle) onToggle?.(item.path);
          }}
        >
          {toggleLabel}
        </button>
      </div>
    </button>
  );
}

function GroupSection({
  title,
  items,
  selectedPath,
  onSelect,
  canBulk,
  bulkLabel,
  onBulk,
  canToggle,
  toggleLabel,
  onToggle,
  disabledReason,
}) {
  return (
    <section className="git-change-group">
      <header className="git-change-group-header">
        <div>
          <strong>{title}</strong>
          <span>{items.length}</span>
        </div>
        <button
          type="button"
          className="ui-btn"
          disabled={!canBulk || items.length === 0}
          title={!canBulk ? disabledReason : ''}
          onClick={onBulk}
        >
          {bulkLabel}
        </button>
      </header>

      <div className="git-change-group-list">
        {items.length === 0 ? (
          <div className="git-change-empty">No files</div>
        ) : (
          items.map((item) => (
            <FileRow
              key={`${title}-${item.path}`}
              item={item}
              selected={selectedPath === item.path}
              onSelect={onSelect}
              canToggle={canToggle}
              toggleLabel={toggleLabel}
              onToggle={onToggle}
              disabledReason={disabledReason}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default function ChangesList({
  unstaged = [],
  staged = [],
  selectedPath = '',
  onSelectFile,
  stageSupported = false,
  unstageSupported = false,
  onStageAll,
  onUnstageAll,
  onStageFile,
  onUnstageFile,
}) {
  const stageDisabledReason = stageSupported ? '' : 'Stage actions are not supported by the current backend.';
  const unstageDisabledReason = unstageSupported ? '' : 'Unstage actions are not supported by the current backend.';

  return (
    <div className="git-changes-panel">
      <GroupSection
        title="Unstaged"
        items={unstaged}
        selectedPath={selectedPath}
        onSelect={onSelectFile}
        canBulk={stageSupported}
        bulkLabel="Stage all"
        onBulk={onStageAll}
        canToggle={stageSupported}
        toggleLabel="Stage"
        onToggle={onStageFile}
        disabledReason={stageDisabledReason}
      />

      <GroupSection
        title="Staged"
        items={staged}
        selectedPath={selectedPath}
        onSelect={onSelectFile}
        canBulk={unstageSupported}
        bulkLabel="Unstage all"
        onBulk={onUnstageAll}
        canToggle={unstageSupported}
        toggleLabel="Unstage"
        onToggle={onUnstageFile}
        disabledReason={unstageDisabledReason}
      />
    </div>
  );
}
