import { useEffect, useMemo, useState } from 'react';

function scoreMatch(path, query) {
  const text = String(path || '').toLowerCase();
  const q = String(query || '').toLowerCase().trim();
  if (!q) return 1;
  if (text === q) return 1000;
  if (text.endsWith(`/${q}`)) return 600;
  if (text.includes(q)) return 320 - (text.indexOf(q) * 0.6);

  let cursor = 0;
  let score = 0;
  for (let index = 0; index < q.length; index += 1) {
    const next = text.indexOf(q[index], cursor);
    if (next < 0) return -1;
    score += Math.max(0, 42 - next);
    cursor = next + 1;
  }
  return score;
}

export default function QuickOpenModal({
  open = false,
  files = [],
  recentFiles = [],
  onClose,
  onSelect,
}) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setQuery('');
      setHighlighted(0);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  const normalizedFiles = useMemo(() => {
    const ordered = [];
    const seen = new Set();
    (recentFiles || []).forEach((path) => {
      const value = String(path || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ordered.push({ path: value, fromRecent: true });
    });
    (files || []).forEach((file) => {
      const value = String(file?.path || file).trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ordered.push({ path: value, fromRecent: false });
    });
    return ordered;
  }, [files, recentFiles]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return normalizedFiles.slice(0, 40);
    return normalizedFiles
      .map((item) => ({
        ...item,
        score: scoreMatch(item.path, q),
      }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60);
  }, [query, normalizedFiles]);

  const activeIndex = Math.min(highlighted, Math.max(results.length - 1, 0));

  if (!open) return null;

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((prev) => Math.min(results.length - 1, prev + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((prev) => Math.max(0, prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) {
        onSelect?.(selected.path);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  };

  return (
    <div className="files-quick-open-overlay" onClick={onClose}>
      <div className="files-quick-open-modal" onClick={(event) => event.stopPropagation()}>
        <header className="files-quick-open-header">
          <strong>Quick Open</strong>
          <span>Ctrl+P · Esc to close</span>
        </header>

        <input
          className="files-quick-open-input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type filename or path..."
        />

        <div className="files-quick-open-results">
          {results.length === 0 ? (
            <div className="files-quick-open-empty">No matching files.</div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.path}
                type="button"
                className={`files-quick-open-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => onSelect?.(item.path)}
              >
                <span className="files-quick-open-path">{item.path}</span>
                {item.fromRecent ? <span className="files-quick-open-badge">Recent</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
