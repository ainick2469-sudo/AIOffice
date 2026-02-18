import { useEffect, useMemo, useState } from 'react';
import CreateHome from './components/CreateHome';
import ProjectsSidebar from './components/ProjectsSidebar';
import WorkspaceShell from './components/WorkspaceShell';
import AgentConfig from './components/AgentConfig';
import ProviderSettings from './components/ProviderSettings';
import Controls from './components/Controls';
import CommandPalette from './components/CommandPalette';
import './App.css';

const DEFAULT_LAYOUT_PRESET = 'full-ide';
const DEFAULT_PANE_LAYOUT = {
  'full-ide': [0.28, 0.4, 0.32],
  'chat-files': [0.45, 0.55],
  'chat-preview': [0.45, 0.55],
};
const INGESTION_TASKS = ['Index file tree', 'Summarize architecture', 'Generate Spec + Blueprint'];

function channelForProject(projectName) {
  const name = String(projectName || '').trim().toLowerCase();
  if (!name || name === 'ai-office') return 'main';
  return `proj-${name}`;
}

function normalizeActiveContext(raw) {
  const project = String(raw?.project || 'ai-office').trim() || 'ai-office';
  const branch = String(raw?.branch || 'main').trim() || 'main';
  const channel = String(raw?.channel || channelForProject(project)).trim() || channelForProject(project);
  return {
    project,
    branch,
    channel,
    path: raw?.path || '',
    is_app_root: Boolean(raw?.is_app_root),
  };
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

export default function App() {
  const [topTab, setTopTab] = useState('home');
  const [settingsTab, setSettingsTab] = useState('agents');
  const [workspaceTab, setWorkspaceTab] = useState('builder');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState('default');
  const [paletteEpoch, setPaletteEpoch] = useState(0);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(normalizeActiveContext({ project: 'ai-office', channel: 'main', branch: 'main' }));
  const [layoutPreset, setLayoutPreset] = useState(DEFAULT_LAYOUT_PRESET);
  const [paneLayout, setPaneLayout] = useState(DEFAULT_PANE_LAYOUT);
  const [previewFocus, setPreviewFocus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [codexMismatch, setCodexMismatch] = useState(false);
  const [dismissCodexBanner, setDismissCodexBanner] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [ingestionProgress, setIngestionProgress] = useState(null);

  const activeProject = active.project || 'ai-office';
  const activeChannel = active.channel || channelForProject(activeProject);

  const refreshProjects = async () => {
    const resp = await fetch('/api/projects');
    const payload = resp.ok ? await resp.json() : { projects: [] };
    setProjects(Array.isArray(payload?.projects) ? payload.projects : []);
    return payload;
  };

  const refreshCodexMismatch = async () => {
    const resp = await fetch('/api/agents?active_only=false');
    const payload = resp.ok ? await resp.json() : [];
    const codex = (payload || []).find((item) => item.id === 'codex');
    const mismatch = Boolean(codex && codex.backend === 'ollama' && codex.model === 'qwen2.5:14b');
    setCodexMismatch(mismatch);
  };

  const loadProjectUiState = async (projectName) => {
    if (!projectName) return;
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectName)}/ui-state`);
      const payload = resp.ok ? await resp.json() : null;
      if (!payload) return;
      setLayoutPreset(payload.layout_preset || DEFAULT_LAYOUT_PRESET);
      const safePaneLayout = payload?.pane_layout && typeof payload.pane_layout === 'object'
        ? { ...DEFAULT_PANE_LAYOUT, ...payload.pane_layout }
        : DEFAULT_PANE_LAYOUT;
      setPaneLayout(safePaneLayout);
      setPreviewFocus(Boolean(payload.preview_focus_mode));
    } catch {
      setLayoutPreset(DEFAULT_LAYOUT_PRESET);
      setPaneLayout(DEFAULT_PANE_LAYOUT);
      setPreviewFocus(false);
    }
  };

  const saveProjectUiState = async (projectName, nextPreviewFocus, nextLayoutPreset, nextPaneLayout) => {
    if (!projectName) return;
    await fetch(`/api/projects/${encodeURIComponent(projectName)}/ui-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preview_focus_mode: Boolean(nextPreviewFocus),
        layout_preset: nextLayoutPreset || DEFAULT_LAYOUT_PRESET,
        pane_layout: nextPaneLayout || DEFAULT_PANE_LAYOUT,
      }),
    });
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError('');
      try {
        await refreshProjects();
        await refreshCodexMismatch();

        const activeResp = await fetch('/api/projects/active/main');
        const activePayload = activeResp.ok ? await activeResp.json() : null;
        if (!cancelled && activePayload) {
          const normalized = normalizeActiveContext(activePayload);
          setActive(normalized);
          await loadProjectUiState(normalized.project);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load app state.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const openProject = async (source) => {
    setError('');
    try {
      const sourceProject =
        source?.project?.name ||
        source?.project ||
        source?.active?.project ||
        activeProject;
      const name = String(sourceProject || '').trim().toLowerCase();
      if (!name) return;

      const channel = String(source?.channel_id || source?.channel || channelForProject(name)).trim() || channelForProject(name);
      let activePayload = source?.active || null;

      if (!activePayload) {
        const resp = await fetch('/api/projects/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, name }),
        });
        const payload = resp.ok ? await resp.json() : null;
        if (!resp.ok) throw new Error(payload?.detail || 'Failed to open project.');
        activePayload = payload?.active || { project: name, channel };
      }

      const normalized = normalizeActiveContext({ ...activePayload, channel });
      setActive(normalized);
      setTopTab('workspace');
      await loadProjectUiState(normalized.project);
      await refreshProjects();
    } catch (err) {
      setError(err?.message || 'Failed to open project.');
    }
  };

  const renameProject = async (project) => {
    const current = project?.display_name || project?.name || '';
    const next = window.prompt('Rename project', current);
    if (!next || next.trim() === current) return;
    const resp = await fetch(`/api/projects/${encodeURIComponent(project.name)}/display-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: next.trim() }),
    });
    const payload = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      window.alert(payload?.detail || 'Rename failed.');
      return;
    }
    await refreshProjects();
  };

  const deleteProject = async (project) => {
    const confirmed = window.confirm(`Delete project "${project?.display_name || project?.name}"?`);
    if (!confirmed) return;
    const first = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, { method: 'DELETE' });
    const firstPayload = first.ok ? await first.json() : null;
    if (!first.ok) {
      window.alert(firstPayload?.detail || 'Delete failed.');
      return;
    }
    if (firstPayload?.requires_confirmation) {
      const second = await fetch(
        `/api/projects/${encodeURIComponent(project.name)}?confirm_token=${encodeURIComponent(firstPayload.confirm_token)}`,
        { method: 'DELETE' }
      );
      const secondPayload = second.ok ? await second.json() : null;
      if (!second.ok) {
        window.alert(secondPayload?.detail || 'Delete failed.');
        return;
      }
    }
    await refreshProjects();
    if (activeProject === project.name) {
      setActive(normalizeActiveContext({ project: 'ai-office', channel: 'main', branch: 'main', is_app_root: true }));
      setTopTab('home');
    }
  };

  const handleRepairCodex = async () => {
    setRepairBusy(true);
    try {
      await fetch('/api/agents/repair', { method: 'POST' });
      await refreshCodexMismatch();
      setDismissCodexBanner(false);
      window.dispatchEvent(new Event('agents-updated'));
    } finally {
      setRepairBusy(false);
    }
  };

  const handleLayoutPresetChange = async (nextPreset) => {
    const preset = nextPreset || DEFAULT_LAYOUT_PRESET;
    setLayoutPreset(preset);
    await saveProjectUiState(activeProject, previewFocus, preset, paneLayout);
  };

  const handlePreviewFocusToggle = async () => {
    const next = !previewFocus;
    setPreviewFocus(next);
    await saveProjectUiState(activeProject, next, layoutPreset, paneLayout);
  };

  const handlePaneLayoutChange = async (preset, ratios) => {
    if (!preset || !Array.isArray(ratios) || ratios.length === 0) return;
    const nextPaneLayout = {
      ...paneLayout,
      [preset]: ratios,
    };
    setPaneLayout(nextPaneLayout);
    await saveProjectUiState(activeProject, previewFocus, layoutPreset, nextPaneLayout);
  };

  const openWorkspacePanel = (panel) => {
    setTopTab('workspace');
    setWorkspaceTab(panel || 'builder');
  };

  const startPreviewFromPalette = async () => {
    try {
      const configResp = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/build-config`);
      const payload = configResp.ok ? await configResp.json() : null;
      const config = payload?.config || {};
      const command = String(config.preview_cmd || '').trim() || String(config.run_cmd || '').trim();
      if (!command) {
        setError('No preview command configured. Set preview_cmd or run_cmd for this project.');
        return;
      }
      await fetch('/api/process/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeChannel,
          command,
          name: 'preview',
          project: activeProject,
          agent_id: 'user',
          approved: true,
        }),
      });
      openWorkspacePanel('preview');
    } catch (err) {
      setError(err?.message || 'Failed to start preview process.');
    }
  };

  const stopPreviewFromPalette = async () => {
    try {
      const listResp = await fetch(`/api/process/list/${encodeURIComponent(activeChannel)}`);
      const listPayload = listResp.ok ? await listResp.json() : { processes: [] };
      const process = (listPayload?.processes || []).find((item) => item.name === 'preview' && item.status === 'running');
      if (!process) {
        setError('No running preview process for this channel.');
        return;
      }
      await fetch('/api/process/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: activeChannel, process_id: process.id }),
      });
      openWorkspacePanel('preview');
    } catch (err) {
      setError(err?.message || 'Failed to stop preview process.');
    }
  };

  const createTaskFromPalette = () => {
    openWorkspacePanel('tasks');
    window.dispatchEvent(
      new CustomEvent('taskboard:new-task', {
        detail: { title: '', description: '' },
      })
    );
  };

  const handleProjectImported = async (payload) => {
    const projectName = String(payload?.project || '').trim().toLowerCase();
    const channelId = String(payload?.channel_id || payload?.channel || '').trim();
    if (projectName && channelId) {
      setIngestionProgress({
        project: projectName,
        channel: channelId,
        done: 0,
        total: INGESTION_TASKS.length,
        status: 'running',
      });
    }
    await openProject(payload);
  };

  useEffect(() => {
    if (!ingestionProgress?.project || !ingestionProgress?.channel || ingestionProgress.status === 'complete') {
      return undefined;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const resp = await fetch(
          `/api/tasks?channel=${encodeURIComponent(ingestionProgress.channel)}&project_name=${encodeURIComponent(ingestionProgress.project)}`
        );
        const tasks = resp.ok ? await resp.json() : [];
        if (!Array.isArray(tasks)) return;
        const relevant = tasks.filter((task) => INGESTION_TASKS.includes(task?.title));
        const done = relevant.filter((task) => task?.status === 'done').length;
        const total = relevant.length || INGESTION_TASKS.length;
        if (!cancelled) {
          setIngestionProgress((prev) => {
            if (!prev) return prev;
            const nextStatus = done >= total ? 'complete' : 'running';
            return { ...prev, done, total, status: nextStatus };
          });
        }
      } catch {
        // no-op, keep previous progress
      }
    };
    tick();
    const interval = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ingestionProgress?.project, ingestionProgress?.channel, ingestionProgress?.status]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects]);

  const workspacePanelCommands = [
    { id: 'panel-chat', label: 'Open Chat', subtitle: 'Workspace panel', run: () => openWorkspacePanel('chat') },
    { id: 'panel-files', label: 'Open Files', subtitle: 'Workspace panel', run: () => openWorkspacePanel('files') },
    { id: 'panel-tasks', label: 'Open Tasks', subtitle: 'Workspace panel', run: () => openWorkspacePanel('tasks') },
    { id: 'panel-spec', label: 'Open Spec', subtitle: 'Workspace panel', run: () => openWorkspacePanel('spec') },
    { id: 'panel-preview', label: 'Open Preview', subtitle: 'Workspace panel', run: () => openWorkspacePanel('preview') },
    { id: 'panel-git', label: 'Open Git', subtitle: 'Workspace panel', run: () => openWorkspacePanel('git') },
  ];

  const projectCommands = sortedProjects.map((project) => ({
    id: `project-${project.name}`,
    label: `Switch project: ${project.display_name || project.name}`,
    subtitle: project.detected_kind ? `Stack: ${project.detected_kind}` : 'Project',
    run: () => openProject(project),
  }));

  const actionCommands = [
    { id: 'action-start-preview', label: 'Start Preview', subtitle: 'Process action', run: startPreviewFromPalette },
    { id: 'action-stop-preview', label: 'Stop Preview', subtitle: 'Process action', run: stopPreviewFromPalette },
    { id: 'action-create-task', label: 'Create Task', subtitle: 'Open task composer', run: createTaskFromPalette },
  ];

  const paletteCommands = [...workspacePanelCommands, ...actionCommands, ...projectCommands];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      if (!event.ctrlKey) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteMode('default');
        setPaletteEpoch((value) => value + 1);
        setPaletteOpen(true);
        return;
      }
      if (key === 'p') {
        event.preventDefault();
        setPaletteMode('files');
        setPaletteEpoch((value) => value + 1);
        setPaletteOpen(true);
        return;
      }
      if (event.key === '`') {
        event.preventDefault();
        setTopTab('workspace');
        setWorkspaceTab('chat');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={`app app-v2 ${previewFocus ? 'preview-focus-enabled' : ''}`}>
      {!previewFocus && (
        <ProjectsSidebar
          projects={sortedProjects}
          activeProject={activeProject}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
        />
      )}

      <div className="app-main-v2">
        <header className="app-topbar-v2">
          <div className="app-topbar-nav">
            <button className={topTab === 'home' ? 'active' : ''} onClick={() => setTopTab('home')}>Home</button>
            <button className={topTab === 'workspace' ? 'active' : ''} onClick={() => setTopTab('workspace')}>Workspace</button>
            <button className={topTab === 'settings' ? 'active' : ''} onClick={() => setTopTab('settings')}>Settings</button>
          </div>
          {topTab === 'workspace' && (
            <div className="app-topbar-actions">
              <span className="pill">Project: {activeProject}</span>
              <span className="pill">Branch: {active.branch || 'main'}</span>
              <button className="refresh-btn" onClick={handlePreviewFocusToggle}>
                {previewFocus ? 'Exit Preview Mode' : 'Preview Mode'}
              </button>
            </div>
          )}
        </header>

        {loading && <div className="panel-empty">Loading workspace...</div>}
        {!loading && error && <div className="agent-config-error app-error">{error}</div>}

        {!loading && topTab === 'home' && (
          <CreateHome
            projects={sortedProjects}
            onOpenProject={openProject}
            onProjectDeleted={async () => refreshProjects()}
            onProjectRenamed={async () => refreshProjects()}
            onProjectImported={handleProjectImported}
          />
        )}

        {!loading && topTab === 'workspace' && (
          <WorkspaceShell
            channel={activeChannel}
            projectName={activeProject}
            branch={active.branch}
            layoutPreset={layoutPreset}
            onLayoutPresetChange={handleLayoutPresetChange}
            paneLayout={paneLayout}
            onPaneLayoutChange={handlePaneLayoutChange}
            previewFocus={previewFocus}
            activeTab={workspaceTab}
            onActiveTabChange={setWorkspaceTab}
            ingestionProgress={
              ingestionProgress?.project === activeProject
                ? ingestionProgress
                : null
            }
          />
        )}

        {!loading && topTab === 'settings' && (
          <div className="settings-shell">
            <div className="settings-tabs">
              <button className={settingsTab === 'agents' ? 'active' : ''} onClick={() => setSettingsTab('agents')}>
                Agents
              </button>
              <button className={settingsTab === 'providers' ? 'active' : ''} onClick={() => setSettingsTab('providers')}>
                Providers
              </button>
              <button className={settingsTab === 'controls' ? 'active' : ''} onClick={() => setSettingsTab('controls')}>
                Controls
              </button>
            </div>
            {settingsTab === 'agents' && <AgentConfig />}
            {settingsTab === 'providers' && <ProviderSettings />}
            {settingsTab === 'controls' && <Controls />}
          </div>
        )}
      </div>

      {codexMismatch && !dismissCodexBanner && (
        <div className="codex-mismatch-banner">
          <div className="codex-mismatch-content">
            <strong>Codex is running locally, not via your Codex/OpenAI backend.</strong>
            <span>Repair now to route Codex through OpenAI.</span>
          </div>
          <div className="codex-mismatch-actions">
            <button className="refresh-btn" onClick={handleRepairCodex} disabled={repairBusy}>
              {repairBusy ? 'Repairing...' : 'Repair now'}
            </button>
            <button className="msg-action-btn" onClick={() => setDismissCodexBanner(true)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <CommandPalette
        key={`palette-${paletteMode}-${paletteEpoch}`}
        open={paletteOpen}
        mode={paletteMode}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
