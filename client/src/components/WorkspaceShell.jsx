import { useCallback, useEffect, useMemo, useState } from 'react';
import ChatRoom from './ChatRoom';
import FileViewer from './FileViewer';
import TaskBoard from './TaskBoard';
import SpecPanel from './SpecPanel';
import PreviewPanel from './PreviewPanel';
import GitPanel from './GitPanel';
import LayoutPresetToggle from './LayoutPresetToggle';
import SplitPane from './layout/SplitPane';
import ActivityBar from './ActivityBar';
import DiscussView from './DiscussView';
import DraftDiscussView from './discuss/DraftDiscussView';
import GuidedStepper from './beginner/GuidedStepper';
import HelpPopover from './beginner/HelpPopover';
import { useBeginnerMode } from './beginner/BeginnerModeContext';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import useEscapeKey from '../hooks/useEscapeKey';

const BUILD_LAYOUT_OPTIONS = [
  { id: 'split', label: 'Split' },
  { id: 'full-ide', label: 'Full IDE' },
];

const BUILD_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C', shortcut: 'Ctrl+1' },
  { id: 'files', label: 'Files', icon: 'F', shortcut: 'Ctrl+2' },
  { id: 'git', label: 'Git', icon: 'G', shortcut: 'Ctrl+3' },
  { id: 'tasks', label: 'Tasks', icon: 'T', shortcut: 'Ctrl+4' },
  { id: 'spec', label: 'Spec', icon: 'S', shortcut: 'Ctrl+5' },
  { id: 'preview', label: 'Preview', icon: 'P', shortcut: 'Ctrl+6' },
  { id: 'settings', label: 'Settings', icon: '⚙', shortcut: 'Ctrl+,' },
];

const PRIMARY_VIEW_IDS = BUILD_ITEMS
  .map((item) => item.id)
  .filter((id) => id !== 'settings');

const MODE_DETAILS = {
  discuss: 'Discuss mode: align scope, risks, and decisions before implementation.',
  build: 'Build mode: one primary view with optional pinned side pane for calm execution.',
};

