import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CreateHome from './components/CreateHome';
import ProjectsSidebar from './components/ProjectsSidebar';
import WorkspaceShell from './components/WorkspaceShell';
import SettingsShell from './components/settings/SettingsShell';
import CommandPalette from './components/CommandPalette';
import {
  buildCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  clearCreationDraft,
} from './lib/storage/creationDraft';
import useEscapeKey from './hooks/useEscapeKey';
import useBodyScrollLock, { getBodyScrollLockSnapshot } from './hooks/useBodyScrollLock';
import { clearAllBodyScrollLocks } from './hooks/scrollLockManager';
import { useBeginnerMode } from './components/beginner/BeginnerModeContext';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/components.css';
import './styles/settings.css';
import './styles/draft-discuss.css';
import './styles/chat-upgrade.css';
import './styles/beginner.css';
import './App.css';

const DEFAULT_LAYOUT_PRESET = 'split';
const DEFAULT_PANE_LAYOUT = {
  split: [0.52, 0.48],
  'full-ide': [0.28, 0.4, 0.32],
  'chat-files': [0.45, 0.55],
  'files-preview': [0.62, 0.38],
};
const INGESTION_TASKS = ['Index file tree', 'Summarize architecture', 'Generate Spec + Blueprint'];

function channelForProject(projectName) {
  const name = String(projectName || '').trim().toLowerCase();
  if (!name || name === 'ai-office') return 'main';
  return `proj-${name}`;
}

function sidebarCollapsedKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:workspace:${safe}:sidebarCollapsed`;
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

function toImportFormData(queueItems = [], payload = {}) {
  const items = Array.isArray(queueItems) ? queueItems : [];
  const form = new FormData();
  if (items.length === 1 && items[0]?.kind === 'zip' && items[0]?.entries?.[0]?.file) {
    const only = items[0].entries[0];
    form.append('zip_file', only.file, only.file.name || only.path || 'upload.zip');
  } else {
    items.forEach((item) => {
      (item?.entries || []).forEach((entry) => {
        if (!entry?.file) return;
        form.append('files', entry.file, entry.path || entry.file.name || 'file');
      });
    });
  }

  const prompt = String(payload?.prompt ?? payload?.text ?? '');
  const template = String(payload?.templateId || payload?.template || '');
  const projectName = String(payload?.project_name || payload?.suggestedName || '');
  const stackChoice = String(payload?.stack_choice || payload?.suggestedStack || '');

  if (prompt) form.append('prompt', prompt);
  if (template) form.append('template', template);
  if (projectName) form.append('project_name', projectName);
  if (stackChoice) form.append('stack_choice', stackChoice);
  return form;
}

function buildSeedSpecFromDraft(draft, requestText) {
  const raw = String(requestText || '').trim();
  const stack = String(draft?.suggestedStack || '').trim();
  const summary = draft?.summary || {};
  const goalSummary = String(summary?.goals || '').trim();
  const risks = String(summary?.risks || '').trim();
  const questions = String(summary?.questions || '').trim();
  const nextSteps = String(summary?.nextSteps || '').trim();

  const lines = [
    '# Build Spec',
    '',
    '## Problem / Goal',
    raw ? `- Raw user request (verbatim):\n${raw}` : '- Raw user request (verbatim):\n- [ ] TBD',
    goalSummary ? `- Goal summary: ${goalSummary}` : '- Goal summary: refine during planning.',
    '',
    '## Target Platform',
    stack && stack !== 'auto-detect'
      ? `- Preferred stack: ${stack}`
      : '- Preferred stack: auto-detect',
    '',
    '## Core Loop',
    nextSteps ? `- ${nextSteps}` : '- Discuss -> Plan -> Build -> Verify -> Iterate',
    '',
    '## Features',
    '### Must',
    '- Preserve original user intent in implementation output',
    '### Should',
    '- Provide clear progress and verification visibility',
    '### Could',
    '- Add polish after core loop is stable',
    '',
    '## Non-Goals',
    '- Avoid scope expansion before the first working preview.',
    '',
    '## UX Notes',
    '- Keep workflow beginner-friendly and explicit.',
    '',
    '## Data/State Model',
    '- Draft captures raw request + planning summary until project creation.',
    '',
    '## Acceptance Criteria',
    '- [ ] Original request remains visible verbatim in project spec/history.',
    '- [ ] Build starts only after explicit plan approval.',
    '',
    '## Risks + Unknowns',
    risks ? `- ${risks}` : '- Clarify unresolved technical constraints.',
    questions ? `- ${questions}` : '- Confirm open questions before large code changes.',
    '',
  ];

  return `${lines.join('\n').trim()}\n`;
}

function buildSeedIdeaBankFromDraft(draft, requestText) {
  const raw = String(requestText || '').trim();
  const templateHint = String(draft?.templateHint || draft?.templateId || '').trim();
  const summary = draft?.summary || {};
  const goals = String(summary?.goals || '').trim();
  const questions = String(summary?.questions || '').trim();
  const parts = ['# Idea Bank', '', '## Seed Request'];
  if (raw) {
    parts.push(raw);
  }
  if (templateHint) {
    parts.push('', `Template hint: ${templateHint}`);
  }
  parts.push('', '## Discuss Notes');
  parts.push(goals ? `- Goals: ${goals}` : '- Goals:');
  parts.push(questions ? `- Questions: ${questions}` : '- Questions:');
  return `${parts.join('\n').trim()}\n`;
}

async function persistDraftSeedToProjectSpec(data, draft, requestText) {
  const projectName = String(data?.project || data?.active?.project || '').trim().toLowerCase();
  const channelId = String(data?.channel_id || data?.channel || '').trim();
  if (!projectName || !channelId) return;

  const raw = String(requestText || '');
  const specDraft = String(draft?.specDraftMd || '').trim() || buildSeedSpecFromDraft(draft, raw);
  const ideaBankDraft = String(draft?.ideaBankMd || '').trim() || buildSeedIdeaBankFromDraft(draft, raw);

  await fetch('/api/spec/current', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: channelId,
      spec_md: specDraft,
      idea_bank_md: ideaBankDraft,
    }),
  });
}

function officeModeStorageKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:workspace-office-mode:${safe}`;
}

