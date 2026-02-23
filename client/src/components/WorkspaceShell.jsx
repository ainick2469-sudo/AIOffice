import { useCallback, useEffect, useMemo, useState } from 'react';
import ChatRoom from './ChatRoom';
import FileViewer from './FileViewer';
import TaskBoard from './TaskBoard';
import SpecPanel from './SpecPanel';
import PreviewPanel from './PreviewPanel';
import GitPanel from './GitPanel';
import ConsolePanel from './ConsolePanel';
import SplitPane from './layout/SplitPane';
import ActivityBar from './ActivityBar';
import HelpPopover from './beginner/HelpPopover';
import WorkspaceToolbar from './WorkspaceToolbar';
import { useBeginnerMode } from './beginner/BeginnerModeContext';

const BUILD_LAYOUT_OPTIONS = [
  { id: 'split', label: 'Split' },
  { id: 'full-ide', label: 'Full IDE' },
];

const ACTIVITY_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C', shortcut: 'Ctrl+1' },
  { id: 'files', label: 'Files', icon: 'F', shortcut: 'Ctrl+2' },
  { id: 'preview', label: 'Preview', icon: 'P', shortcut: 'Ctrl+3' },
];

const VIEW_ITEMS = [
  ...ACTIVITY_ITEMS,
  { id: 'tasks', label: 'Tasks', icon: 'T' },
  { id: 'git', label: 'Git', icon: 'G' },
  { id: 'spec', label: 'Spec', icon: 'S' },
];

const VIEW_IDS = VIEW_ITEMS.map((item) => item.id);
const DEFAULT_PRIMARY_SECONDARY_RATIO = 0.62;

const PANEL_HELP = {
  chat: {
    title: 'Chat',
    whatIs: 'Coordinate with agents and guide execution.',
    nextStep: 'Ask for one concrete next change and verification.',
    commonMistake: 'Starting implementation without defining acceptance criteria.',
  },
  files: {
    title: 'Files',
    whatIs: 'Inspect and edit code with a quick-open workflow.',
    nextStep: 'Open core files first, then compare edits before commit.',
    commonMistake: 'Changing many files before confirming the right entry point.',
  },
  preview: {
    title: 'Preview',
    whatIs: 'Run the app and validate behavior in output.',
    nextStep: 'Apply preset, start preview, then inspect logs and URL.',
    commonMistake: 'Debugging blind without live output.',
  },
  tasks: {
    title: 'Tasks',
    whatIs: 'Capture and triage work items in an execution queue.',
    nextStep: 'Create one scoped task and move it through triage.',
    commonMistake: 'Keeping tasks too vague to verify.',
  },
  spec: {
    title: 'Spec',
    whatIs: 'Define goal, scope, and acceptance criteria.',
    nextStep: 'Complete required sections before approval.',
    commonMistake: 'Skipping non-goals and explicit constraints.',
  },
  git: {
    title: 'Git',
    whatIs: 'Review diffs, stage deliberately, and commit safely.',
    nextStep: 'Inspect changes before committing.',
    commonMistake: 'Committing without validating staged diff.',
  },
};

function normalizeBuildLayoutMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'split' || raw === 'full-ide') return raw;
  if (raw === 'focus') return 'full-ide';
  return 'split';
}

function paneStorageProjectId(value) {
  const base = String(value || 'ai-office').trim().toLowerCase() || 'ai-office';
  return base.replace(/[^a-z0-9-]+/g, '-');
}

function workspaceStorageKey(projectName, suffix) {
  const projectId = paneStorageProjectId(projectName);
  return `ai-office:workspace:${projectId}:${suffix}`;
}

function readStorage(key, fallback = '') {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw;
  } catch {
    return fallback;
  }
}

function readBooleanStorage(key, fallback = false) {
  const value = String(readStorage(key, '')).trim().toLowerCase();
  if (!value) return fallback;
  return value === 'true';
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

function paneMeta(viewId) {
  const item = VIEW_ITEMS.find((entry) => entry.id === viewId);
  if (!item) return { icon: 'W', title: 'Workspace' };
  return { icon: item.icon, title: item.label };
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function removePaneSizeKeys(projectStorageId) {
  try {
    const prefix = `ai-office:paneSizes:${projectStorageId}:`;
    const removals = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) {
        removals.push(key);
      }
    }
    removals.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore storage failures
  }
}

