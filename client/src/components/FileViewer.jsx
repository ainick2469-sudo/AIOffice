import { useState, useEffect } from 'react';
import MessageContent from './MessageContent';

const EXT_LANG = {
  py: 'python', js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  json: 'json', md: 'markdown', css: 'css', html: 'html', sql: 'sql',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash', bat: 'batch',
};

export default function FileViewer() {
  const [tree, setTree] = useState([]);
  const [currentPath, setCurrentPath] = useState('.');
  const [pathStack, setPathStack] = useState(['.']);
  const [fileContent, setFileContent] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  const loadDir = (path) => {
    setLoading(true);
    fetch(`/api/files/tree?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => { setTree(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadDir(currentPath); }, [currentPath]);

  const openDir = (path) => {
    setFileContent(null);
    setCurrentPath(path);
    setPathStack(prev => [...prev, path]);
  };

  const goBack = () => {
    if (pathStack.length <= 1) return;
    const newStack = [...pathStack];
    newStack.pop();
    const prev = newStack[newStack.length - 1];
    setPathStack(newStack);
    setCurrentPath(prev);
    setFileContent(null);
  };

  const openFile = (item) => {
    setLoading(true);
    setFileName(item.name);
    fetch(`/api/files/read?path=${encodeURIComponent(item.path)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          const ext = item.name.split('.').pop();
          const lang = EXT_LANG[ext] || 'text';
          setFileContent({ content: data.content, lang });
        } else {
          setFileContent({ content: `Error: ${data.error}`, lang: 'text' });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

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