function normalizeDraftRouteId(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return raw || '';
}

function parseAppPathname(pathname) {
  const path = String(pathname || '/').trim() || '/';
  if (path === '/workspace') return { topTab: 'workspace', draftId: '' };
  if (path === '/settings') return { topTab: 'settings', draftId: '' };
  if (path === '/create') return { topTab: 'create', draftId: '' };
  if (path.startsWith('/create/')) {
    const slug = decodeURIComponent(path.slice('/create/'.length));
    return { topTab: 'create', draftId: normalizeDraftRouteId(slug) };
  }
  return { topTab: 'home', draftId: '' };
}

function buildAppPathname(topTab, draftId = '') {
  if (topTab === 'workspace') return '/workspace';
  if (topTab === 'settings') return '/settings';
  if (topTab === 'create') {
    const safe = normalizeDraftRouteId(draftId);
    return safe ? `/create/${encodeURIComponent(safe)}` : '/create';
  }
  return '/';
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta?.env?.DEV);
const DEBUG_SCROLL_SELECTORS = [
  '.workspace-shell-body',
  '.workspace-pane-scroll',
  '.chat-content .message-list',
  '.thread-body',
  '.status-body',
  '.panel-body',
];

function collectScrollSnapshot() {
  if (typeof document === 'undefined') return [];
  return DEBUG_SCROLL_SELECTORS.map((selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    return {
      selector,
      overflowY: window.getComputedStyle(node).overflowY,
      scrollTop: Math.round(node.scrollTop || 0),
      scrollHeight: Math.round(node.scrollHeight || 0),
      clientHeight: Math.round(node.clientHeight || 0),
    };
  }).filter(Boolean);
}

