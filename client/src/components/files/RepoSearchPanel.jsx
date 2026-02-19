export default function RepoSearchPanel({
  open = false,
  query = '',
  onQueryChange,
  fileMatches = [],
  contentMatches = [],
  indexing = false,
  onOpenFile,
  onClose,
}) {
  if (!open) return null;

  return (
    <aside className="files-repo-search" aria-label="Repository search">
      <header className="files-repo-search-header">
        <div>
          <strong>Repo Search</strong>
          <span>Ctrl+Shift+F · Filename fallback enabled</span>
        </div>
        <button type="button" className="ui-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <input
        autoFocus
        type="text"
        className="files-repo-search-input"
        value={query}
        onChange={(event) => onQueryChange?.(event.target.value)}
        placeholder="Search repository (filenames + open tab content)"
      />

      <div className="files-repo-search-sections">
        <section>
          <h4>Filename matches {indexing ? '(indexing...)' : ''}</h4>
          {fileMatches.length === 0 ? (
            <p className="files-repo-search-empty">No filename matches.</p>
          ) : (
            fileMatches.map((item) => (
              <button
                key={`file-${item.path}`}
                type="button"
                className="files-repo-hit"
                onClick={() => onOpenFile?.(item.path)}
              >
                <span className="files-repo-hit-path">{item.path}</span>
                <span className="files-repo-hit-kind">file</span>
              </button>
            ))
          )}
        </section>

        <section>
          <h4>Open-tab content matches</h4>
          {contentMatches.length === 0 ? (
            <p className="files-repo-search-empty">No content matches in open files.</p>
          ) : (
            contentMatches.map((item) => (
              <button
                key={`content-${item.path}-${item.line}`}
                type="button"
                className="files-repo-hit"
                onClick={() => onOpenFile?.(item.path)}
              >
                <span className="files-repo-hit-path">{item.path}:{item.line}</span>
                <code className="files-repo-hit-snippet">{item.preview}</code>
              </button>
            ))
          )}
        </section>
      </div>
    </aside>
  );
}
