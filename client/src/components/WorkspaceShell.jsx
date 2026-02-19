import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatRoom from './ChatRoom';
import FileViewer from './FileViewer';
import TaskBoard from './TaskBoard';
import SpecPanel from './SpecPanel';
import PreviewPanel from './PreviewPanel';
import GitPanel from './GitPanel';
import LayoutPresetToggle from './LayoutPresetToggle';
import SplitPane from './layout/SplitPane';
import useSplitPaneState from './layout/useSplitPaneState';
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
  { id: 'focus-chat', label: 'Focus Chat' },
  { id: 'focus-preview', label: 'Focus Preview' },
  { id: 'focus-files', label: 'Focus Files' },
];

const BUILD_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'C' },
  { id: 'files', label: 'Files', icon: 'F' },
  { id: 'tasks', label: 'Tasks', icon: 'T' },
  { id: 'spec', label: 'Spec', icon: 'S' },
  { id: 'preview', label: 'Preview', icon: 'P' },
  { id: 'git', label: 'Git', icon: 'G' },
];

const MODE_DETAILS = {
  discuss: 'Discuss mode: align goals and decisions before touching build tooling.',
  build: 'Build mode: execute the plan with files, spec, tasks, preview, and git.',
};

const PANEL_HELP = {
  chat: {
    title: 'Chat',
    whatIs: 'Coordinate with agents, ask questions, and request implementation updates.',
    nextStep: 'Start with the outcome you want and ask for a concrete next action.',
    commonMistake: 'Sending vague prompts without desired output or constraints.',
  },
  files: {
    title: 'Files',
    whatIs: 'Browse, inspect, and compare project files before editing.',
    nextStep: 'Open key entry files first, then inspect diffs after each change.',
    commonMistake: 'Editing random files before confirming where the feature lives.',
  },
  tasks: {
    title: 'Tasks',
    whatIs: 'Capture and triage work items so nothing gets dropped.',
    nextStep: 'Add one actionable task, then move it through triage to done.',
    commonMistake: 'Keeping tasks as vague ideas instead of testable outcomes.',
  },
  spec: {
    title: 'Spec',
    whatIs: 'Define goal, scope, and acceptance criteria before implementation.',
    nextStep: 'Fill required sections, then approve when completeness is healthy.',
    commonMistake: 'Skipping non-goals and acceptance criteria before building.',
  },
  preview: {
    title: 'Preview',
    whatIs: 'Run the app and verify behavior in a real output surface.',
    nextStep: 'Apply a run preset, start preview, and inspect logs for URL/health.',
    commonMistake: 'Trying to debug without running the app or checking logs.',
  },
  git: {
    title: 'Git',
    whatIs: 'Review changes, stage safely, and commit with clear messages.',
    nextStep: 'Check diffs first, then commit only after verification passes.',
    commonMistake: 'Committing without reviewing staged files and diff context.',
  },
};

function normalizeBuildLayoutMode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'split' || raw === 'full-ide') return raw;
  if (raw.startsWith('focus-')) return raw;
  if (raw === 'focus') return 'focus-preview';
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

function canonicalFromBuildLayout(mode) {
  if (mode === 'split' || mode === 'full-ide') return mode;
  return 'focus';
}

function paneMeta(viewId) {
  const item = BUILD_ITEMS.find((entry) => entry.id === viewId);
  if (!item) return { icon: 'W', title: 'Workspace' };
  return { icon: item.icon, title: item.label };
}

function PaneFrame({
  title,
  subtitle,
  icon,
  className = '',
  actions = null,
  help = null,
  beginnerMode = false,
  children,
}) {
  return (
    <section className={`workspace-pane-frame ${className}`}>
      <header className="workspace-pane-frame-header">
        <div className="workspace-pane-frame-title">
          <span className="workspace-pane-frame-icon">{icon}</span>
          <div className="workspace-pane-frame-copy">
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        {(beginnerMode && help) || actions ? (
          <div className="workspace-pane-frame-actions">
            {beginnerMode && help ? (
              <HelpPopover
                title={help.title}
                whatIs={help.whatIs}
                nextStep={help.nextStep}
                commonMistake={help.commonMistake}
              />
            ) : null}
            {actions}
          </div>
        ) : null}
      </header>
      <div className="workspace-pane-frame-body">{children}</div>
    </section>
  );
}