export default function App() {
  const { enabled: beginnerMode, toggleEnabled: toggleBeginnerMode } = useBeginnerMode();
  const initialRoute = useMemo(
    () => parseAppPathname(typeof window !== 'undefined' ? window.location.pathname : '/'),
    []
  );
  const [theme, setTheme] = useState('dark');
  const [themeMode, setThemeMode] = useState('dark');
  const [topTab, setTopTab] = useState(initialRoute.topTab);
  const [createRouteDraftId, setCreateRouteDraftId] = useState(initialRoute.draftId || '');
  const [workspaceTab, setWorkspaceTab] = useState('builder');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState('default');
  const [paletteEpoch, setPaletteEpoch] = useState(0);
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(normalizeActiveContext({ project: 'ai-office', channel: 'main', branch: 'main' }));
  const [layoutPreset, setLayoutPreset] = useState(DEFAULT_LAYOUT_PRESET);
  const [paneLayout, setPaneLayout] = useState(DEFAULT_PANE_LAYOUT);
  const [previewFocus, setPreviewFocus] = useState(false);
  const [projectsSidebarCollapsed, setProjectsSidebarCollapsed] = useState(() => {
    try {
      const raw = localStorage.getItem(sidebarCollapsedKey('ai-office'));
      if (raw == null) return true;
      return raw === 'true';
    } catch {
      return true;
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [codexMismatch, setCodexMismatch] = useState(false);
  const [dismissCodexBanner, setDismissCodexBanner] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [ingestionProgress, setIngestionProgress] = useState(null);
  const [creationDraft, setCreationDraft] = useState(null);
  const [leaveDraftModalOpen, setLeaveDraftModalOpen] = useState(false);
  const [layoutDebugOpen, setLayoutDebugOpen] = useState(false);
  const [layoutDebug, setLayoutDebug] = useState({
    route: 'home/builder',
    bodyOverflow: '',
    scrollLocks: [],
    scrollContainers: [],
    updatedAt: '',
  });
  const navHistoryRef = useRef([]);

  const activeProject = active.project || 'ai-office';
  const activeChannel = active.channel || channelForProject(activeProject);
  const creationDraftId = String(creationDraft?.draftId || creationDraft?.id || '').trim();
  const routeKey = topTab === 'create'
    ? `${topTab}:${createRouteDraftId || 'draft'}|${workspaceTab}`
    : `${topTab}|${workspaceTab}`;
  const breadcrumbLabel = topTab === 'workspace'
    ? `Workspace / ${workspaceTab}`
    : topTab === 'create'
      ? `Create / ${createRouteDraftId || 'draft'}`
    : topTab === 'settings'
      ? 'Settings'
      : 'Home';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sidebarCollapsedKey(activeProject));
      if (raw == null) {
        setProjectsSidebarCollapsed(true);
      } else {
        setProjectsSidebarCollapsed(raw === 'true');
      }
    } catch {
      setProjectsSidebarCollapsed(true);
    }
  }, [activeProject]);

  useEffect(() => {
    try {
      localStorage.setItem(
        sidebarCollapsedKey(activeProject),
        projectsSidebarCollapsed ? 'true' : 'false'
      );
    } catch {
      // ignore storage failures
    }
  }, [activeProject, projectsSidebarCollapsed]);

  useBodyScrollLock(Boolean(leaveDraftModalOpen), 'leave-draft-modal');

  useEffect(() => {
    const storedMode = (() => {
      try {
        return localStorage.getItem('ai-office-theme-mode');
      } catch {
        return null;
      }
    })();

    if (storedMode === 'dark' || storedMode === 'light' || storedMode === 'system') {
      setThemeMode(storedMode);
      if (storedMode !== 'system') {
        setTheme(storedMode);
      }
      return;
    }

    const legacyTheme = (() => {
      try {
        return localStorage.getItem('ai-office-theme');
      } catch {
        return null;
      }
    })();

    if (legacyTheme === 'dark' || legacyTheme === 'light') {
      setThemeMode(legacyTheme);
      setTheme(legacyTheme);
      try {
        localStorage.setItem('ai-office-theme-mode', legacyTheme);
      } catch {
        // ignore storage failures
      }
      return;
    }

    const prefersLight = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: light)').matches;
    const initialMode = 'system';
    const resolved = prefersLight ? 'light' : 'dark';
    setThemeMode(initialMode);
    setTheme(resolved);
    try {
      localStorage.setItem('ai-office-theme-mode', initialMode);
      localStorage.setItem('ai-office-theme', resolved);
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

    const applyTheme = () => {
      const resolved = themeMode === 'system'
        ? (media?.matches ? 'light' : 'dark')
        : themeMode;
      setTheme(resolved);
      const root = document.documentElement;
      root.setAttribute('data-theme', resolved);
      try {
        localStorage.setItem('ai-office-theme', resolved);
        localStorage.setItem('ai-office-theme-mode', themeMode);
      } catch {
        // ignore storage failures
      }
    };

    applyTheme();
    if (!media || themeMode !== 'system') return undefined;

    const onChange = () => applyTheme();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [themeMode]);

  const navigateToTab = useCallback((nextTopTab, options = {}) => {
    const normalized = String(nextTopTab || 'home').trim().toLowerCase();
    const tab = ['home', 'workspace', 'settings', 'create'].includes(normalized) ? normalized : 'home';
    const nextDraftId = tab === 'create'
      ? normalizeDraftRouteId(options?.draftId || createRouteDraftId)
      : '';
    const pathname = buildAppPathname(tab, nextDraftId);
    const replace = Boolean(options?.replace);
    if (tab === 'create') {
      setCreateRouteDraftId(nextDraftId);
    } else if (createRouteDraftId) {
      setCreateRouteDraftId('');
    }
    setTopTab(tab);
    if (typeof window !== 'undefined') {
      const samePath = window.location.pathname === pathname;
      if (replace || samePath) {
        window.history.replaceState({ topTab: tab, draftId: nextDraftId }, '', pathname);
      } else {
        window.history.pushState({ topTab: tab, draftId: nextDraftId }, '', pathname);
      }
    }
  }, [createRouteDraftId]);

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseAppPathname(window.location.pathname);
      setTopTab(parsed.topTab);
      setCreateRouteDraftId(parsed.draftId || '');
      if (parsed.topTab === 'create') {
        setCreationDraft(loadCreationDraft(parsed.draftId || null));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
    const model = String(codex?.model || '').toLowerCase();
    const legacyModels = new Set(['qwen2.5:14b', 'qwen2.5:32b', 'qwen2.5:7b', 'qwen3:14b', 'qwen3:32b']);
    const mismatch = Boolean(codex && codex.backend === 'ollama' && legacyModels.has(model));
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
        const persistedDraft = loadCreationDraft(createRouteDraftId || null);
        if (!cancelled) {
          setCreationDraft(persistedDraft);
          if (topTab === 'create' && !persistedDraft?.text) {
            navigateToTab('home', { replace: true });
          }
        }

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
    // run once on app boot; route-specific draft updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (topTab !== 'create') return;
    const draft = loadCreationDraft(createRouteDraftId || null);
    setCreationDraft(draft);
    if (!draft?.text) {
      setError('Draft not found. Start again from Home.');
      navigateToTab('home', { replace: true });
    }
  }, [createRouteDraftId, navigateToTab, topTab]);

  useEffect(() => {
    if (topTab !== 'create') return;
    const nextId = creationDraftId;
    if (!nextId) return;
    if (nextId === createRouteDraftId) return;
    navigateToTab('create', { draftId: nextId, replace: true });
  }, [createRouteDraftId, creationDraftId, navigateToTab, topTab]);

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
      navigateToTab('workspace');
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
      navigateToTab('home');
    }
  };

  const updateCreationDraft = (updater) => {
    setCreationDraft((prev) => {
      const base = prev || buildCreationDraft({});
      const candidate = typeof updater === 'function'
        ? updater(base)
        : { ...base, ...(updater || {}) };
      const next = buildCreationDraft(candidate);
      saveCreationDraft(next);
      return next;
    });
  };

  const startCreationDraftDiscussion = async (payload) => {
    const draft = buildCreationDraft({
      ...(payload || {}),
      pipelineStep: 'discuss',
      phase: 'DISCUSS',
      rawRequest: String(payload?.rawRequest ?? payload?.text ?? payload?.prompt ?? ''),
    });
    saveCreationDraft(draft);
    setCreationDraft(draft);
    setCreateRouteDraftId(draft.draftId || draft.id || '');
    setLeaveDraftModalOpen(false);
    navigateToTab('create', { draftId: draft.draftId || draft.id || '' });
    try {
      localStorage.setItem(officeModeStorageKey('ai-office'), 'discuss');
    } catch {
      // ignore storage failures
    }
  };

  const discardCreationDraft = () => {
    clearCreationDraft();
    setCreationDraft(null);
    setLeaveDraftModalOpen(false);
  };

  const createProjectFromDraft = async (overrideDraft = null) => {
    const draft = overrideDraft || creationDraft;
    const requestText = String(draft?.rawRequest ?? draft?.text ?? '');
    if (!requestText.trim()) {
      throw new Error('Draft prompt is empty. Edit the prompt before creating a project.');
    }

    const importRuntime = Array.isArray(draft.importQueueRuntime) ? draft.importQueueRuntime : [];
    const hasImportQueue = Array.isArray(draft.importQueue) && draft.importQueue.length > 0;
    const hasImportFiles = importRuntime.some((item) =>
      Array.isArray(item?.entries) && item.entries.some((entry) => Boolean(entry?.file))
    );

    if (hasImportQueue && !hasImportFiles) {
      throw new Error('Imported files are metadata-only after refresh. Reattach files in Home before creating this project.');
    }

    let data = null;
    if (hasImportFiles) {
      const form = toImportFormData(importRuntime, {
        text: requestText,
        templateId: draft.templateId,
        suggestedName: draft.suggestedName,
        suggestedStack: draft.suggestedStack,
      });
      const resp = await fetch('/api/projects/import', {
        method: 'POST',
        body: form,
      });
      data = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || 'Import failed.');
      }
      const projectName = String(data?.project || '').trim().toLowerCase();
      const channelId = String(data?.channel_id || data?.channel || '').trim();
      if (projectName && channelId) {
        setIngestionProgress({
          project: projectName,
          channel: channelId,
          done: 0,
          total: INGESTION_TASKS.length,
          status: 'running',
        });
      }
    } else {
      const resp = await fetch('/api/projects/create_from_prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: requestText,
          template: draft.templateId || null,
          project_name: draft.suggestedName || null,
        }),
      });
      data = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(data?.detail || data?.error || 'Project creation failed.');
      }
    }

    const projectName = String(data?.project || data?.active?.project || '').trim().toLowerCase();
    if (projectName) {
      try {
        localStorage.setItem(officeModeStorageKey(projectName), 'build');
      } catch {
        // ignore storage failures
      }
    }

    try {
      await persistDraftSeedToProjectSpec(data, draft, requestText);
    } catch (seedError) {
      if (import.meta.env?.DEV) {
        console.warn('[creation] Unable to persist draft seed to spec.', {
          project: projectName || '(unknown)',
          message: seedError?.message || String(seedError),
        });
      }
    }

    clearCreationDraft();
    setCreationDraft(null);
    setCreateRouteDraftId('');
    setLeaveDraftModalOpen(false);
    await openProject(data);
    setWorkspaceTab('spec');
    navigateToTab('workspace');
    return data;
  };

  const openHomeTab = () => {
    navigateToTab('home');
  };

  const openWorkspaceTab = () => {
    if (creationDraft?.text) {
      setLeaveDraftModalOpen(true);
      return;
    }
    navigateToTab('workspace');
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

  const applyWorkspaceLayoutState = async (nextPreset, nextPreviewFocus) => {
    const preset = nextPreset || DEFAULT_LAYOUT_PRESET;
    const focus = Boolean(nextPreviewFocus);
    setLayoutPreset(preset);
    setPreviewFocus(focus);
    await saveProjectUiState(activeProject, focus, preset, paneLayout);
  };

  const handleLayoutPresetChange = async (nextPreset) => {
    await applyWorkspaceLayoutState(nextPreset || DEFAULT_LAYOUT_PRESET, previewFocus);
  };

  const handlePreviewFocusToggle = async () => {
    const next = !previewFocus;
    await applyWorkspaceLayoutState(layoutPreset, next);
  };

  const handleHeaderLayoutChange = async (nextValue) => {
    const value = String(nextValue || '').trim().toLowerCase();
    if (value === 'focus') {
      await applyWorkspaceLayoutState(layoutPreset, true);
      return;
    }
    if (value === 'split' || value === 'full-ide') {
      await applyWorkspaceLayoutState(value, false);
    }
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
    navigateToTab('workspace');
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
        navigateToTab('workspace');
        setWorkspaceTab('chat');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigateToTab]);

  useEffect(() => {
    const history = navHistoryRef.current;
    if (history[history.length - 1] !== routeKey) {
      history.push(routeKey);
      if (history.length > 80) {
        history.splice(0, history.length - 80);
      }
    }
    if (IS_DEV) {
      console.debug('[layout] route', routeKey);
    }
  }, [routeKey]);

  const collectLayoutDebugState = useCallback(() => {
    const locks = getBodyScrollLockSnapshot();
    setLayoutDebug({
      route: routeKey,
      bodyOverflow: locks?.bodyOverflow || '',
      scrollLocks: locks?.locks || [],
      scrollContainers: collectScrollSnapshot(),
      updatedAt: new Date().toLocaleTimeString(),
    });
  }, [routeKey]);

  useEffect(() => {
    if (!IS_DEV || !layoutDebugOpen) return undefined;
    collectLayoutDebugState();
    const interval = window.setInterval(collectLayoutDebugState, 1000);
    const onLockChange = () => collectLayoutDebugState();
    window.addEventListener('ai-office:scroll-lock-changed', onLockChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('ai-office:scroll-lock-changed', onLockChange);
    };
  }, [layoutDebugOpen, collectLayoutDebugState]);

  const goBack = useCallback(() => {
    const detail = { handled: false, source: 'back-button' };
    window.dispatchEvent(new CustomEvent('ai-office:escape', { detail }));
    if (detail.handled) return;

    const history = navHistoryRef.current;
    if (history.length > 1) {
      history.pop();
      const previous = String(history[history.length - 1] || '');
      const [prevTopToken, prevWorkspaceTab] = previous.split('|');
      const [prevTopTab, prevDraftId] = String(prevTopToken || '').split(':');
      navigateToTab(prevTopTab || 'workspace', {
        draftId: prevTopTab === 'create' ? prevDraftId : '',
      });
      if ((prevTopTab || 'workspace') === 'workspace') {
        setWorkspaceTab(prevWorkspaceTab || 'chat');
      }
      return;
    }

    if (topTab !== 'workspace') {
      navigateToTab('workspace');
      setWorkspaceTab('chat');
      return;
    }

    if (workspaceTab !== 'chat') {
      setWorkspaceTab('chat');
      return;
    }

    navigateToTab('home');
  }, [navigateToTab, topTab, workspaceTab]);

  const resetUiState = useCallback(() => {
    clearAllBodyScrollLocks();
    window.dispatchEvent(new CustomEvent('ai-office:reset-ui-state'));
    setPaletteOpen(false);
    setLeaveDraftModalOpen(false);
    navigateToTab('workspace');
    setWorkspaceTab('chat');
    setError('');
    if (IS_DEV) {
      collectLayoutDebugState();
    }
  }, [collectLayoutDebugState, navigateToTab]);

  useEscapeKey((event) => {
    const detail = { handled: false, source: 'global-escape' };
    window.dispatchEvent(new CustomEvent('ai-office:escape', { detail }));
    if (detail.handled) {
      event.preventDefault();
      return;
    }
    if (topTab !== 'workspace') {
      navigateToTab('workspace');
      setWorkspaceTab('chat');
      event.preventDefault();
      return;
    }
    if (workspaceTab !== 'chat') {
      setWorkspaceTab('chat');
      event.preventDefault();
    }
  }, true);

  const cycleThemeMode = () => {
    setThemeMode((prev) => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'system';
      return 'dark';
    });
  };

  const themeLabel = themeMode === 'system'
    ? `System (${theme === 'dark' ? 'Dark' : 'Light'})`
    : (theme === 'dark' ? 'Dark' : 'Light');

  return (
    <div className={`app app-v2 ${previewFocus ? 'preview-focus-enabled' : ''}`} data-theme={theme}>
      {!previewFocus && topTab !== 'create' && (
        <ProjectsSidebar
          projects={sortedProjects}
          activeProject={activeProject}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          collapsed={projectsSidebarCollapsed}
          onToggleCollapsed={() => setProjectsSidebarCollapsed((prev) => !prev)}
        />
      )}

      <div className="app-main-v2">
        <header className="app-topbar-v2">
          <div className="app-header-left">
            <button className="refresh-btn ui-btn app-back-btn" onClick={goBack}>
              Back
            </button>
            <div className="app-brand-mark" aria-label="AI Office">
              <span className="app-brand-dot" />
              <span className="app-brand-text">AI Office</span>
            </div>
            <span className="app-route-breadcrumb">{breadcrumbLabel}</span>
            <nav className="app-topbar-nav" aria-label="Primary">
              <button className={`ui-tab ${topTab === 'home' || topTab === 'create' ? 'active ui-tab-active' : ''}`} onClick={openHomeTab}>Home</button>
              <button className={`ui-tab ${topTab === 'workspace' ? 'active ui-tab-active' : ''}`} onClick={openWorkspaceTab}>Workspace</button>
              <button className={`ui-tab ${topTab === 'settings' ? 'active ui-tab-active' : ''}`} onClick={() => navigateToTab('settings')}>Settings</button>
            </nav>
          </div>

          <div className="app-header-right">
            <div className="app-header-details">
              {topTab === 'workspace' && (
                <>
                  <span className="pill ui-chip">Project: {activeProject}</span>
                  <span className="pill ui-chip">Branch: {active.branch || 'main'}</span>
                  <label className="app-layout-select-wrap">
                    <span>Layout</span>
                    <select
                      className="ui-input"
                      value={previewFocus ? 'focus' : layoutPreset}
                      onChange={(event) => handleHeaderLayoutChange(event.target.value)}
                    >
                      <option value="split">Split</option>
                      <option value="full-ide">Full IDE</option>
                      <option value="focus">Focus</option>
                    </select>
                  </label>
                  <span className={`pill ui-chip ${previewFocus ? 'is-active' : ''}`}>
                    {previewFocus ? 'Preview Focus ON' : 'Preview Focus OFF'}
                  </span>
                  <span className={`pill ui-chip ${beginnerMode ? 'is-active' : ''}`}>
                    Beginner: {beginnerMode ? 'ON' : 'OFF'}
                  </span>
                  <button className="refresh-btn ui-btn" onClick={handlePreviewFocusToggle}>
                    {previewFocus ? 'Exit Preview Mode' : 'Preview Mode'}
                  </button>
                  <button
                    className={`refresh-btn ui-btn beginner-toggle-chip ${beginnerMode ? 'ui-btn-primary' : ''}`}
                    onClick={toggleBeginnerMode}
                  >
                    {beginnerMode ? 'Beginner Mode On' : 'Beginner Mode Off'}
                  </button>
                </>
              )}
              <button
                className="refresh-btn ui-btn app-theme-toggle"
                onClick={cycleThemeMode}
              >
                Theme: {themeLabel}
              </button>
              {IS_DEV && (
                <>
                  <button
                    className={`refresh-btn ui-btn ${layoutDebugOpen ? 'ui-btn-primary' : ''}`}
                    onClick={() => setLayoutDebugOpen((prev) => !prev)}
                  >
                    {layoutDebugOpen ? 'Hide Layout Debug' : 'Layout Debug'}
                  </button>
                  <button className="refresh-btn ui-btn" onClick={resetUiState}>
                    Reset UI State
                  </button>
                </>
              )}
            </div>

            <details className="app-header-compact-menu">
              <summary>Context</summary>
              <div className="app-header-compact-popover">
                {topTab === 'workspace' ? (
                  <>
                    <div className="app-header-compact-row"><strong>Project</strong><span>{activeProject}</span></div>
                    <div className="app-header-compact-row"><strong>Branch</strong><span>{active.branch || 'main'}</span></div>
                    <label className="app-layout-select-wrap compact">
                      <span>Layout</span>
                      <select
                        className="ui-input"
                        value={previewFocus ? 'focus' : layoutPreset}
                        onChange={(event) => handleHeaderLayoutChange(event.target.value)}
                      >
                        <option value="split">Split</option>
                        <option value="full-ide">Full IDE</option>
                        <option value="focus">Focus</option>
                      </select>
                    </label>
                    <button className="refresh-btn ui-btn" onClick={handlePreviewFocusToggle}>
                      {previewFocus ? 'Exit Preview Mode' : 'Preview Mode'}
                    </button>
                    <button
                      className={`refresh-btn ui-btn beginner-toggle-chip ${beginnerMode ? 'ui-btn-primary' : ''}`}
                      onClick={toggleBeginnerMode}
                    >
                      {beginnerMode ? 'Beginner Mode On' : 'Beginner Mode Off'}
                    </button>
                  </>
                ) : null}
                <button
                  className="refresh-btn ui-btn app-theme-toggle"
                  onClick={cycleThemeMode}
                >
                  Theme: {themeLabel}
                </button>
                {IS_DEV && (
                  <>
                    <button
                      className={`refresh-btn ui-btn ${layoutDebugOpen ? 'ui-btn-primary' : ''}`}
                      onClick={() => setLayoutDebugOpen((prev) => !prev)}
                    >
                      {layoutDebugOpen ? 'Hide Layout Debug' : 'Layout Debug'}
                    </button>
                    <button className="refresh-btn ui-btn" onClick={resetUiState}>
                      Reset UI State
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
        </header>

        {loading && <div className="panel-empty">Loading workspace...</div>}
        {!loading && error && <div className="agent-config-error app-error">{error}</div>}
        {!loading && IS_DEV && topTab === 'create' && creationDraft ? (
          <details className="creation-debug-panel">
            <summary>Creation Draft Debug</summary>
            <pre>{JSON.stringify(creationDraft, null, 2)}</pre>
          </details>
        ) : null}

        {!loading && topTab === 'home' && (
          <CreateHome
            projects={sortedProjects}
            onOpenProject={openProject}
            onStartDraftDiscussion={startCreationDraftDiscussion}
            onResumeDraft={(draftId) => navigateToTab('create', { draftId })}
            creationDraft={creationDraft}
            onCreationDraftChange={updateCreationDraft}
            onCreateProjectFromDraft={createProjectFromDraft}
            onDiscardCreationDraft={discardCreationDraft}
            onProjectDeleted={async () => refreshProjects()}
            onProjectRenamed={async () => refreshProjects()}
            createOnly={false}
          />
        )}

        {!loading && topTab === 'create' && (
          <CreateHome
            projects={sortedProjects}
            onOpenProject={openProject}
            onStartDraftDiscussion={startCreationDraftDiscussion}
            onResumeDraft={(draftId) => navigateToTab('create', { draftId })}
            creationDraft={creationDraft}
            onCreationDraftChange={updateCreationDraft}
            onCreateProjectFromDraft={createProjectFromDraft}
            onDiscardCreationDraft={() => {
              discardCreationDraft();
              navigateToTab('home');
            }}
            onProjectDeleted={async () => refreshProjects()}
            onProjectRenamed={async () => refreshProjects()}
            createOnly
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
            onToggleFocusMode={handlePreviewFocusToggle}
            onOpenSettings={() => navigateToTab('settings')}
            projectSidebarCollapsed={projectsSidebarCollapsed}
            onToggleProjectSidebar={() => setProjectsSidebarCollapsed((prev) => !prev)}
            activeTab={workspaceTab}
            onActiveTabChange={setWorkspaceTab}
            creationDraft={creationDraft}
            onCreationDraftChange={updateCreationDraft}
            onCreateProjectFromDraft={createProjectFromDraft}
            onDiscardCreationDraft={() => {
              discardCreationDraft();
              navigateToTab('home');
            }}
            onEditCreationDraft={(payload) => {
              updateCreationDraft((prev) => buildCreationDraft({ ...prev, ...(payload || {}) }));
              navigateToTab('create', { draftId: (creationDraft?.draftId || creationDraft?.id || createRouteDraftId) });
            }}
            ingestionProgress={
              ingestionProgress?.project === activeProject
                ? ingestionProgress
                : null
            }
          />
        )}

        {!loading && topTab === 'settings' && (
          <SettingsShell
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            activeProject={activeProject}
          />
        )}
      </div>

      {codexMismatch && !dismissCodexBanner && (
        <div className="codex-mismatch-banner">
          <div className="codex-mismatch-content">
            <strong>Codex is running locally, not via your Codex/OpenAI backend.</strong>
            <span>Repair now to route Codex through OpenAI.</span>
          </div>
          <div className="codex-mismatch-actions">
            <button className="refresh-btn ui-btn ui-btn-primary" onClick={handleRepairCodex} disabled={repairBusy}>
              {repairBusy ? 'Repairing...' : 'Repair now'}
            </button>
            <button className="msg-action-btn ui-btn" onClick={() => setDismissCodexBanner(true)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {leaveDraftModalOpen && (
        <div className="workspace-handoff-backdrop">
          <div className="workspace-handoff-modal">
            <h3>Uncreated Draft</h3>
            <p>
              You have an uncreated draft. Keep working in Home, or discard it before opening Workspace.
            </p>
            <div className="workspace-handoff-actions">
              <button
                type="button"
                className="msg-action-btn ui-btn"
                onClick={() => {
                  setLeaveDraftModalOpen(false);
                  navigateToTab('create', { draftId: creationDraft?.draftId || creationDraft?.id || createRouteDraftId });
                }}
              >
                Keep working
              </button>
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary"
                onClick={() => {
                  discardCreationDraft();
                  navigateToTab('workspace');
                }}
              >
                Discard Draft & Open Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {IS_DEV && layoutDebugOpen && (
        <aside className="layout-debug-panel">
          <header>
            <strong>Layout Debug</strong>
            <span>{layoutDebug.updatedAt || '—'}</span>
          </header>
          <div className="layout-debug-body">
            <div><strong>Route:</strong> {layoutDebug.route}</div>
            <div><strong>Body overflow:</strong> {layoutDebug.bodyOverflow || '(auto)'}</div>
            <div><strong>Scroll locks:</strong> {layoutDebug.scrollLocks.length}</div>
            <div className="layout-debug-list">
              {(layoutDebug.scrollLocks || []).map((lock) => (
                <div key={lock.id}>
                  <code>{lock.reason}</code>
                </div>
              ))}
              {layoutDebug.scrollLocks.length === 0 ? <div>none</div> : null}
            </div>
            <div><strong>Scroll containers:</strong></div>
            <div className="layout-debug-list">
              {(layoutDebug.scrollContainers || []).map((item) => (
                <div key={item.selector}>
                  <code>{item.selector}</code> [{item.overflowY}] {item.scrollTop}/{item.scrollHeight}
                </div>
              ))}
            </div>
          </div>
          <footer>
            <button className="refresh-btn ui-btn" onClick={collectLayoutDebugState}>Refresh</button>
            <button className="refresh-btn ui-btn" onClick={resetUiState}>Reset UI State</button>
          </footer>
        </aside>
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
