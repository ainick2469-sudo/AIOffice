function highlight(text, query) {
  const source = String(text || '');
  const needle = String(query || '').trim();
  if (!needle) return source;
  const lower = source.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) return source;
  const start = source.slice(0, idx);
  const hit = source.slice(idx, idx + needle.length);
  const end = source.slice(idx + needle.length);
  return (
    <>
      {start}
      <mark>{hit}</mark>
      {end}
    </>
  );
}

export default function SettingsNav({
  categories,
  selectedCategory,
  onSelectCategory,
  search,
  onSearchChange,
}) {
  return (
    <aside className="settings-v3-nav">
      <div className="settings-v3-nav-header">
        <h3>Settings</h3>
        <p>Configure AI Office behavior and providers.</p>
      </div>

      <label className="settings-v3-search">
        <span>Search settings</span>
        <input
          className="ui-input"
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search providers, agents, appearance..."
        />
      </label>

      <nav className="settings-v3-nav-list" aria-label="Settings categories">
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-v3-nav-item ${selectedCategory === item.id ? 'active' : ''}`}
            onClick={() => onSelectCategory(item.id)}
          >
            <span className="settings-v3-nav-item-title">{highlight(item.label, search)}</span>
            <span className="settings-v3-nav-item-desc">{highlight(item.description, search)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
