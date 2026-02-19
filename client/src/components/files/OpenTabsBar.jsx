export default function OpenTabsBar({
  tabs = [],
  activePath = '',
  onSelectTab,
  onCloseTab,
}) {
  return (
    <div className="files-open-tabs" role="tablist" aria-label="Open files">
      {tabs.length === 0 ? (
        <div className="files-open-tabs-empty">No files open</div>
      ) : (
        tabs.map((tab) => (
          <div
            key={tab.path}
            className={`files-open-tab ${tab.path === activePath ? 'active' : ''}`}
            role="tab"
            aria-selected={tab.path === activePath}
          >
            <button
              type="button"
              className="files-open-tab-main"
              title={tab.path}
              onClick={() => onSelectTab?.(tab.path)}
            >
              <span className="files-open-tab-name">{tab.name}</span>
              {tab.dirty ? <span className="files-open-tab-dirty" title="Unsaved changes">●</span> : null}
            </button>
            <button
              type="button"
              className="files-open-tab-close"
              aria-label={`Close ${tab.name}`}
              onClick={() => onCloseTab?.(tab.path)}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