const PANEL_HELP = {
  chat: {
    title: 'Chat',
    whatIs: 'Coordinate with agents and guide execution.',
    nextStep: 'Ask for one concrete next change and verification.',
    commonMistake: 'Starting implementation without defining acceptance criteria.',
  },
  files: {
    title: 'Files',
    whatIs: 'Inspect and edit code with quick open and diff-safe workflow.',
    nextStep: 'Open core files first, then compare edits before commit.',
    commonMistake: 'Changing many files before confirming the right entry point.',
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
  preview: {
    title: 'Preview',
    whatIs: 'Run the app and validate behavior in output.',
    nextStep: 'Apply preset, start preview, then inspect logs and URL.',
    commonMistake: 'Debugging blind without live output.',
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

function normalizeOfficeMode(value, projectName) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'build' || raw === 'discuss') return raw;
  if (String(projectName || '').trim().toLowerCase() === 'ai-office') return 'build';
  return 'discuss';
}

function officeModeKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:workspace-office-mode:${safe}`;
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
  const item = BUILD_ITEMS.find((entry) => entry.id === viewId);
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
            <button type="button" className="ui-btn" onClick={onTogglePin}>
              {pinned ? 'Unpin Side' : 'Pin to Side'}
            </button>
          )}
          {role === 'secondary' && (
            <button type="button" className="ui-btn" onClick={onPopOut}>
              Pop Out
            </button>
          )}
          <button type="button" className="ui-btn" onClick={onRefresh}>
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
}) {
  const {
    enabled: beginnerMode,
    toggleEnabled: toggleBeginnerMode,
    markViewOpened,
    setPreviewState,
  } = useBeginnerMode();
  const [internalView, setInternalView] = useState('chat');
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [queuedChatMessage, setQueuedChatMessage] = useState(null);
  const [chatPrefill, setChatPrefill] = useState('');
  const [officeModeOverrides, setOfficeModeOverrides] = useState({});
  const [secondaryPinnedOverrides, setSecondaryPinnedOverrides] = useState({});
  const [coachDismissedOverrides, setCoachDismissedOverrides] = useState({});
  const [refreshVersions, setRefreshVersions] = useState({});

  const projectLabel = projectName || 'ai-office';
  const hasCreationDraft = Boolean(creationDraft?.text);
  const projectStorageId = useMemo(() => paneStorageProjectId(projectLabel), [projectLabel]);
  const officeStorageKey = useMemo(() => officeModeKey(projectLabel), [projectLabel]);
  const primaryViewStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'primaryView'), [projectLabel]);
  const secondaryPinnedStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'secondaryPinned'), [projectLabel]);
  const focusModeStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'focusMode'), [projectLabel]);
  const coachDismissedStorageKey = useMemo(() => workspaceStorageKey(projectLabel, 'coachDismissed'), [projectLabel]);

  const persistedOfficeMode = useMemo(
    () => normalizeOfficeMode(readStorage(officeStorageKey, ''), projectLabel),
    [officeStorageKey, projectLabel]
  );
  const officeMode = hasCreationDraft
    ? 'discuss'
    : (officeModeOverrides[officeStorageKey] || persistedOfficeMode);

  const setOfficeMode = useCallback((nextMode) => {
    const normalized = normalizeOfficeMode(nextMode, projectLabel);
    setOfficeModeOverrides((prev) => ({ ...prev, [officeStorageKey]: normalized }));
    writeStorage(officeStorageKey, normalized);
  }, [officeStorageKey, projectLabel]);

  const setView = onActiveTabChange || setInternalView;
  const rawView = activeTab || internalView;
  const activeView = PRIMARY_VIEW_IDS.includes(rawView) ? rawView : 'chat';

  useEffect(() => {
    const persisted = readStorage(primaryViewStorageKey, 'chat');
    const normalized = PRIMARY_VIEW_IDS.includes(persisted) ? persisted : 'chat';
    if (normalized !== activeView) {
      setView(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryViewStorageKey]);

  useEffect(() => {
    writeStorage(primaryViewStorageKey, activeView);
  }, [primaryViewStorageKey, activeView]);

  const persistedPinned = useMemo(
    () => readStorage(secondaryPinnedStorageKey, ''),
    [secondaryPinnedStorageKey]
  );
  const secondaryPinned = secondaryPinnedOverrides[secondaryPinnedStorageKey] ?? persistedPinned;

  const setSecondaryPinned = useCallback((nextValue) => {
    const normalized = PRIMARY_VIEW_IDS.includes(nextValue) ? nextValue : '';
    setSecondaryPinnedOverrides((prev) => ({ ...prev, [secondaryPinnedStorageKey]: normalized }));
    writeStorage(secondaryPinnedStorageKey, normalized);
  }, [secondaryPinnedStorageKey]);

  const coachDismissed = coachDismissedOverrides[coachDismissedStorageKey]
    ?? readBooleanStorage(coachDismissedStorageKey, false);

  const setCoachDismissed = useCallback((nextValue) => {
    const normalized = Boolean(nextValue);
    setCoachDismissedOverrides((prev) => ({ ...prev, [coachDismissedStorageKey]: normalized }));
    writeStorage(coachDismissedStorageKey, normalized ? 'true' : 'false');
  }, [coachDismissedStorageKey]);

  const selectedBuildLayout = normalizeBuildLayoutMode(layoutPreset);
  const hasPinnedSecondary = Boolean(
    !previewFocus
    && selectedBuildLayout === 'split'
    && secondaryPinned
    && secondaryPinned !== activeView
    && PRIMARY_VIEW_IDS.includes(secondaryPinned)
  );

  useBodyScrollLock(Boolean(showHandoffModal), 'workspace-build-handoff-modal');

  useEffect(() => {
    writeStorage(focusModeStorageKey, previewFocus ? 'true' : 'false');
  }, [focusModeStorageKey, previewFocus]);

  useEffect(() => {
    if (officeMode !== 'build') return;
    markViewOpened(projectLabel, activeView);
  }, [officeMode, projectLabel, activeView, markViewOpened]);

  useEffect(() => {
    const onOpenTab = (event) => {
      const tab = String(event?.detail?.tab || '').trim().toLowerCase();
      if (!PRIMARY_VIEW_IDS.includes(tab)) return;
      setOfficeMode('build');
      setView(tab);
    };
    window.addEventListener('workspace:open-tab', onOpenTab);
    return () => window.removeEventListener('workspace:open-tab', onOpenTab);
  }, [setView, setOfficeMode]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (officeMode !== 'build') return;
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
        '3': 'git',
        '4': 'tasks',
        '5': 'spec',
        '6': 'preview',
      };
      const nextView = map[key];
      if (!nextView) return;
      event.preventDefault();
      setView(nextView);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [officeMode, onOpenSettings, onToggleFocusMode, setView]);

  const handlePreviewStateChange = (preview) => {
    setPreviewState(projectLabel, preview);
  };

  const queueMessage = (text) => {
    const body = String(text || '').trim();
    if (!body) return;
    setQueuedChatMessage({ id: `${Date.now()}-${Math.random()}`, text: body });
  };

  const runBuildLoop = () => {
    queueMessage(
      'Run build loop for this project:\n1) confirm current spec/goal\n2) execute highest-priority implementation step\n3) verify with tests/checks\n4) report exactly what changed and what remains.'
    );
    setOfficeMode('build');
    setView('chat');
  };

  const runDiscussBrainstorm = (text) => {
    queueMessage(text);
  };

  const handleDraftRequest = (text) => {
    const draft = String(text || '').trim();
    if (!draft) return;
    setOfficeMode('build');
    setView('chat');
    setChatPrefill('');
    window.setTimeout(() => {
      setChatPrefill(draft);
    }, 0);
  };

  const consumeChatPrefill = () => {
    setChatPrefill('');
  };

  const beginBuildHandoff = () => {
    setShowHandoffModal(false);
    setOfficeMode('build');
    setView('spec');
    onLayoutPresetChange?.('split');
  };

  const closeWorkspaceOverlays = useCallback(() => {
    if (showHandoffModal) {
      setShowHandoffModal(false);
      return true;
    }
    return false;
  }, [showHandoffModal]);

  useEscapeKey((event) => {
    const handled = closeWorkspaceOverlays();
    if (handled) {
      event.preventDefault();
    }
  }, true);

  useEffect(() => {
    const onGlobalEscape = (event) => {
      const handled = closeWorkspaceOverlays();
      if (handled && event?.detail) {
        event.detail.handled = true;
      }
    };
    const onResetUi = () => {
      setShowHandoffModal(false);
      setSecondaryPinned('');
      setView('chat');
      if (previewFocus) onToggleFocusMode?.();
      onLayoutPresetChange?.('split');
      removePaneSizeKeys(projectStorageId);
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [
    closeWorkspaceOverlays,
    onLayoutPresetChange,
    onToggleFocusMode,
    previewFocus,
    projectStorageId,
    setSecondaryPinned,
    setView,
  ]);

  const renderChatRoom = (extra = {}) => (
    <ChatRoom
      key={`chat-${refreshVersions.chat || 0}`}
      channel={channel}
      workspaceMode={officeMode === 'build' ? 'build' : 'discuss'}
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
    if (!viewId || !PRIMARY_VIEW_IDS.includes(viewId)) return;
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
    if (!PRIMARY_VIEW_IDS.includes(viewId)) return;
    setOfficeMode('build');
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

  const showCoach = officeMode === 'build' && !coachDismissed;

  return (
    <div className={`workspace-shell workspace-office-shell ${previewFocus ? 'workspace-focus-mode' : ''}`}>
      <header className="workspace-shell-header compact office-shell-header">
        <div className="workspace-shell-meta">
          <span className="workspace-breadcrumb">{projectLabel}</span>
          <span className="workspace-breadcrumb-sep">→</span>
          <span className="workspace-breadcrumb mode">{officeMode.toUpperCase()}</span>
          {officeMode === 'build' ? (
            <span className="workspace-breadcrumb-subtle">Primary: {paneMeta(activeView).title}</span>
          ) : null}
        </div>
        <div className="workspace-shell-controls">
          <div className="office-mode-switch" role="tablist" aria-label="Workspace modes">
            <button
              type="button"
              className={`mode-chip ${officeMode === 'discuss' ? 'active' : ''}`}
              onClick={() => setOfficeMode('discuss')}
            >
              Discuss
            </button>
            <button
              type="button"
              className={`mode-chip ${officeMode === 'build' ? 'active' : ''}`}
              onClick={() => setOfficeMode('build')}
              disabled={hasCreationDraft}
              title={hasCreationDraft ? 'Create the project first to enter Build mode.' : ''}
            >
              Build
            </button>
          </div>

          <button
            type="button"
            className={`control-btn ui-btn beginner-toggle-chip ${beginnerMode ? 'ui-btn-primary' : ''}`}
            onClick={toggleBeginnerMode}
          >
            {beginnerMode ? 'Beginner Mode On' : 'Beginner Mode Off'}
          </button>

          {officeMode === 'build' && (
            <>
              <LayoutPresetToggle
                value={selectedBuildLayout}
                options={BUILD_LAYOUT_OPTIONS}
                onChange={(nextMode) => onLayoutPresetChange?.(normalizeBuildLayoutMode(nextMode))}
                onReset={resetLayout}
              />
              <button type="button" className="control-btn ui-btn" onClick={onToggleProjectSidebar}>
                {projectSidebarCollapsed ? 'Show Projects' : 'Hide Projects'}
              </button>
              <button type="button" className={`control-btn ui-btn ${previewFocus ? 'ui-btn-primary' : ''}`} onClick={onToggleFocusMode}>
                {previewFocus ? 'Exit Focus Mode' : 'Focus Mode'}
              </button>
              <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={runBuildLoop}>
                Run Build Loop
              </button>
            </>
          )}

          {officeMode === 'discuss' && !hasCreationDraft && (
            <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={() => setShowHandoffModal(true)}>
              Start Building
            </button>
          )}
          {officeMode === 'discuss' && hasCreationDraft && (
            <span className="convo-status active">Draft Discuss active</span>
          )}
        </div>
      </header>

      <div className="workspace-mode-explainer">
        {hasCreationDraft
          ? 'Draft Discuss mode: refine the request first, then explicitly create the project to unlock build tooling.'
          : MODE_DETAILS[officeMode]}
      </div>

      {showCoach ? (
        <div className="workspace-coachmark">
          <div>
            <strong>Workspace quick start</strong>
            <p>Use the left activity bar to switch views, and pin Preview or Spec to keep it visible in Split mode.</p>
          </div>
          <div className="workspace-coachmark-actions">
            <button type="button" className="ui-btn" onClick={resetLayout}>Reset Layout</button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setCoachDismissed(true)}>Got it</button>
          </div>
        </div>
      ) : null}

      {beginnerMode && (
        <GuidedStepper
          projectName={projectLabel}
          channel={channel}
          mode={officeMode}
          onOpenDiscuss={() => {
            setOfficeMode('discuss');
            setView('chat');
          }}
          onOpenSpec={() => {
            setOfficeMode('build');
            setView('spec');
          }}
          onOpenBuild={() => {
            setOfficeMode('build');
            setView('files');
          }}
          onOpenPreview={() => {
            setOfficeMode('build');
            setView('preview');
          }}
        />
      )}

      {ingestionProgress && (
        <div className="workspace-ingestion-banner">
          Ingestion: {ingestionProgress.done}/{ingestionProgress.total} tasks complete
          {ingestionProgress.status === 'complete' ? ' (ready)' : ' (processing...)'}
        </div>
      )}

      <div className="workspace-shell-body workspace-layout-canvas">
        {officeMode === 'discuss' ? (
          hasCreationDraft ? (
            <DraftDiscussView
              channel={channel}
              projectName={projectLabel}
              draft={creationDraft}
              beginnerMode={beginnerMode}
              onDraftChange={(patch) => onCreationDraftChange?.((prev) => ({ ...prev, ...(patch || {}) }))}
              onCreateProject={onCreateProjectFromDraft}
              onDiscardDraft={onDiscardCreationDraft}
              onEditDraft={onEditCreationDraft}
            />
          ) : (
            <DiscussView
              channel={channel}
              projectName={projectLabel}
              beginnerMode={beginnerMode}
              brainstormMessage={queuedChatMessage}
              onRunBrainstorm={runDiscussBrainstorm}
              onStartBuilding={() => setShowHandoffModal(true)}
              onDraftRequest={handleDraftRequest}
              chatPrefill={chatPrefill}
              onChatPrefillConsumed={consumeChatPrefill}
              onOpenTab={setView}
            />
          )
        ) : (
          <div className={`workspace-build-mode ${previewFocus ? 'is-focus-mode' : ''}`}>
            {!previewFocus && (
              <ActivityBar
                items={BUILD_ITEMS}
                activeId={activeView}
                compact={projectSidebarCollapsed}
                onSelect={openBuildView}
              />
            )}
            <div className="workspace-build-main">
              {hasPinnedSecondary ? (
                <SplitPane
                  direction="vertical"
                  ratio={0.62}
                  defaultRatio={0.62}
                  minPrimary={460}
                  minSecondary={360}
                  persistKey={`ai-office:paneSizes:${projectStorageId}:${selectedBuildLayout}:vertical:primary-secondary`}
                  primaryLabel={paneMeta(activeView).title}
                  secondaryLabel={paneMeta(secondaryPinned).title}
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
          </div>
        )}
      </div>

      {showHandoffModal && (
        <div className="workspace-handoff-backdrop">
          <div className="workspace-handoff-modal">
            <h3>Start Building</h3>
            <p>
              You are moving from discussion into development mode. Spec opens first so implementation stays grounded.
            </p>
            <ul>
              <li>Spec opens as the primary view</li>
              <li>Use activity bar to switch Chat, Files, Tasks, Preview, and Git</li>
              <li>Pin Preview or Spec to keep context while switching views</li>
            </ul>
            <div className="workspace-handoff-actions">
              <button type="button" className="msg-action-btn ui-btn" onClick={() => setShowHandoffModal(false)}>
                Cancel
              </button>
              <button type="button" className="refresh-btn ui-btn ui-btn-primary" onClick={beginBuildHandoff}>
                Open Build Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
