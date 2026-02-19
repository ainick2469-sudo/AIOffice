import { useEffect, useMemo, useState } from 'react';
import useBodyScrollLock from '../hooks/useBodyScrollLock';

function matches(command, query) {
  if (!query) return true;
  const haystack = `${command.label || ''} ${command.subtitle || ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export default function CommandPalette({ open = false, mode = 'default', commands = [], onClose }) {
  const [query, setQuery] = useState(mode === 'files' ? 'open files' : '');
  const [cursor, setCursor] = useState(0);

  useBodyScrollLock(Boolean(open), 'command-palette');

  const filtered = useMemo(() => {
    const items = (commands || []).filter((item) => matches(item, query));
    return items.slice(0, 100);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((prev) => Math.min(filtered.length - 1, prev + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = filtered[cursor];
        if (!selected) return;
        selected.run?.();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, cursor, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onResetUi = () => onClose?.();
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => window.removeEventListener('ai-office:reset-ui-state', onResetUi);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={() => onClose?.()}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-header">
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            placeholder={mode === 'files' ? 'Search files/actions…' : 'Type a command…'}
          />
        </div>
        <div className="command-palette-list">
          {filtered.length === 0 && <div className="command-palette-empty">No commands found.</div>}
          {filtered.map((item, index) => (
            <button
              key={item.id || `${item.label}-${index}`}
              className={`command-palette-item ${cursor === index ? 'active' : ''}`}
              onClick={() => {
                item.run?.();
                onClose?.();
              }}
            >
              <div className="command-palette-label">{item.label}</div>
              {item.subtitle && <div className="command-palette-subtitle">{item.subtitle}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
