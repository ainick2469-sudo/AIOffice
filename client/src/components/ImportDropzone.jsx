import { useRef, useState } from 'react';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function rootFolder(entries) {
  const first = entries[0]?.path || '';
  if (!first.includes('/')) return '';
  return first.split('/')[0];
}

function toEntries(files) {
  return Array.from(files || []).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

function queueFromFiles(files) {
  const entries = toEntries(files);
  if (entries.length === 0) return null;

  if (entries.length === 1 && String(entries[0].path || '').toLowerCase().endsWith('.zip')) {
    const only = entries[0];
    return {
      id: makeId(),
      kind: 'zip',
      name: only.file.name,
      entries,
      count: 1,
      bytes: only.file.size || 0,
      summary: `Zip archive (${formatBytes(only.file.size || 0)})`,
    };
  }

  const folder = rootFolder(entries);
  const bytes = entries.reduce((acc, item) => acc + (item.file.size || 0), 0);
  if (folder) {
    return {
      id: makeId(),
      kind: 'folder',
      name: folder,
      entries,
      count: entries.length,
      bytes,
      summary: `${entries.length} files (${formatBytes(bytes)})`,
    };
  }

  return {
    id: makeId(),
    kind: 'files',
    name: `${entries.length} files`,
    entries,
    count: entries.length,
    bytes,
    summary: `${entries.length} files (${formatBytes(bytes)})`,
  };
}

export default function ImportDropzone({
  queuedItems = [],
  onQueueChange,
  disabled = false,
  open = false,
  onToggleOpen,
}) {
  const zipInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const pushQueueItem = (item) => {
    if (!item) return;
    onQueueChange?.([...(queuedItems || []), item]);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (disabled) return;
    const item = queueFromFiles(event.dataTransfer?.files || []);
    if (item) pushQueueItem(item);
  };

  const handleZipPick = (event) => {
    if (disabled) return;
    const item = queueFromFiles(event.target.files || []);
    if (item) pushQueueItem(item);
    event.target.value = '';
  };

  const handleFolderPick = (event) => {
    if (disabled) return;
    const item = queueFromFiles(event.target.files || []);
    if (item) pushQueueItem(item);
    event.target.value = '';
  };

  const removeItem = (id) => {
    onQueueChange?.((queuedItems || []).filter((item) => item.id !== id));
  };

  const clearAll = () => {
    onQueueChange?.([]);
  };

  return (
    <section className={`import-dropzone-wizard ${dragActive ? 'active' : ''} ${disabled ? 'disabled' : ''} ${open ? 'expanded' : 'collapsed'}`}>
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        onChange={handleZipPick}
        className="hidden-file-input"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        webkitdirectory="true"
        directory="true"
        onChange={handleFolderPick}
        className="hidden-file-input"
      />

      <div className="import-dropzone-top">
        <div>
          <h4>Import Existing Project</h4>
          <p>Use this when you already have code and want AI Office to understand it.</p>
        </div>
        <button
          type="button"
          className="refresh-btn ui-btn"
          disabled={disabled}
          onClick={() => onToggleOpen?.(!open)}
        >
          {open ? 'Hide Import' : `Import existing project${queuedItems.length ? ` (${queuedItems.length})` : ''}`}
        </button>
      </div>

      {open ? (
        <div
          className="import-dropzone-hitarea"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) setDragActive(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <h5>Drop zip or folder here</h5>
          <p>Supported: <code>.zip</code>, project folders, or selected files. Imported items appear in Review.</p>
          <div className="import-dropzone-actions">
            <button type="button" className="refresh-btn ui-btn" disabled={disabled} onClick={() => zipInputRef.current?.click()}>
              Choose Zip
            </button>
            <button type="button" className="refresh-btn ui-btn" disabled={disabled} onClick={() => folderInputRef.current?.click()}>
              Choose Folder
            </button>
            <button type="button" className="refresh-btn ui-btn" disabled={disabled || queuedItems.length === 0} onClick={clearAll}>
              Clear Queue
            </button>
          </div>
        </div>
      ) : (
        <div className="import-dropzone-collapsed-hint">
          <span>Keep this closed for new projects. Open it when importing existing code.</span>
        </div>
      )}

      <div className="import-queue-list">
        {queuedItems.length === 0 && open && <div className="import-queue-empty">Nothing queued yet.</div>}
        {queuedItems.map((item) => (
          <article key={item.id} className="import-queue-item">
            <div className="import-queue-item-main">
              <div className="import-queue-item-title">{item.name}</div>
              <div className="import-queue-item-meta">
                <span className="ui-chip">{item.kind.toUpperCase()}</span>
                <span>{item.summary}</span>
              </div>
            </div>
            <button
              type="button"
              className="msg-action-btn ui-btn"
              disabled={disabled}
              onClick={() => removeItem(item.id)}
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
