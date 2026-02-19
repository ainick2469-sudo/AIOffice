import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MessageContent from './MessageContent';
import SplitPane from './layout/SplitPane';
import FileTree from './files/FileTree';
import OpenTabsBar from './files/OpenTabsBar';
import QuickOpenModal from './files/QuickOpenModal';
import DiffViewer from './files/DiffViewer';
import RepoSearchPanel from './files/RepoSearchPanel';
import '../styles/files.css';

const TEXT_EXT = new Set([
  'py', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'css', 'html', 'sql',
  'yaml', 'yml', 'toml', 'sh', 'bat', 'txt', 'env', 'ini', 'xml', 'csv',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const BINARY_EXT = new Set(['exe', 'dll', 'zip', 'gz', '7z', 'pdf', 'woff', 'woff2', 'ttf']);

function extOf(path) {
  const name = String(path || '');
  const pieces = name.split('.');
  if (pieces.length < 2) return '';
  return pieces[pieces.length - 1].toLowerCase();
}

function languageFor(path) {
  const ext = extOf(path);
  const map = {
    py: 'python',
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    bat: 'batch',
    xml: 'xml',
  };
  return map[ext] || 'text';
}

function tabType(path, content) {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext === 'md') return 'markdown';
  if (BINARY_EXT.has(ext)) return 'binary';
  if (TEXT_EXT.has(ext)) return 'text';
  if (String(content || '').includes('\u0000')) return 'binary';
  return 'text';
}

function normalizeTreeItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.path)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
}