function CenterHelper({ title, description, actionLabel, onAction }) {
  return (
    <div className="workspace-collapsed-empty">
      <h4>{title}</h4>
      <p>{description}</p>
      {onAction ? (
        <button type="button" className="refresh-btn ui-btn" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default function WorkspaceShell({
  channel,
  projectName,
  branch,
  layoutPreset = 'split',
  onLayoutPresetChange,
  previewFocus = false,
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
  const [internalView, setInternalView] = useState('spec');
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [chatSuppressed, setChatSuppressed] = useState(false);
  const [queuedChatMessage, setQueuedChatMessage] = useState(null);
  const [chatPrefill, setChatPrefill] = useState('');
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [officeModeOverrides, setOfficeModeOverrides] = useState({});
  const buildScrollRef = useRef(null);
  const viewScrollRef = useRef({});

  const projectLabel = projectName || 'ai-office';
  const branchLabel = branch || 'main';
  const hasCreationDraft = Boolean(creationDraft?.text);
  const officeStorageKey = useMemo(() => officeModeKey(projectLabel), [projectLabel]);

  const persistedOfficeMode = useMemo(() => {
    try {
      const raw = localStorage.getItem(officeStorageKey);
      return normalizeOfficeMode(raw, projectLabel);
    } catch {
      return normalizeOfficeMode(null, projectLabel);
    }
  }, [officeStorageKey, projectLabel]);

  const officeMode = hasCreationDraft
    ? 'discuss'
    : (officeModeOverrides[officeStorageKey] || persistedOfficeMode);
  const setOfficeMode = useCallback((nextMode) => {
    const normalized = normalizeOfficeMode(nextMode, projectLabel);
    setOfficeModeOverrides((prev) => ({ ...prev, [officeStorageKey]: normalized }));
    try {
      localStorage.setItem(officeStorageKey, normalized);
    } catch {
      // ignore storage failures
    }
  }, [officeStorageKey, projectLabel]);

  const incomingBuildLayout = normalizeBuildLayoutMode(layoutPreset);
  const {
    mode: storedBuildLayout,
    setMode: setStoredBuildLayout,
    layout,
    updateLayout,
    resetLayout,
  } = useSplitPaneState({
    projectName: projectLabel,
    branch: branchLabel,
    initialMode: incomingBuildLayout,
  });

  const selectedBuildLayout = previewFocus ? 'focus-preview' : storedBuildLayout;

  const setView = onActiveTabChange || setInternalView;
  const buildView = activeTab || internalView;
  const activeView = BUILD_ITEMS.some((item) => item.id === buildView) ? buildView : 'spec';

  useBodyScrollLock(Boolean(showHandoffModal), 'workspace-build-handoff-modal');

  useEffect(() => {
    if (officeMode !== 'build') return;
    markViewOpened(projectLabel, activeView);
  }, [officeMode, projectLabel, activeView, markViewOpened]);

  useEffect(() => {
    const onOpenTab = (event) => {
      const tab = String(event?.detail?.tab || '').trim().toLowerCase();
      if (!BUILD_ITEMS.some((item) => item.id === tab)) return;
      setOfficeMode('build');
      setView(tab);
    };
    window.addEventListener('workspace:open-tab', onOpenTab);
    return () => window.removeEventListener('workspace:open-tab', onOpenTab);
  }, [setView, setOfficeMode]);

  const handlePreviewStateChange = (preview) => {
    setPreviewState(projectLabel, preview);
  };

  useEffect(() => {
    const host = buildScrollRef.current;
    if (!host) return;
    host.scrollTop = viewScrollRef.current[activeView] || 0;
  }, [activeView, selectedBuildLayout, officeMode]);

  const setBuildLayoutMode = (nextMode) => {
    const normalized = normalizeBuildLayoutMode(nextMode);
    setStoredBuildLayout(normalized);
    onLayoutPresetChange?.(canonicalFromBuildLayout(normalized));
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
    setChatSuppressed(false);
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

  const beginBuildHandoff = () => {
    setShowHandoffModal(false);
    setOfficeMode('build');
    setView('spec');
    setBuildLayoutMode('split');
  };

  const closeWorkspaceOverlays = useCallback(() => {
    if (showHandoffModal) {
      setShowHandoffModal(false);
      return true;
    }
    if (chatDrawerOpen) {
      setChatDrawerOpen(false);
      return true;
    }
    return false;
  }, [chatDrawerOpen, showHandoffModal]);

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
      setChatDrawerOpen(false);
      setChatSuppressed(false);
      updateLayout({ collapsed: { chat: false, preview: false } });
    };
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [closeWorkspaceOverlays, updateLayout]);

  const toggleChatPane = () => {
    const next = !layout?.collapsed?.chat;
    updateLayout({ collapsed: { chat: next } });
    if (next && activeView === 'chat') {
      setChatSuppressed(true);
      setView('files');
    }
  };

  const togglePreviewPane = () => {
    updateLayout({ collapsed: { preview: !layout?.collapsed?.preview } });
  };

  const restoreChat = () => {
    setChatSuppressed(false);
    updateLayout({ collapsed: { chat: false } });
    setView('chat');
  };

  const renderBuildViewContent = (viewId) => {
    if (viewId === 'chat') {
      if (chatSuppressed || layout?.collapsed?.chat) {
        return (
          <CenterHelper
            title="Chat is hidden"
            description="Restore chat to continue discussion in build mode."
            actionLabel="Show Chat"
            onAction={restoreChat}
          />
        );
      }
      return renderChatRoom();
    }
    if (viewId === 'files') return <FileViewer channel={channel} beginnerMode={beginnerMode} />;
    if (viewId === 'tasks') return <TaskBoard channel={channel} beginnerMode={beginnerMode} />;
    if (viewId === 'spec') {
      return (
        <SpecPanel
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
          channel={channel}
          onDraftRequest={handleDraftRequest}
          beginnerMode={beginnerMode}
          onStateChange={handlePreviewStateChange}
        />
      );
    }
    if (viewId === 'git') return <GitPanel channel={channel} beginnerMode={beginnerMode} onOpenTab={setView} />;
    return <FileViewer channel={channel} beginnerMode={beginnerMode} />;
  };

  const renderMainPane = () => {
    const meta = paneMeta(activeView);
    const help = PANEL_HELP[activeView] || null;
    return (
      <PaneFrame
        title={meta.title}
        subtitle="Primary build workspace"
        icon={meta.icon}
        className="workspace-pane-main"
        help={help}
        beginnerMode={beginnerMode}
      >
        <div
          ref={buildScrollRef}
          className="workspace-pane-scroll"
          onScroll={(event) => {
            viewScrollRef.current[activeView] = event.currentTarget.scrollTop;
          }}
        >
          <div className="workspace-pane-scroll-content">{renderBuildViewContent(activeView)}</div>
        </div>
      </PaneFrame>
    );
  };

  const renderChatPane = () => (
    <PaneFrame
      title="Chat"
      subtitle="Build collaboration"
      icon="C"
      className="workspace-pane-chat"
      help={PANEL_HELP.chat}
      beginnerMode={beginnerMode}
      actions={(
        <button type="button" className="msg-action-btn ui-btn" onClick={toggleChatPane}>
          Hide
        </button>
      )}
    >
      {renderChatRoom()}
    </PaneFrame>
  );

  const renderPreviewPane = () => (
    <PaneFrame
      title="Preview"
      subtitle="Run and inspect"
      icon="P"
      className="workspace-pane-preview"
      help={PANEL_HELP.preview}
      beginnerMode={beginnerMode}
      actions={(
        <button type="button" className="msg-action-btn ui-btn" onClick={togglePreviewPane}>
          Hide
        </button>
      )}
    >
      <PreviewPanel
        channel={channel}
        onDraftRequest={handleDraftRequest}
        beginnerMode={beginnerMode}
        onStateChange={handlePreviewStateChange}
      />
    </PaneFrame>
  );

  const renderRestoreHandles = () => (
    <>
      {selectedBuildLayout === 'full-ide' && layout?.collapsed?.chat && (
        <button
          type="button"
          className="workspace-restore-handle left"
          onClick={() => updateLayout({ collapsed: { chat: false } })}
          title="Restore chat pane"
        >
          ▸ Chat
        </button>
      )}
      {(selectedBuildLayout === 'split' || selectedBuildLayout === 'full-ide') && layout?.collapsed?.preview && (
        <button
          type="button"
          className="workspace-restore-handle right"
          onClick={() => updateLayout({ collapsed: { preview: false } })}
          title="Restore preview pane"
        >
          Preview ◂
        </button>
      )}
    </>
  );

  const renderBuildLayout = () => {
    if (selectedBuildLayout === 'focus-chat') {
      return (
        <div className="workspace-layout-single">
          <PaneFrame
            title="Chat Focus"
            subtitle="Conversation-first build mode"
            icon="C"
            help={PANEL_HELP.chat}
            beginnerMode={beginnerMode}
          >
            {renderChatRoom()}
          </PaneFrame>
        </div>
      );
    }
    if (selectedBuildLayout === 'focus-files') {
      return (
        <div className="workspace-layout-single">
          <PaneFrame
            title="Files Focus"
            subtitle="File editing mode"
            icon="F"
            help={PANEL_HELP.files}
            beginnerMode={beginnerMode}
          >
            <FileViewer channel={channel} beginnerMode={beginnerMode} />
          </PaneFrame>
        </div>
      );
    }
    if (selectedBuildLayout === 'focus-preview') {
      return (
        <div className="workspace-layout-single">
          <PaneFrame
            title="Preview Focus"
            subtitle="Execution and output"
            icon="P"
            help={PANEL_HELP.preview}
            beginnerMode={beginnerMode}
            actions={(
              <button type="button" className="msg-action-btn ui-btn" onClick={() => setChatDrawerOpen((prev) => !prev)}>
                {chatDrawerOpen ? 'Hide Chat Drawer' : 'Show Chat Drawer'}
              </button>
            )}
          >
            <div className="workspace-preview-focus-wrap">
              <PreviewPanel
                channel={channel}
                onDraftRequest={handleDraftRequest}
                beginnerMode={beginnerMode}
                onStateChange={handlePreviewStateChange}
              />
              {chatDrawerOpen && (
                <aside className="workspace-preview-drawer">
                  {renderChatRoom()}
                </aside>
              )}
            </div>
          </PaneFrame>
        </div>
      );
    }

    if (selectedBuildLayout === 'full-ide') {
      if (layout?.collapsed?.chat && layout?.collapsed?.preview) {
        return (
          <div className="workspace-layout-single">
            {renderMainPane()}
            {renderRestoreHandles()}
          </div>
        );
      }
      if (layout?.collapsed?.chat) {
        return (
          <div className="workspace-layout-split">
            <SplitPane
              direction="vertical"
              ratio={Number(layout?.centerRatio) || 0.64}
              defaultRatio={0.64}
              minPrimary={500}
              minSecondary={360}
              onRatioChange={(nextRatio) => updateLayout({ centerRatio: nextRatio })}
            >
              {renderMainPane()}
              {renderPreviewPane()}
            </SplitPane>
            {renderRestoreHandles()}
          </div>
        );
      }
      if (layout?.collapsed?.preview) {
        return (
          <div className="workspace-layout-split">
            <SplitPane
              direction="vertical"
              ratio={Number(layout?.leftRatio) || 0.24}
              defaultRatio={0.24}
              minPrimary={340}
              minSecondary={520}
              onRatioChange={(nextRatio) => updateLayout({ leftRatio: nextRatio })}
            >
              {renderChatPane()}
              {renderMainPane()}
            </SplitPane>
            {renderRestoreHandles()}
          </div>
        );
      }
      return (
        <div className="workspace-layout-full-ide">
          <SplitPane
            direction="vertical"
            ratio={Number(layout?.leftRatio) || 0.24}
            defaultRatio={0.24}
            minPrimary={340}
            minSecondary={760}
            onRatioChange={(nextRatio) => updateLayout({ leftRatio: nextRatio })}
          >
            {renderChatPane()}
            <SplitPane
              direction="vertical"
              ratio={Number(layout?.centerRatio) || 0.64}
              defaultRatio={0.64}
              minPrimary={420}
              minSecondary={360}
              onRatioChange={(nextRatio) => updateLayout({ centerRatio: nextRatio })}
            >
              {renderMainPane()}
              {renderPreviewPane()}
            </SplitPane>
          </SplitPane>
          {renderRestoreHandles()}
        </div>
      );
    }

    if (activeView === 'preview' || layout?.collapsed?.preview) {
      return (
        <div className="workspace-layout-single">
          {renderMainPane()}
          {renderRestoreHandles()}
        </div>
      );
    }

    return (
      <div className="workspace-layout-split">
        <SplitPane
          direction="vertical"
          ratio={Number(layout?.ratio) || 0.58}
          defaultRatio={0.58}
          minPrimary={420}
          minSecondary={360}
          onRatioChange={(nextRatio) => updateLayout({ ratio: nextRatio })}
        >
          {renderMainPane()}
          {renderPreviewPane()}
        </SplitPane>
        {renderRestoreHandles()}
      </div>
    );
  };

  return (
    <div className="workspace-shell workspace-office-shell">
      <header className="workspace-shell-header compact office-shell-header">
        <div className="workspace-shell-meta">
          <span className="workspace-breadcrumb">{projectLabel}</span>
          <span className="workspace-breadcrumb-sep">→</span>
          <span className="workspace-breadcrumb mode">{officeMode.toUpperCase()}</span>
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
                onChange={setBuildLayoutMode}
                onReset={resetLayout}
                showReset={false}
              />
              {!selectedBuildLayout.startsWith('focus-') && (
                <>
                  <button type="button" className="control-btn ui-btn" onClick={togglePreviewPane}>
                    {layout?.collapsed?.preview ? 'Show Preview' : 'Hide Preview'}
                  </button>
                  <button type="button" className="control-btn ui-btn" onClick={toggleChatPane}>
                    {layout?.collapsed?.chat ? 'Show Chat' : 'Hide Chat'}
                  </button>
                </>
              )}
              <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={runBuildLoop}>
                Run Build Loop
              </button>
              <button type="button" className="control-btn ui-btn" onClick={resetLayout}>
                Reset Layout
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
          <div className="workspace-build-mode">
            <ActivityBar
              items={BUILD_ITEMS}
              activeId={activeView}
              onSelect={(id) => {
                setView(id);
                if (id === 'chat') setChatSuppressed(false);
              }}
            />
            <div className="workspace-build-main">{renderBuildLayout()}</div>
          </div>
        )}
      </div>

      {showHandoffModal && (
        <div className="workspace-handoff-backdrop">
          <div className="workspace-handoff-modal">
            <h3>Start Building</h3>
            <p>
              You are moving from discussion into development mode. The workspace will open build tooling and focus the spec panel first.
            </p>
            <ul>
              <li>Spec opens as the primary panel</li>
              <li>Tasks/files/preview stay available in Build mode</li>
              <li>You can switch back to Discuss anytime</li>
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
