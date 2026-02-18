import { useEffect, useState } from 'react';

export default function OraclePanel({
  channel = 'main',
  onOpenFile = null,
  onSendToChat = null,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeProject, setActiveProject] = useState({ project: 'ai-office', branch: 'main' });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch(`/api/projects/active/${channel}`)
      .then(r => r.json())
      .then((data) => {
        setActiveProject({ project: data?.project || 'ai-office', branch: data?.branch || 'main' });
      })
      .catch(() => {});
  }, [channel]);

  const search = (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setNotice('');
    setSearching(true);
    fetch(`/api/oracle/search?channel=${encodeURIComponent(channel)}&q=${encodeURIComponent(q)}&limit=80`)
      .then(r => r.json())
      .then((data) => {
        if (data?.ok) {
          setResults(Array.isArray(data.results) ? data.results : []);
        } else {
          setResults([]);
          setNotice(data?.error || 'Search failed.');
        }
      })
      .catch(() => {
        setResults([]);
        setNotice('Search failed.');
      })
      .finally(() => setSearching(false));
  };

  const sendSnippet = (item) => {
    const header = `[ORACLE] ${item.path}:${item.line}`;
    const body = item.preview ? `\n\`\`\`text\n${item.preview}\n\`\`\`\n` : '\n';
    onSendToChat?.(`${header}${body}`);
  };

  return (
    <div className="panel search-panel">
      <div className="panel-header">
        <h3>🔮 Oracle (Project Search)</h3>
        <div className="project-path">
          {activeProject.project} @ {activeProject.branch}
        </div>
      </div>

      <form className="search-form" onSubmit={search}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search active project files..."
          autoFocus
        />
        <button type="submit" disabled={searching}>{searching ? '...' : 'Search'}</button>
      </form>

      {notice && <div className="builder-status">{notice}</div>}

      <div className="search-results">
        {results.length === 0 && query && !searching && !notice && (
          <div className="search-empty">No results for "{query}"</div>
        )}
        {results.map((item, idx) => (
          <div key={`${item.path}:${item.line}:${idx}`} className="search-result">
            <div className="search-result-header">
              <span style={{ fontWeight: 600, fontSize: 13 }}>{item.path}</span>
              <span className="search-channel">L{item.line}</span>
              <div className="process-actions" style={{ marginLeft: 'auto' }}>
                <button onClick={() => onOpenFile?.({ path: item.path, line: item.line })}>Open</button>
                <button onClick={() => sendSnippet(item)}>Send to Chat</button>
              </div>
            </div>
            <div className="search-result-body">
              <pre className="project-result">{item.preview || ''}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

