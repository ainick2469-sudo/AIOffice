import { useMemo, useState } from 'react';
import ChatRoom from './ChatRoom';
import FileViewer from './FileViewer';
import TaskBoard from './TaskBoard';
import SpecPanel from './SpecPanel';
import PreviewPanel from './PreviewPanel';
import GitPanel from './GitPanel';
import LayoutPresetToggle from './LayoutPresetToggle';
import PaneSplit from './PaneSplit';

const TABS = [
  { id: 'builder', label: 'Builder' },
  { id: 'chat', label: 'Chat' },
  { id: 'files', label: 'Files' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'spec', label: 'Spec' },
  { id: 'preview', label: 'Preview' },
  { id: 'git', label: 'Git' },
];

const DEFAULT_PANE_LAYOUTS = {
  'full-ide': [0.28, 0.4, 0.32],
  'chat-files': [0.45, 0.55],
  'chat-preview': [0.45, 0.55],
};

function ratioForPreset(preset, paneLayout) {
  const fallback = DEFAULT_PANE_LAYOUTS[preset];
  if (!fallback) return null;
  const raw = paneLayout?.[preset];
  if (!Array.isArray(raw) || raw.length !== fallback.length) return fallback;
  const parsed = raw.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (parsed.length !== fallback.length) return fallback;
  const sum = parsed.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return fallback;
  return parsed.map((value) => value / sum);
}

function BuilderSplit({ channel, layoutPreset, paneLayout = {}, onPaneLayoutChange }) {
  if (layoutPreset === 'chat-preview') {
    const ratios = ratioForPreset('chat-preview', paneLayout);
    return (
      <PaneSplit
        className="workspace-split two"
        ratios={ratios}
        minRatio={0.22}
        onCommit={(nextRatios) => onPaneLayoutChange?.('chat-preview', nextRatios)}
      >
        <div className="workspace-pane"><ChatRoom channel={channel} showStatusPanel={false} /></div>
        <div className="workspace-pane"><PreviewPanel channel={channel} /></div>
      </PaneSplit>
    );
  }
  if (layoutPreset === 'chat-files') {
    const ratios = ratioForPreset('chat-files', paneLayout);
    return (
      <PaneSplit
        className="workspace-split two"
        ratios={ratios}
        minRatio={0.22}
        onCommit={(nextRatios) => onPaneLayoutChange?.('chat-files', nextRatios)}
      >
        <div className="workspace-pane"><ChatRoom channel={channel} showStatusPanel={false} /></div>
        <div className="workspace-pane"><FileViewer channel={channel} /></div>
      </PaneSplit>
    );
  }
  if (layoutPreset === 'focus') {
    return (
      <div className="workspace-split one">
        <div className="workspace-pane"><PreviewPanel channel={channel} /></div>
      </div>
    );
  }
  const ratios = ratioForPreset('full-ide', paneLayout);
  return (
    <PaneSplit
      className="workspace-split three"
      ratios={ratios}
      minRatio={0.16}
      onCommit={(nextRatios) => onPaneLayoutChange?.('full-ide', nextRatios)}
    >
      <div className="workspace-pane"><ChatRoom channel={channel} showStatusPanel={false} /></div>
      <div className="workspace-pane"><FileViewer channel={channel} /></div>
      <div className="workspace-pane"><PreviewPanel channel={channel} /></div>
    </PaneSplit>
  );
}

export default function WorkspaceShell({
  channel,
  projectName,
  branch,
  layoutPreset = 'full-ide',
  onLayoutPresetChange,
  paneLayout = DEFAULT_PANE_LAYOUTS,
  onPaneLayoutChange,
  previewFocus = false,
  activeTab = null,
  onActiveTabChange,
  ingestionProgress = null,
}) {
  const [internalTab, setInternalTab] = useState('builder');
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const tab = activeTab || internalTab;
  const setTab = onActiveTabChange || setInternalTab;
  const safePaneLayout = useMemo(() => ({ ...DEFAULT_PANE_LAYOUTS, ...(paneLayout || {}) }), [paneLayout]);

  if (previewFocus) {
    return (
      <div className="workspace-focus-mode">
        <div className="workspace-focus-header">
          <div>
            <strong>{projectName}</strong> @ {branch || 'main'}
          </div>
          <button className="refresh-btn" onClick={() => setChatDrawerOpen((prev) => !prev)}>
            {chatDrawerOpen ? 'Hide Chat' : 'Show Chat'}
          </button>
        </div>
        <div className="workspace-focus-preview">
          <PreviewPanel channel={channel} />
        </div>
        {chatDrawerOpen && (
          <div className="workspace-focus-chat">
            <ChatRoom
              channel={channel}
              showStatusPanel={false}
              onBackToWorkspace={() => setChatDrawerOpen(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <div className="workspace-shell-header">
        <div className="workspace-shell-meta">
          <strong>{projectName}</strong> @ {branch || 'main'}
        </div>
        <LayoutPresetToggle
          value={layoutPreset}
          onChange={onLayoutPresetChange}
          onReset={() => onPaneLayoutChange?.(layoutPreset, DEFAULT_PANE_LAYOUTS[layoutPreset] || [])}
        />
      </div>
      <div className="workspace-tab-row">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`workspace-tab-btn ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {ingestionProgress && (
        <div className="workspace-ingestion-banner">
          Ingestion: {ingestionProgress.done}/{ingestionProgress.total} tasks complete
          {ingestionProgress.status === 'complete' ? ' (ready)' : ' (processing...)'}
        </div>
      )}

      <div className="workspace-shell-body">
        {tab === 'builder' && (
          <BuilderSplit
            channel={channel}
            layoutPreset={layoutPreset}
            paneLayout={safePaneLayout}
            onPaneLayoutChange={onPaneLayoutChange}
          />
        )}
        {tab === 'chat' && (
          <ChatRoom
            channel={channel}
            onBackToWorkspace={() => setTab('builder')}
          />
        )}
        {tab === 'files' && <FileViewer channel={channel} />}
        {tab === 'tasks' && <TaskBoard channel={channel} />}
        {tab === 'spec' && <SpecPanel channel={channel} />}
        {tab === 'preview' && <PreviewPanel channel={channel} />}
        {tab === 'git' && <GitPanel channel={channel} />}
      </div>
    </div>
  );
}