function ViewPane({
  id,
  role = 'primary',
  beginnerMode = false,
  isFocusMode = false,
  pinned = false,
  onTogglePin = null,
  onPopOut = null,
  onRefresh = null,
  children,
}) {
  const meta = paneMeta(id);
  const help = PANEL_HELP[id];
  return (
    <section className={`workspace-view-pane ${role === 'secondary' ? 'secondary' : 'primary'}`}>
      <header className="workspace-view-header">
        <div className="workspace-view-title">
          <span className="workspace-view-icon">{meta.icon}</span>
          <div>
            <h3>{meta.title}</h3>
            <p>{role === 'secondary' ? 'Pinned side pane' : 'Primary workspace pane'}</p>
          </div>
        </div>
        <div className="workspace-view-actions">
          {!isFocusMode && id !== 'settings' && (
            <button
              type="button"
              className="ui-btn"
              onClick={onTogglePin}
              data-tooltip={pinned ? 'Remove this pane from the side rail.' : 'Keep this pane visible in the secondary side area.'}
            >
              {pinned ? 'Unpin Side' : 'Pin to Side'}
            </button>
          )}
          {role === 'secondary' && (
            <button
              type="button"
              className="ui-btn"
              onClick={onPopOut}
              data-tooltip="Move this side pane back into the primary workspace."
            >
              Pop Out
            </button>
          )}
          <button
            type="button"
            className="ui-btn"
            onClick={onRefresh}
            data-tooltip="Reload this pane content from the latest state."
          >
            Refresh
          </button>
          {beginnerMode && help ? (
            <HelpPopover
              title={help.title}
              whatIs={help.whatIs}
              nextStep={help.nextStep}
              commonMistake={help.commonMistake}
            />
          ) : null}
        </div>
      </header>
      <div className="workspace-view-body">{children}</div>
    </section>
  );
}

