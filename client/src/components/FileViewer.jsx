import { useCallback, useEffect, useState } from 'react';
import MessageContent from './MessageContent';

const EXT_LANG = {
  py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', md: 'markdown', css: 'css', html: 'html', sql: 'sql',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash', bat: 'batch',
};

export default function FileViewer({
  channel = 'main',
  openRequest = null,
  onOpenConsumed = null,
}) {
  const [tree, setTree] = useState([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [pathStack, setPathStack] = useState(['.']);
  const [fileContent, setFileContent] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchDirectory = useCallback((path) =>
    fetch(`/api/files/tree?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(path)}`)
      .then(r => r.json()), [channel]);

  const loadDir = useCallback((path) => {
    setLoading(true);
    fetchDirectory(path)
      .then((data) => {
        setTree(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoading(false));
  }, [fetchDirectory]);

  useEffect(() => {
    // Reset navigation when switching channels so we don't mix project roots.
    setCurrentPath('.');
    setPathStack(['.']);
    setFileContent(null);
    setFileName('');
  }, [channel]);

  useEffect(() => {
    let cancelled = false;
    fetchDirectory(currentPath)
      .then((data) => {
        if (cancelled) return;
        setTree(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, fetchDirectory]);

  const openDir = (path) => {
    setFileContent(null);
    setLoading(true);
    setCurrentPath(path);
    setPathStack(prev => [...prev, path]);
  };

  const goBack = () => {
    if (pathStack.length <= 1) return;
    const newStack = [...pathStack];
    newStack.pop();
    const prev = newStack[newStack.length - 1];
    setPathStack(newStack);
    setLoading(true);
    setCurrentPath(prev);
    setFileContent(null);
  };

  const openFilePath = (path, line = null) => {
    setLoading(true);
    setFileName(line ? `${path}:${line}` : path);
    fetch(`/api/files/read?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          const ext = path.split('.').pop();
          const lang = EXT_LANG[ext] || 'text';
          const content = data.content || '';
          if (line && Number.isFinite(line) && line > 0) {
            const lines = content.split('\n');
            const center = Math.max(1, Math.min(lines.length, line));
            const start = Math.max(1, center - 20);
            const end = Math.min(lines.length, center + 20);
            const snippet = lines.slice(start - 1, end).map((txt, idx) => {
              const ln = start + idx;
              const marker = ln === center ? '>>' : '  ';
              return `${marker} ${String(ln).padStart(4, '0')}: ${txt}`;
            }).join('\n');
            setFileContent({ content: snippet, lang: 'text' });
          } else {
            setFileContent({ content, lang });
          }
        } else {
          setFileContent({ content: `Error: ${data.error}`, lang: 'text' });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const openFile = (item) => {
    openFilePath(item.path, null);
  };

  useEffect(() => {
    const req = openRequest;
    if (!req || !req.path) return;

    const path = String(req.path);
    const line = req.line ? Number(req.line) : null;
    const dir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '.';
    if (dir && dir !== currentPath) {
      setCurrentPath(dir || '.');
      setPathStack(dir && dir !== '.' ? ['.', dir] : ['.']);
    }

    openFilePath(path, line);
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const getIcon = (item) => {
    if (item.type === 'dir') return '📁';
    const ext = item.name.split('.').pop();
    const icons = { py: '🐍', js: '📜', jsx: '⚛️', json: '📋', md: '📝', css: '🎨', html: '🌐', sql: '🗄️' };
    return icons[ext] || '📄';
  };

  return (
    <div className="panel file-viewer">
      <div className="panel-header">
        <div className="fv-nav">
          <button className="fv-back" onClick={goBack} disabled={pathStack.length <= 1}>←</button>
          <span className="fv-path">/{currentPath === '.' ? '' : currentPath}</span>
        </div>
        <button className="refresh-btn" onClick={() => loadDir(currentPath)}>↻ Refresh</button>
      </div>

      <div className="fv-content">
        <div className="fv-tree">
          {loading && !fileContent && <div className="fv-loading">Loading...</div>}
          {tree.map(item => (
            <div
              key={item.path}
              className={`fv-item ${item.type}`}
              onClick={() => item.type === 'dir' ? openDir(item.path) : openFile(item)}
            >
              <span className="fv-icon">{getIcon(item)}</span>
              <span className="fv-name">{item.name}</span>
              {item.size !== null && <span className="fv-size">{formatSize(item.size)}</span>}
            </div>
          ))}
          {!loading && tree.length === 0 && <div className="fv-empty">Empty directory</div>}
        </div>

        {fileContent && (
          <div className="fv-preview">
            <div className="fv-preview-header">
              <span>{fileName}</span>
              <button onClick={() => setFileContent(null)}>✕</button>
            </div>
            <div className="fv-preview-body">
              <MessageContent content={'```' + fileContent.lang + '\n' + fileContent.content + '\n```'} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
