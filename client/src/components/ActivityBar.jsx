const DEFAULT_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C' },
  { id: 'files', label: 'Files', icon: 'F' },
  { id: 'tasks', label: 'Tasks', icon: 'T' },
  { id: 'spec', label: 'Spec', icon: 'S' },
  { id: 'preview', label: 'Preview', icon: 'P' },
  { id: 'git', label: 'Git', icon: 'G' },
];

export default function ActivityBar({
  items = DEFAULT_ITEMS,
  activeId = 'files',
  onSelect,
}) {
  return (
    <aside className="workspace-activity-bar" aria-label="Build navigation">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          title={item.label}
          aria-label={item.label}
          className={`activity-bar-btn ${activeId === item.id ? 'active' : ''}`}
          onClick={() => onSelect?.(item.id)}
        >
          <span className="activity-bar-icon">{item.icon}</span>
          <span className="activity-bar-text">{item.label}</span>
        </button>
      ))}
    </aside>
  );
}