function storageKey(type, project, branch) {
  const safeProject = String(project || 'ai-office').trim().toLowerCase() || 'ai-office';
  const safeBranch = String(branch || 'main').trim().toLowerCase() || 'main';
  return `ai-office:files-v2:${type}:${safeProject}:${safeBranch}`;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function lineHighlights(text, query) {
  const source = String(text || '');
  const lines = source.split('\n');
  if (!query) {
    return lines.map((line) => escapeHtml(line));
  }
  const pattern = new RegExp(`(${escapeRegExp(query)})`, 'ig');
  return lines.map((line) => escapeHtml(line).replace(pattern, '<mark>$1</mark>'));
}

function copyText(value) {
  const text = String(value || '');
  if (!text) return Promise.resolve(false);
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function buildDiffText(before, after) {
  const left = String(before || '').split('\n');
  const right = String(after || '').split('\n');
  const total = Math.max(left.length, right.length);
  const lines = [];
  for (let index = 0; index < total; index += 1) {
    const a = left[index] ?? '';
    const b = right[index] ?? '';
    if (a === b) {
      lines.push(`  ${a}`);
    } else {
      if (a) lines.push(`- ${a}`);
      if (b) lines.push(`+ ${b}`);
    }
  }
  return lines.join('\n');
}

export default function FileViewer({
  channel = 'main',
  beginnerMode = false,
  openRequest = null,
  onOpenConsumed = null,
}) {
  const [projectCtx, setProjectCtx] = useState({ project: 'ai-office', branch: 'main' });
  const [nodesByDir, setNodesByDir] = useState({ '.': [] });
  const [loadingDirs, setLoadingDirs] = useState({});
  const [expandedDirs, setExpandedDirs] = useState(new Set(['.']));
  const [indexedFiles, setIndexedFiles] = useState([]);
  const [indexingFiles, setIndexingFiles] = useState(false);
  const [treeError, setTreeError] = useState('');

  const [openTabs, setOpenTabs] = useState([]);
  const [activePath, setActivePath] = useState('');
  const [viewMode, setViewMode] = useState('view');
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [editorMode, setEditorMode] = useState('read');
  const [treeRatio, setTreeRatio] = useState(0.28);

  const [inFileSearchOpen, setInFileSearchOpen] = useState(false);
  const [inFileQuery, setInFileQuery] = useState('');
  const [repoSearchOpen, setRepoSearchOpen] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState([]);
  const [copyNotice, setCopyNotice] = useState('');

  const viewerScrollRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollPositionsRef = useRef({});
  const indexingLockRef = useRef(false);

  const projectName = projectCtx.project || 'ai-office';
  const branchName = projectCtx.branch || 'main';
  const ratioKey = useMemo(() => storageKey('ratio', projectName, branchName), [projectName, branchName]);
  const recentKey = useMemo(() => storageKey('recent', projectName, branchName), [projectName, branchName]);

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.path === activePath) || null,
    [openTabs, activePath]
  );

  const rootItems = nodesByDir['.'] || [];

  const fetchDir = useCallback(
    async (path) => {
      const dirPath = String(path || '.');
      setLoadingDirs((prev) => ({ ...prev, [dirPath]: true }));
      try {
        const response = await fetch(
          `/api/files/tree?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(dirPath)}`
        );
        const payload = response.ok ? await response.json() : [];
        const normalized = normalizeTreeItems(payload);
        setNodesByDir((prev) => ({ ...prev, [dirPath]: normalized }));
        setTreeError('');
        return normalized;
      } catch {
        setTreeError('Unable to load file tree right now.');
        return [];
      } finally {
        setLoadingDirs((prev) => ({ ...prev, [dirPath]: false }));
      }
    },
    [channel]
  );

  const loadProjectContext = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/active/${encodeURIComponent(channel)}`);
      const payload = response.ok ? await response.json() : {};
      setProjectCtx({
        project: String(payload?.project || 'ai-office').trim() || 'ai-office',
        branch: String(payload?.branch || 'main').trim() || 'main',
      });
    } catch {
      setProjectCtx({ project: 'ai-office', branch: 'main' });
    }
  }, [channel]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNodesByDir({ '.': [] });
      setExpandedDirs(new Set(['.']));
      setIndexedFiles([]);
      setOpenTabs([]);
      setActivePath('');
      setViewMode('view');
      setMarkdownPreview(false);
      setEditorMode('read');
      setInFileSearchOpen(false);
      setInFileQuery('');
      setRepoSearchOpen(false);
      setRepoSearchQuery('');
      setQuickOpenOpen(false);
      setCopyNotice('');
      loadProjectContext();
      fetchDir('.');
    }, 0);
    return () => clearTimeout(timer);
  }, [channel, loadProjectContext, fetchDir]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const storedRatio = Number(localStorage.getItem(ratioKey));
      if (Number.isFinite(storedRatio) && storedRatio > 0.15 && storedRatio < 0.6) {
        setTreeRatio(storedRatio);
      } else {
        setTreeRatio(0.28);
      }
      const rawRecent = localStorage.getItem(recentKey);
      if (rawRecent) {
        try {
          const parsed = JSON.parse(rawRecent);
          if (Array.isArray(parsed)) {
            setRecentFiles(parsed.slice(0, 10).map((value) => String(value)));
          } else {
            setRecentFiles([]);
          }
        } catch {
          setRecentFiles([]);
        }
      } else {
        setRecentFiles([]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [ratioKey, recentKey]);

  useEffect(() => {
    localStorage.setItem(ratioKey, String(treeRatio));
  }, [treeRatio, ratioKey]);

  const rememberRecent = useCallback((path) => {
    const value = String(path || '').trim();
    if (!value) return;
    setRecentFiles((prev) => {
      const next = [value, ...prev.filter((entry) => entry !== value)].slice(0, 10);
      localStorage.setItem(recentKey, JSON.stringify(next));
      return next;
    });
  }, [recentKey]);

  const ensureIndexedFiles = useCallback(async () => {
    if (indexingLockRef.current) return;
    indexingLockRef.current = true;
    setIndexingFiles(true);
    const queue = ['.'];
    const visited = new Set();
    const collected = [];

    try {
      while (queue.length > 0 && collected.length < 4000 && visited.size < 900) {
        const dirPath = queue.shift();
        if (!dirPath || visited.has(dirPath)) continue;
        visited.add(dirPath);

        let children = nodesByDir[dirPath];
        if (!Array.isArray(children)) {
          children = await fetchDir(dirPath);
        }

        (children || []).forEach((item) => {
          if (item.type === 'dir') {
            queue.push(item.path);
          } else {
            collected.push({ path: item.path, name: item.name });
          }
        });
      }
      setIndexedFiles(collected);
    } finally {
      setIndexingFiles(false);
      indexingLockRef.current = false;
    }
  }, [nodesByDir, fetchDir]);

  const openFilePath = useCallback(
    async (path, line = null) => {
      const filePath = String(path || '').trim();
      if (!filePath) return;

      const exists = openTabs.find((tab) => tab.path === filePath);
      if (exists) {
        setActivePath(filePath);
        rememberRecent(filePath);
        if (line && Number.isFinite(line) && line > 0) {
          setTimeout(() => {
            const nextTop = Math.max(0, (line - 3) * 20);
            scrollPositionsRef.current[filePath] = nextTop;
            if (viewerScrollRef.current) viewerScrollRef.current.scrollTop = nextTop;
            if (textareaRef.current) textareaRef.current.scrollTop = nextTop;
          }, 0);
        }
        return;
      }

      try {
        const response = await fetch(
          `/api/files/read?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(filePath)}`
        );
        const payload = response.ok ? await response.json() : { ok: false, error: 'File read failed.' };
        const fileText = payload?.ok ? String(payload.content || '') : '';
        const kind = tabType(filePath, fileText);
        const tab = {
          path: filePath,
          name: filePath.split('/').pop() || filePath,
          lang: languageFor(filePath),
          type: kind,
          content: fileText,
          baseline: payload?.ok ? fileText : '',
          dirty: false,
          error: payload?.ok ? '' : String(payload?.error || 'Unable to load file content.'),
          imageSrc:
            kind === 'image'
              ? (fileText.startsWith('data:image/')
                  ? fileText
                  : extOf(filePath) === 'svg' && fileText.includes('<svg')
                    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fileText)}`
                    : '')
              : '',
        };

        setOpenTabs((prev) => [...prev, tab]);
        setActivePath(filePath);
        rememberRecent(filePath);

        if (line && Number.isFinite(line) && line > 0) {
          const nextTop = Math.max(0, (line - 3) * 20);
          scrollPositionsRef.current[filePath] = nextTop;
        }
      } catch {
        const failedTab = {
          path: filePath,
          name: filePath.split('/').pop() || filePath,
          lang: 'text',
          type: 'text',
          content: '',
          baseline: '',
          dirty: false,
          error: 'Unable to load file content.',
          imageSrc: '',
        };
        setOpenTabs((prev) => [...prev, failedTab]);
        setActivePath(filePath);
      }
    },
    [channel, openTabs, rememberRecent]
  );

  const expandToFilePath = useCallback(
    async (path) => {
      const parts = String(path || '').split('/').filter(Boolean);
      if (parts.length <= 1) return;
      let current = '.';
      for (let index = 0; index < parts.length - 1; index += 1) {
        current = current === '.' ? parts[index] : `${current}/${parts[index]}`;
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.add(current);
          return next;
        });
        if (!nodesByDir[current]) {
          await fetchDir(current);
        }
      }
    },
    [nodesByDir, fetchDir]
  );

  const openFile = useCallback(
    async (path, line = null) => {
      await expandToFilePath(path);
      await openFilePath(path, line);
    },
    [expandToFilePath, openFilePath]
  );

  const toggleDir = async (path) => {
    const dirPath = String(path || '.');
    const expanded = expandedDirs.has(dirPath);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (expanded) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
    if (!expanded && !nodesByDir[dirPath]) {
      await fetchDir(dirPath);
    }
  };

  const closeTab = (path) => {
    const filePath = String(path || '');
    setOpenTabs((prev) => {
      const remaining = prev.filter((tab) => tab.path !== filePath);
      if (activePath === filePath) {
        setActivePath(remaining.length ? remaining[remaining.length - 1].path : '');
      }
      return remaining;
    });
  };

  const setActiveTabContent = (nextContent) => {
    if (!activeTab) return;
    const value = String(nextContent || '');
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.path === activeTab.path
          ? { ...tab, content: value, dirty: value !== tab.baseline }
          : tab
      )
    );
  };

  const revertBaseline = () => {
    if (!activeTab || activeTab.baseline === undefined || activeTab.baseline === null) return;
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.path === activeTab.path
          ? { ...tab, content: tab.baseline, dirty: false }
          : tab
      )
    );
  };

  useEffect(() => {
    const req = openRequest;
    if (!req || !req.path) return;
    openFile(req.path, req.line ? Number(req.line) : null);
    onOpenConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  useEffect(() => {
    if (!activePath) return;
    const timer = setTimeout(() => {
      const y = scrollPositionsRef.current[activePath] || 0;
      if (viewerScrollRef.current) viewerScrollRef.current.scrollTop = y;
      if (textareaRef.current) textareaRef.current.scrollTop = y;
    }, 0);
    return () => clearTimeout(timer);
  }, [activePath, editorMode, viewMode]);

  useEffect(() => {
    if (!activePath) return;
    window.dispatchEvent(new CustomEvent('chat-context:add', {
      detail: {
        id: `file:${activePath}`,
        type: 'file',
        label: activePath,
        value: activePath,
      },
    }));
  }, [activePath]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.ctrlKey) return;
      const key = String(event.key || '').toLowerCase();

      if (key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        setQuickOpenOpen(true);
        ensureIndexedFiles();
        return;
      }

      if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        setRepoSearchOpen(true);
        ensureIndexedFiles();
        return;
      }

      if (key === 'f') {
        if (isTypingTarget(event.target) && event.target !== textareaRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        setInFileSearchOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [ensureIndexedFiles]);

  useEffect(() => {
    if (!copyNotice) return undefined;
    const timer = setTimeout(() => setCopyNotice(''), 1800);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  const highlightedLines = useMemo(
    () => lineHighlights(activeTab?.content || '', inFileQuery.trim()),
    [activeTab?.content, inFileQuery]
  );

  const inFileMatchCount = useMemo(() => {
    if (!activeTab?.content || !inFileQuery.trim()) return 0;
    const pattern = new RegExp(escapeRegExp(inFileQuery.trim()), 'ig');
    const matches = activeTab.content.match(pattern);
    return matches ? matches.length : 0;
  }, [activeTab?.content, inFileQuery]);

  const repoFileMatches = useMemo(() => {
    const query = repoSearchQuery.trim().toLowerCase();
    if (!query) return indexedFiles.slice(0, 80);
    return indexedFiles
      .filter((item) => item.path.toLowerCase().includes(query))
      .slice(0, 120);
  }, [indexedFiles, repoSearchQuery]);

  const repoContentMatches = useMemo(() => {
    const query = repoSearchQuery.trim().toLowerCase();
    if (!query) return [];
    const matches = [];
    openTabs.forEach((tab) => {
      if (tab.type !== 'text' && tab.type !== 'markdown') return;
      const lines = String(tab.content || '').split('\n');
      lines.forEach((line, index) => {
        if (matches.length >= 120) return;
        if (line.toLowerCase().includes(query)) {
          matches.push({
            path: tab.path,
            line: index + 1,
            preview: line.trim().slice(0, 180),
          });
        }
      });
    });
    return matches;
  }, [openTabs, repoSearchQuery]);

  const diffText = useMemo(
    () => (activeTab ? buildDiffText(activeTab.baseline, activeTab.content) : ''),
    [activeTab]
  );

  const hasProject = Boolean(projectName && projectName !== 'none');
  const hasOpenFile = Boolean(activeTab);
  const baselineAvailable = Boolean(!activeTab?.error && (activeTab?.baseline || activeTab?.baseline === ''));

  return (
    <section className="panel files-v2-shell">
      <header className="panel-header files-v2-header">
        <div className="files-v2-title">
          <h3>Files</h3>
          <p>
            Project: <strong>{projectName}</strong> · Branch: <strong>{branchName}</strong>
          </p>
        </div>

        <div className="files-v2-actions">
          <div className="files-v2-view-toggle" role="tablist" aria-label="File view mode">
            <button
              type="button"
              className={`ui-btn ${viewMode === 'view' ? 'ui-btn-primary' : ''}`}
              onClick={() => setViewMode('view')}
            >
              View
            </button>
            <button
              type="button"
              className={`ui-btn ${viewMode === 'diff' ? 'ui-btn-primary' : ''}`}
              onClick={() => setViewMode('diff')}
            >
              Diff
            </button>
          </div>
          <button type="button" className="ui-btn" onClick={() => ensureIndexedFiles()}>
            Refresh Index
          </button>
          <button type="button" className="ui-btn" onClick={() => fetchDir('.')}>
            Refresh Tree
          </button>
          <details className="files-info-popover">
            <summary>Info</summary>
            <div>
              <p>Use the tree on the left to browse files and Ctrl+P for quick open.</p>
              <p>Tabs keep your place, and Ctrl+F searches the current file.</p>
              <p>Switch to Diff mode to compare baseline vs in-memory edits safely.</p>
            </div>
          </details>
        </div>
      </header>

      <OpenTabsBar
        tabs={openTabs}
        activePath={activePath}
        onSelectTab={setActivePath}
        onCloseTab={closeTab}
      />

      {inFileSearchOpen ? (
        <div className="files-inline-search">
          <input
            autoFocus
            type="text"
            value={inFileQuery}
            onChange={(event) => setInFileQuery(event.target.value)}
            placeholder="Search in file (Ctrl+F)"
          />
          <span>{inFileMatchCount} matches</span>
          <button type="button" className="ui-btn" onClick={() => setInFileSearchOpen(false)}>
            Close
          </button>
        </div>
      ) : null}

      <div className="files-v2-content">
        <SplitPane
          direction="vertical"
          ratio={treeRatio}
          defaultRatio={0.28}
          minPrimary={240}
          minSecondary={420}
          onRatioChange={setTreeRatio}
        >
          <div className="files-tree-panel">
            {!hasProject ? (
              <div className="files-empty-state">
                <h4>No project loaded</h4>
                <p>Select a project in the sidebar to browse files.</p>
              </div>
            ) : (
              <FileTree
                rootItems={rootItems}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                nodesByDir={nodesByDir}
                activePath={activePath}
                onToggleDir={toggleDir}
                onOpenFile={openFile}
              />
            )}
            {treeError ? <div className="files-tree-error">{treeError}</div> : null}
          </div>

          <div className="files-editor-panel">
            {!hasOpenFile ? (
              <div className="files-empty-state">
                <h4>{beginnerMode ? 'Choose a file to inspect' : 'No file selected'}</h4>
                <p>
                  {beginnerMode
                    ? `Press Ctrl+P or use Quick Open to jump to a file under ${projectName}.`
                    : 'Pick a file from the tree or press Ctrl+P to jump to one instantly.'}
                </p>
                <div className="beginner-empty-actions">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => {
                      ensureIndexedFiles();
                      setQuickOpenOpen(true);
                    }}
                  >
                    Open Quick Open
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="files-editor-header">
                  <div className="files-editor-path">
                    <strong>{activeTab.path}</strong>
                    {activeTab.dirty ? <span className="files-editor-dirty">Modified in memory</span> : null}
                  </div>
                  <div className="files-editor-actions">
                    {(activeTab.type === 'text' || activeTab.type === 'markdown') && (
                      <button
                        type="button"
                        className="ui-btn"
                        onClick={() => setEditorMode((prev) => (prev === 'edit' ? 'read' : 'edit'))}
                      >
                        {editorMode === 'edit' ? 'Read mode' : 'Edit mode'}
                      </button>
                    )}
                    {activeTab.type === 'markdown' && viewMode === 'view' && editorMode === 'read' && (
                      <button
                        type="button"
                        className="ui-btn"
                        onClick={() => setMarkdownPreview((prev) => !prev)}
                      >
                        {markdownPreview ? 'Raw Markdown' : 'Markdown Preview'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={() =>
                        copyText(activeTab.path).then((ok) => setCopyNotice(ok ? 'Path copied' : 'Copy failed'))
                      }
                    >
                      Copy Path
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      onClick={() =>
                        copyText(activeTab.content).then((ok) => setCopyNotice(ok ? 'Content copied' : 'Copy failed'))
                      }
                    >
                      Copy Content
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      disabled
                      title="Reveal in explorer is not available in this build."
                    >
                      Reveal
                    </button>
                  </div>
                </div>

                {copyNotice ? <div className="files-copy-notice">{copyNotice}</div> : null}

                {viewMode === 'diff' ? (
                  <>
                    <div className="files-diff-actions">
                      <button
                        type="button"
                        className="ui-btn"
                        onClick={() => copyText(diffText).then((ok) => setCopyNotice(ok ? 'Diff copied' : 'Copy failed'))}
                      >
                        Copy diff
                      </button>
                      <button
                        type="button"
                        className="ui-btn"
                        onClick={revertBaseline}
                        disabled={!activeTab.dirty || !baselineAvailable}
                        title={!baselineAvailable ? 'Baseline not available for this file.' : ''}
                      >
                        Revert to baseline
                      </button>
                    </div>
                    <DiffViewer
                      before={activeTab.baseline}
                      after={activeTab.content}
                      baselineAvailable={baselineAvailable}
                    />
                  </>
                ) : (
                  <>
                    {activeTab.error ? (
                      <div className="files-empty-state">
                        <h4>File content not available</h4>
                        <p>{activeTab.error}</p>
                      </div>
                    ) : null}

                    {!activeTab.error && activeTab.type === 'binary' ? (
                      <div className="files-empty-state">
                        <h4>Preview not supported</h4>
                        <p>This file looks binary. Use external tools to inspect it safely.</p>
                      </div>
                    ) : null}

                    {!activeTab.error && activeTab.type === 'image' ? (
                      activeTab.imageSrc ? (
                        <div className="files-image-preview">
                          <img src={activeTab.imageSrc} alt={activeTab.name} />
                        </div>
                      ) : (
                        <div className="files-empty-state">
                          <h4>Image preview unavailable</h4>
                          <p>The current API returned no embeddable image content for this file.</p>
                        </div>
                      )
                    ) : null}

                    {!activeTab.error && (activeTab.type === 'text' || activeTab.type === 'markdown') ? (
                      markdownPreview && activeTab.type === 'markdown' && editorMode === 'read' ? (
                        <div className="files-markdown-preview">
                          <MessageContent content={activeTab.content} />
                        </div>
                      ) : editorMode === 'edit' ? (
                        <div className="files-editor-code-wrap">
                          <div className="files-code-gutter">
                            {String(activeTab.content || '')
                              .split('\n')
                              .map((_, index) => (
                                <span key={`edit-ln-${index + 1}`}>{index + 1}</span>
                              ))}
                          </div>
                          <textarea
                            ref={textareaRef}
                            className="files-code-editor"
                            value={activeTab.content}
                            onScroll={(event) => {
                              scrollPositionsRef.current[activeTab.path] = event.currentTarget.scrollTop;
                            }}
                            onChange={(event) => setActiveTabContent(event.target.value)}
                          />
                        </div>
                      ) : (
                        <div
                          ref={viewerScrollRef}
                          className="files-code-view"
                          onScroll={(event) => {
                            scrollPositionsRef.current[activeTab.path] = event.currentTarget.scrollTop;
                          }}
                        >
                          <div className="files-code-gutter">
                            {highlightedLines.map((_, index) => (
                              <span key={`ln-${index + 1}`}>{index + 1}</span>
                            ))}
                          </div>
                          <div className="files-code-content">
                            {highlightedLines.map((lineHtml, index) => (
                              <div
                                key={`code-${index + 1}`}
                                className="files-code-line"
                                dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        </SplitPane>
      </div>

      <QuickOpenModal
        open={quickOpenOpen}
        files={indexedFiles}
        recentFiles={recentFiles}
        onClose={() => setQuickOpenOpen(false)}
        onSelect={(path) => {
          setQuickOpenOpen(false);
          openFile(path);
        }}
      />

      <RepoSearchPanel
        open={repoSearchOpen}
        query={repoSearchQuery}
        onQueryChange={setRepoSearchQuery}
        fileMatches={repoFileMatches}
        contentMatches={repoContentMatches}
        indexing={indexingFiles}
        onOpenFile={(path) => {
          openFile(path);
          setRepoSearchOpen(false);
        }}
        onClose={() => setRepoSearchOpen(false)}
      />
    </section>
  );
}
