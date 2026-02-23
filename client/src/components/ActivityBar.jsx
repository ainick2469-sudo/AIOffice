const DEFAULT_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C', shortcut: 'Ctrl+1' },
  { id: 'files', label: 'Files', icon: 'F', shortcut: 'Ctrl+2' },
  { id: 'preview', label: 'Preview', icon: 'P', shortcut: 'Ctrl+3' },
];

function tooltipForItem(item) {
  const base = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
  if (item.id === 'chat') return `${base}: talk to agents and run guided actions.`;
  if (item.id === 'files') return `${base}: browse and edit project files quickly.`;
  if (item.id === 'preview') return `${base}: run and inspect the live app output.`;
  return base;
}

export default function ActivityBar({
  items = DEFAULT_ITEMS,
  activeId = 'files',
  onSelect,
  compact = false,
}) {
  return (
    <aside className={`workspace-activity-bar ${compact ? 'compact' : ''}`} aria-label="Build navigation">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-label={item.label}
          className={`activity-bar-btn ${activeId === item.id ? 'active' : ''}`}
          onClick={() => onSelect?.(item.id)}
          data-tooltip={tooltipForItem(item)}
        >
          <span className="activity-bar-icon">{item.icon}</span>
          <span className="activity-bar-text">{item.label}</span>
          {item.shortcut ? <span className="activity-bar-shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </aside>
  );
}