export default function WorkspaceShell({
  channel,
  projectName,
  branch,
  layoutPreset = 'split',
  onLayoutPresetChange,
  previewFocus = false,
  onToggleFocusMode = null,
  onOpenSettings = null,
  projectSidebarCollapsed = false,
  onToggleProjectSidebar = null,
  activeTab = null,
  onActiveTabChange,
  creationDraft = null,
  onCreationDraftChange = null,
  onCreateProjectFromDraft = null,
  onDiscardCreationDraft = null,
  onEditCreationDraft = null,
  ingestionProgress = null,
  onOpenProject = null,
}) {
  const {
    enabled: beginnerMode,
    toggleEnabled: toggleBeginnerMode,
    markViewOpened,
    setPreviewState,
  } = useBeginnerMode();
  const [internalView, setInternalView] = useState('chat');
  const [queuedChatMessage, setQueuedChatMessage] = useState(null);
  const [chatPrefill, setChatPrefill] = useState('');
  const [secondaryPinnedOverrides, setSecondaryPinnedOverrides] = useState({});
  const [beginnerGuideCollapsedOverrides, setBeginnerGuideCollapsedOverrides] = useState({});
  const [refreshVersions, setRefreshVersions] = useState({});
  const [primarySecondaryRatio, setPrimarySecondaryRatio] = useState(DEFAULT_PRIMARY_SECONDARY_RATIO);
  const [consoleOpenOverrides, setConsoleOpenOverrides] = useState({});
  const [consoleHasErrors, setConsoleHasErrors] = useState(false);
  const [importDragActive, setImportDragActive] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState('');

  const projectLabel = projectName || 'ai-office';
  const hasCreationDraft = Boolean(creationDraft?.text);
  const projectStorageId = useMemo(() => paneStorageProjectId(projectLabel), [projectLabel]);
  const primaryViewStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'primaryView'), [projectLabel]);
  const secondaryPinnedStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'secondaryPinned'), [projectLabel]);
  const focusModeStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'focusMode'), [projectLabel]);
  const beginnerGuideCollapsedStorageKey = useMemo(
    () => workspaceStorageKey(projectLabel, 'beginnerGuideCollapsed'),
    [projectLabel]
  );
  const consoleOpenStorageKey = useMemo(
    () => workspaceStorageKey(projectLabel, 'consoleOpen'),
    [projectLabel]
  );

  const setView = onActiveTabChange || setInternalView;
  const rawView = activeTab || internalView;
  const activeView = VIEW_IDS.includes(rawView) ? rawView : 'chat';

  useEffect(() => {
    const persisted = readStorage(primaryViewStorageKey, 'chat');
    const normalized = VIEW_IDS.includes(persisted) ? persisted : 'chat';
    if (normalized !== activeView) {
      setView(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryViewStorageKey]);

  useEffect(() => {
    writeStorage(primaryViewStorageKey, activeView);
  }, [primaryViewStorageKey, activeView]);

  useEffect(() => {
    writeStorage(focusModeStorageKey, previewFocus ? 'true' : 'false');
  }, [focusModeStorageKey, previewFocus]);

  useEffect(() => {
    markViewOpened(projectLabel, activeView);
  }, [activeView, markViewOpened, projectLabel]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('workspace:view-changed', { detail: { view: activeView } }));
  }, [activeView]);

  const persistedPinned = useMemo(
    () => readStorage(secondaryPinnedStorageKey, ''),
    [secondaryPinnedStorageKey]
  );
  const secondaryPinned = secondaryPinnedOverrides[secondaryPinnedStorageKey] ?? persistedPinned;

  const setSecondaryPinned = useCallback((nextValue) => {
    const normalized = VIEW_IDS.includes(nextValue) ? nextValue : '';
    setSecondaryPinnedOverrides((prev) => ({ ...prev, [secondaryPinnedStorageKey]: normalized }));
    writeStorage(secondaryPinnedStorageKey, normalized);
  }, [secondaryPinnedStorageKey]);

  const beginnerGuideCollapsed = beginnerGuideCollapsedOverrides[beginnerGuideCollapsedStorageKey]
    ?? readBooleanStorage(beginnerGuideCollapsedStorageKey, !beginnerMode);

  const setBeginnerGuideCollapsed = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setBeginnerGuideCollapsedOverrides((prev) => ({ ...prev, [beginnerGuideCollapsedStorageKey]: normalized }));
    writeStorage(beginnerGuideCollapsedStorageKey, normalized ? 'true' : 'false');
  }, [beginnerGuideCollapsedStorageKey]);

  const consoleOpen = consoleOpenOverrides[consoleOpenStorageKey]
    ?? readBooleanStorage(consoleOpenStorageKey, false);

  const setConsoleOpen = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setConsoleOpenOverrides((prev) => ({ ...prev, [consoleOpenStorageKey]: normalized }));
    writeStorage(consoleOpenStorageKey, normalized ? 'true' : 'false');
  }, [consoleOpenStorageKey]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    const checkConsoleErrors = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`/api/console/events/${encodeURIComponent(channel)}?limit=20`);
        const payload = response.ok ? await response.json() : [];
        if (cancelled) return;
        const items = Array.isArray(payload) ? payload : [];
        const hasErrors = items.some((entry) => {
          const severity = String(entry?.severity || '').trim().toLowerCase();
          const eventType = String(entry?.event_type || '').trim().toLowerCase();
          return severity === 'error' || severity === 'critical' || eventType.includes('error');
        });
        setConsoleHasErrors(hasErrors);
        if (hasErrors) {
          setConsoleOpen(true);
        }
      } catch {
        // ignore check failures
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkConsoleErrors();
      }
    };

    checkConsoleErrors();
    intervalId = window.setInterval(checkConsoleErrors, 10000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [channel, setConsoleOpen]);

  const selectedBuildLayout = normalizeBuildLayoutMode(layoutPreset);
  const hasPinnedSecondary = Boolean(
    !previewFocus
    && selectedBuildLayout === 'split'
    && secondaryPinned
    && secondaryPinned !== activeView
    && VIEW_IDS.includes(secondaryPinned)
  );
  const primarySecondaryKey = `ai-office:paneSizes:${projectStorageId}:${selectedBuildLayout}:vertical:primary-secondary`;

  useEffect(() => {
    setPrimarySecondaryRatio(DEFAULT_PRIMARY_SECONDARY_RATIO);
  }, [primarySecondaryKey]);

  useEffect(() => {
    const onOpenTab = (event) => {
      const tab = String(event?.detail?.tab || '').trim().toLowerCase();
      if (tab === 'settings') {
        onOpenSettings?.();
        return;
      }
      if (!VIEW_IDS.includes(tab)) return;
      setView(tab);
    };
    window.addEventListener('workspace:open-tab', onOpenTab);
    return () => window.removeEventListener('workspace:open-tab', onOpenTab);
  }, [onOpenSettings, setView]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.ctrlKey || isTypingTarget(event.target)) return;
      const key = String(event.key || '').toLowerCase();
      if (event.shiftKey && key === 'f') {
        event.preventDefault();
        onToggleFocusMode?.();
        return;
      }
      if (key === ',') {
        event.preventDefault();
        onOpenSettings?.();
        return;
      }

      const map = {
        '1': 'chat',
        '2': 'files',
        '3': 'preview',
        '4': 'tasks',
        '5': 'spec',
        '6': 'git',
      };
      const nextView = map[key];
      if (!nextView) return;
      event.preventDefault();
      setView(nextView);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onOpenSettings, onToggleFocusMode, setView]);

  useEffect(() => {
    const onResetUi = () => {
      setSecondaryPinned('');
      setConsoleOpen(false);
      setView('chat');
      if (previewFocus) onToggleFocusMode?.();
      onLayoutPresetChange?.('split');
      removePaneSizeKeys(projectStorageId);
    };
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [
    onLayoutPresetChange,
    onToggleFocusMode,
    previewFocus,
    projectStorageId,
    setConsoleOpen,
    setSecondaryPinned,
    setView,
  ]);

  const handlePreviewStateChange = (preview) => {
    setPreviewState(projectLabel, preview);
  };

  const queueMessage = useCallback((text) => {
    const body = String(text || '').trim();
    if (!body) return;
    setQueuedChatMessage({ id: `${Date.now()}-${Math.random()}`, text: body });
  }, []);

  const importProjectFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || importBusy) return;
    setImportBusy(true);
    setImportNotice('Importing project...');
    try {
      const form = new FormData();
      const zipCandidate = files.length === 1 ? files[0] : null;
      const isZip = zipCandidate && String(zipCandidate.name || '').toLowerCase().endsWith('.zip');
      if (isZip) {
        form.append('zip_file', zipCandidate, zipCandidate.name || 'project.zip');
      } else {
        files.forEach((file) => {
          const name = file.webkitRelativePath || file.name || 'file';
          form.append('files', file, name);
        });
      }

      const response = await fetch('/api/projects/import', {
        method: 'POST',
        body: form,
      });
      const payload = response.ok ? await response.json() : await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Project import failed.');
      }

      const importedProject = String(payload?.project || '').trim();
      const extractedCount = Number(payload?.extracted_files || 0);
      const summary = importedProject
        ? `Imported project '${importedProject}' with ${extractedCount} files.`
        : `Imported project with ${extractedCount} files.`;
      setImportNotice(summary);
      await onOpenProject?.(payload);
      if (importedProject) {
        queueMessage(summary);
      }
    } catch (error) {
      setImportNotice(error?.message || 'Project import failed.');
    } finally {
      setImportBusy(false);
    }
  }, [importBusy, onOpenProject, queueMessage]);

  const handleWorkspaceDragEnter = (event) => {
    if (importBusy) return;
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    setImportDragActive(true);
  };

  const handleWorkspaceDragOver = (event) => {
    if (!importDragActive || importBusy) return;
    event.preventDefault();
  };

  const handleWorkspaceDragLeave = (event) => {
    const target = event.currentTarget;
    const next = event.relatedTarget;
    if (target && next && target.contains(next)) return;
    setImportDragActive(false);
  };

  const handleWorkspaceDrop = (event) => {
    if (importBusy) return;
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    setImportDragActive(false);
    importProjectFiles(event.dataTransfer.files);
  };

  const runBuildLoop = () => {
    queueMessage(
      'Run build loop for this project:\n1) confirm current spec/goal\n2) execute highest-priority implementation step\n3) verify with tests/checks\n4) report exactly what changed and what remains.'
    );
    setView('chat');
  };

  const handleDraftRequest = (text) => {
    const draft = String(text || '').trim();
    if (!draft) return;
    setView('chat');
    setChatPrefill('');
    window.setTimeout(() => {
      setChatPrefill(draft);
    }, 0);
  };

  const consumeChatPrefill = () => {
    setChatPrefill('');
  };

  const renderChatRoom = (extra = {}) => (
    <ChatRoom
      key={`chat-${refreshVersions.chat || 0}`}
      channel={channel}
      workspaceMode="build"
      showStatusPanel={false}
      compact
      beginnerMode={beginnerMode}
      queuedMessage={queuedChatMessage}
      prefillText={chatPrefill}
      onPrefillConsumed={consumeChatPrefill}
      onRequestOpenTab={setView}
      {...extra}
    />
  );

  const renderBuildViewContent = (viewId) => {
    const refreshKey = refreshVersions[viewId] || 0;
    if (viewId === 'chat') return renderChatRoom();
    if (viewId === 'files') return <FileViewer key={`files-${refreshKey}`} channel={channel} beginnerMode={beginnerMode} />;
    if (viewId === 'tasks') return <TaskBoard key={`tasks-${refreshKey}`} channel={channel} beginnerMode={beginnerMode} />;
    if (viewId === 'spec') {
      return (
        <SpecPanel
          key={`spec-${refreshKey}`}
          channel={channel}
          onOpenTab={setView}
          onDraftRequest={handleDraftRequest}
          beginnerMode={beginnerMode}
        />
      );
    }
    if (viewId === 'preview') {
      return (
        <PreviewPanel
          key={`preview-${refreshKey}`}
          channel={channel}
          onDraftRequest={handleDraftRequest}
          beginnerMode={beginnerMode}
          onStateChange={handlePreviewStateChange}
        />
      );
    }
    if (viewId === 'git') return <GitPanel key={`git-${refreshKey}`} channel={channel} beginnerMode={beginnerMode} onOpenTab={setView} />;
    return <FileViewer key={`fallback-${refreshKey}`} channel={channel} beginnerMode={beginnerMode} />;
  };

  const refreshView = (viewId) => {
    if (!viewId) return;
    setRefreshVersions((prev) => ({ ...prev, [viewId]: (prev[viewId] || 0) + 1 }));
  };

  const togglePinForView = (viewId) => {
    if (!viewId || !VIEW_IDS.includes(viewId)) return;
    setSecondaryPinned(secondaryPinned === viewId ? '' : viewId);
    if (selectedBuildLayout !== 'split') {
      onLayoutPresetChange?.('split');
    }
  };

  const openBuildView = (viewId) => {
    if (viewId === 'settings') {
      onOpenSettings?.();
      return;
    }
    if (!VIEW_IDS.includes(viewId)) return;
    setView(viewId);
  };

  const resetLayout = () => {
    setSecondaryPinned('');
    setView('chat');
    onLayoutPresetChange?.('split');
    if (previewFocus) {
      onToggleFocusMode?.();
    }
    removePaneSizeKeys(projectStorageId);
  };

  const renderPrimaryPane = () => (
    <ViewPane
      id={activeView}
      role="primary"
      beginnerMode={beginnerMode}
      isFocusMode={previewFocus}
      pinned={secondaryPinned === activeView}
      onTogglePin={() => togglePinForView(activeView)}
      onRefresh={() => refreshView(activeView)}
    >
      {renderBuildViewContent(activeView)}
    </ViewPane>
  );

  const renderSecondaryPane = () => (
    <ViewPane
      id={secondaryPinned}
      role="secondary"
      beginnerMode={beginnerMode}
      pinned
      onTogglePin={() => setSecondaryPinned('')}
      onRefresh={() => refreshView(secondaryPinned)}
      onPopOut={() => {
        setView(secondaryPinned);
        setSecondaryPinned('');
      }}
    >
      {renderBuildViewContent(secondaryPinned)}
    </ViewPane>
  );

  const showBeginnerGuide = beginnerMode && !beginnerGuideCollapsed;
  const showBeginnerGuideCollapsed = beginnerMode && beginnerGuideCollapsed;
  const showQuickStartExpanded = !beginnerMode && !beginnerGuideCollapsed;
  const showQuickStartCollapsed = !beginnerMode && beginnerGuideCollapsed;

  return (
    <div
      className={`workspace-shell workspace-office-shell ${previewFocus ? 'workspace-focus-mode' : ''}`}
      onDragEnter={handleWorkspaceDragEnter}
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={handleWorkspaceDrop}
    >
      {importDragActive && !importBusy ? (
        <div className="workspace-import-overlay">
          Drop a zip or project files to import into AI Office
        </div>
      ) : null}
      <WorkspaceToolbar
        projectName={projectLabel}
        branch={branch}
        layoutPreset={selectedBuildLayout}
        layoutOptions={BUILD_LAYOUT_OPTIONS}
        projectSidebarCollapsed={projectSidebarCollapsed}
        previewFocus={previewFocus}
        beginnerMode={beginnerMode}
        consoleOpen={consoleOpen}
        consoleHasErrors={consoleHasErrors}
        onOpenSpec={() => setView('spec')}
        onOpenTasks={() => setView('tasks')}
        onOpenGit={() => setView('git')}
        onOpenPreview={() => setView('preview')}
        onToggleConsole={() => setConsoleOpen(!consoleOpen)}
        onToggleProjectSidebar={onToggleProjectSidebar}
        onToggleFocusMode={onToggleFocusMode}
        onToggleBeginnerMode={toggleBeginnerMode}
        onLayoutPresetChange={(nextMode) => onLayoutPresetChange?.(normalizeBuildLayoutMode(nextMode))}
        onResetLayout={resetLayout}
        onRunBuildLoop={runBuildLoop}
      />

      {showQuickStartCollapsed ? (
        <div className="workspace-quickstart-bar compact">
          <span>Quick Start: Chat to Files to Preview</span>
          <button type="button" className="ui-btn" onClick={() => setBeginnerGuideCollapsed(false)}>
            Expand
          </button>
        </div>
      ) : null}

      {showQuickStartExpanded ? (
        <div className="workspace-quickstart-bar">
          <div>
            <strong>Quick Start</strong>
            <p>Use Chat to coordinate, Files to implement, then Preview to verify output.</p>
          </div>
          <div className="workspace-coachmark-actions">
            <button type="button" className="ui-btn" onClick={() => setView('chat')}>
              Open Chat
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setView('files')}>
              Open Files
            </button>
            <button type="button" className="ui-btn" onClick={() => setBeginnerGuideCollapsed(true)}>
              Collapse
            </button>
          </div>
        </div>
      ) : null}

      {showBeginnerGuideCollapsed ? (
        <div className="workspace-quickstart-bar compact">
          <span>Beginner guide is collapsed for this project.</span>
          <button type="button" className="ui-btn" onClick={() => setBeginnerGuideCollapsed(false)}>
            Show Guide
          </button>
        </div>
      ) : null}

      {showBeginnerGuide ? (
        <div className="workspace-coachmark">
          <div>
            <strong>Workspace quick start</strong>
            <p>Use the left bar for Chat, Files, and Preview. Open Spec, Tasks, and Git from the menu.</p>
          </div>
          <div className="workspace-coachmark-actions">
            <button type="button" className="ui-btn" onClick={resetLayout}>Reset Layout</button>
            <button type="button" className="ui-btn" onClick={() => setBeginnerGuideCollapsed(true)}>Collapse</button>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => setBeginnerGuideCollapsed(true)}
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {ingestionProgress && (
        <div className="workspace-ingestion-banner">
          Ingestion: {ingestionProgress.done}/{ingestionProgress.total} tasks complete
          {ingestionProgress.status === 'complete' ? ' (ready)' : ' (processing...)'}
        </div>
      )}

      {importNotice ? (
        <div className="workspace-import-banner">
          {importBusy ? 'Importing project…' : importNotice}
        </div>
      ) : null}

      <div className="workspace-shell-body workspace-layout-canvas">
        <div className={`workspace-build-mode ${previewFocus ? 'is-focus-mode' : ''}`}>
          {!previewFocus && (
            <ActivityBar
              items={ACTIVITY_ITEMS}
              activeId={activeView}
              compact={projectSidebarCollapsed}
              onSelect={openBuildView}
            />
          )}
          <div className="workspace-build-main-shell">
            <div className="workspace-build-main">
              {hasPinnedSecondary ? (
                <SplitPane
                  direction="vertical"
                  ratio={primarySecondaryRatio}
                  defaultRatio={DEFAULT_PRIMARY_SECONDARY_RATIO}
                  minPrimary={460}
                  minSecondary={360}
                  persistKey={primarySecondaryKey}
                  primaryLabel={paneMeta(activeView).title}
                  secondaryLabel={paneMeta(secondaryPinned).title}
                  onRatioChange={setPrimarySecondaryRatio}
                >
                  {renderPrimaryPane()}
                  {renderSecondaryPane()}
                </SplitPane>
              ) : (
                <div className="workspace-layout-single">
                  {renderPrimaryPane()}
                </div>
              )}
            </div>
            <section className={`workspace-console-dock ${consoleOpen ? 'open' : 'collapsed'} ${consoleHasErrors ? 'has-errors' : ''}`}>
              <button
                type="button"
                className={`workspace-console-toggle ui-btn ${consoleOpen ? 'ui-btn-primary' : ''}`}
                onClick={() => setConsoleOpen(!consoleOpen)}
                data-tooltip="Toggle the workspace console output panel."
              >
                {consoleOpen ? 'Hide Console' : 'Show Console'}{consoleHasErrors ? ' (errors)' : ''}
              </button>
              {consoleOpen ? (
                <div className="workspace-console-content">
                  <ConsolePanel channel={channel} />
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
