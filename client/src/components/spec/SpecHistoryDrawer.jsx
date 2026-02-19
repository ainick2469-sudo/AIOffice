function itemType(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.startsWith('spec-')) return 'Spec';
  if (lower.startsWith('ideas-')) return 'Ideas';
  return 'Snapshot';
}

export default function SpecHistoryDrawer({
  open,
  onToggle,
  history,
  selectedPath,
  onSelectItem,
  compareEnabled,
  onToggleCompare,
}) {
  return (
    <aside className={`spec-history-drawer ${open ? 'open' : ''}`}>
      <div className="spec-history-header">
        <h4>Version History</h4>
        <div className="spec-history-actions">
          <button type="button" className="msg-action-btn ui-btn" onClick={onToggleCompare}>
            {compareEnabled ? 'Compare On' : 'Compare Off'}
          </button>
          <button type="button" className="msg-action-btn ui-btn" onClick={onToggle}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {open && (
        <div className="spec-history-list">
          {Array.isArray(history) && history.length > 0 ? (
            history.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`spec-history-item ${selectedPath === item.path ? 'active' : ''}`}
                onClick={() => onSelectItem?.(item)}
              >
                <div className="spec-history-item-top">
                  <strong>{item.name}</strong>
                  <span className="pill ui-chip">{itemType(item.name)}</span>
                </div>
                <div className="spec-history-item-meta">
                  {item.modified_at ? new Date(item.modified_at).toLocaleString() : 'Unknown time'}
                </div>
              </button>
            ))
          ) : (
            <div className="spec-history-empty">No history snapshots yet.</div>
          )}
        </div>
      )}
    </aside>
  );
}
