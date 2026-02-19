const DEFAULT_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C', shortcut: 'Ctrl+1' },
  { id: 'files', label: 'Files', icon: 'F', shortcut: 'Ctrl+2' },
  { id: 'git', label: 'Git', icon: 'G', shortcut: 'Ctrl+3' },
  { id: 'tasks', label: 'Tasks', icon: 'T', shortcut: 'Ctrl+4' },
  { id: 'spec', label: 'Spec', icon: 'S', shortcut: 'Ctrl+5' },
  { id: 'preview', label: 'Preview', icon: 'P', shortcut: 'Ctrl+6' },
  { id: 'settings', label: 'Settings', icon: '⚙', shortcut: 'Ctrl+,' },
];

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
          title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          aria-label={item.label}
          className={`activity-bar-btn ${activeId === item.id ? 'active' : ''}`}
          onClick={() => onSelect?.(item.id)}
        >
          <span className="activity-bar-icon">{item.icon}</span>
          <span className="activity-bar-text">{item.label}</span>
          {item.shortcut ? <span className="activity-bar-shortcut">{item.shortcut}</span> : null}
        </button>
      ))}
    </aside>
  );
}
