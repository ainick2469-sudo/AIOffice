const FOLDER_ICON = '▸';
const OPEN_FOLDER_ICON = '▾';

const EXT_ICONS = {
  js: 'JS',
  jsx: 'JSX',
  ts: 'TS',
  tsx: 'TSX',
  py: 'PY',
  md: 'MD',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  yml: 'YML',
  yaml: 'YML',
};

function extIcon(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return EXT_ICONS[ext] || 'FILE';
}

function TreeNode({
  item,
  level,
  expandedDirs,
  loadingDirs,
  nodesByDir,
  activePath,
  onToggleDir,
  onOpenFile,
}) {
  const isDir = item.type === 'dir';
  const isExpanded = expandedDirs.has(item.path);
  const isLoading = Boolean(loadingDirs[item.path]);
  const childItems = nodesByDir[item.path] || [];

  return (
    <div className="files-tree-node-wrap">
      <button
        type="button"
        className={`files-tree-node ${activePath === item.path ? 'active' : ''} ${isDir ? 'dir' : 'file'}`}
        style={{ '--files-level': level }}
        onClick={() => (isDir ? onToggleDir?.(item.path) : onOpenFile?.(item.path))}
        title={item.path}
      >
        <span className="files-tree-caret">
          {isDir ? (isExpanded ? OPEN_FOLDER_ICON : FOLDER_ICON) : '·'}
        </span>
        <span className="files-tree-icon">{isDir ? 'DIR' : extIcon(item.name)}</span>
        <span className="files-tree-name">{item.name}</span>
      </button>

      {isDir && isExpanded ? (
        <div className="files-tree-children">
          {isLoading ? <div className="files-tree-loading">Loading…</div> : null}
          {!isLoading && childItems.length === 0 ? (
            <div className="files-tree-empty">Empty folder</div>
          ) : null}
          {!isLoading
            ? childItems.map((child) => (
                <TreeNode
                  key={child.path}
                  item={child}
                  level={level + 1}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  nodesByDir={nodesByDir}
                  activePath={activePath}
                  onToggleDir={onToggleDir}
                  onOpenFile={onOpenFile}
                />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

export default function FileTree({
  rootItems = [],
  expandedDirs = new Set(),
  loadingDirs = {},
  nodesByDir = {},
  activePath = '',
  onToggleDir,
  onOpenFile,
}) {
  if (!rootItems.length) {
    return <div className="files-tree-empty-root">No files loaded.</div>;
  }

  return (
    <div className="files-tree">
      {rootItems.map((item) => (
        <TreeNode
          key={item.path}
          item={item}
          level={0}
          expandedDirs={expandedDirs}
          loadingDirs={loadingDirs}
          nodesByDir={nodesByDir}
          activePath={activePath}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
