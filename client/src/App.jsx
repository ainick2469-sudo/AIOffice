import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CreateHome from './components/CreateHome';
import ProjectsSidebar from './components/ProjectsSidebar';
import WorkspaceShell from './components/WorkspaceShell';
import SettingsShell from './components/settings/SettingsShell';
import CommandPalette from './components/CommandPalette';
import DesktopWindowControls from './components/DesktopWindowControls';
import TooltipLayer from './components/ui/TooltipLayer';
import {
  DESKTOP_WINDOW_STATE_EVENT,
  DESKTOP_WINDOW_SYNC_EVENT,
  hasDesktopWindowApi,
  invokeDesktopWindow,
  normalizeDesktopWindowState,
  syncDesktopWindowState,
} from './lib/desktopWindow';
import {
  buildCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  clearCreationDraft,
} from './lib/storage/creationDraft';
import {
  THEME_MODE_KEY,
  THEME_SCHEME_KEY,
  LEGACY_THEME_MODE_KEY,
  LEGACY_THEME_SCHEME_KEY,
  LEGACY_THEME_KEY,
  getThemeSchemeMeta,
  nextThemeScheme,
  normalizeThemeMode,
  normalizeThemeScheme,
  resolveTheme,
} from './lib/themeCatalog';
import useEscapeKey from './hooks/useEscapeKey';
import useBodyScrollLock, { getBodyScrollLockSnapshot } from './hooks/useBodyScrollLock';
import { clearAllBodyScrollLocks } from './hooks/scrollLockManager';
import { createStartupRequestMeter } from './lib/perf/requestMeter';
import fetchWithTimeout, { FetchWithTimeoutError } from './utils/fetchWithTimeout';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/schemes.css';
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
const DEFAULT_WORKSPACE_TAB = 'chat';
const NAV_STATE_MARKER = '__aiOfficeNav';
const WORKSPACE_TABS = new Set(['chat', 'files', 'git', 'tasks', 'spec', 'preview']);
const TOP_TABS = new Set(['home', 'workspace', 'settings', 'create']);
const INGESTION_TASKS = ['Index file tree', 'Summarize architecture', 'Generate Spec + Blueprint'];
const BOOT_REQUEST_TIMEOUT_MS = 8_000;
const BOOT_HARD_TIMEOUT_MS = 10_000;
const BOOT_STEPS = [
  { name: 'projects', label: 'Loading projects' },
  { name: 'active', label: 'Restoring active workspace' },
  { name: 'providers', label: 'Checking provider setup' },
];

function buildBootSteps(overrides = {}) {
  return BOOT_STEPS.map((step) => {
    const incoming = overrides?.[step.name] || {};
    return {
      ...step,
      status: incoming.status || 'pending',
      detail: incoming.detail || '',
    };
  });
}

function toBootError(step, error, fallbackMessage) {
  const code = String(error?.code || '').trim() || 'UNKNOWN';
  const detail = error?.message || fallbackMessage || 'Boot request failed.';
  return {
    step,
    code,
    message: detail,
    actionHint: code === 'TIMEOUT'
      ? 'Backend timed out. Check the server and retry.'
      : 'Retry startup checks or open Settings to fix provider setup.',
  };
}

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

function normalizeTopTab(value) {
  const raw = String(value || '').trim().toLowerCase();
  return TOP_TABS.has(raw) ? raw : 'home';
}

function normalizeWorkspaceTab(value) {
  const raw = String(value || '').trim().toLowerCase();
  return WORKSPACE_TABS.has(raw) ? raw : DEFAULT_WORKSPACE_TAB;
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

function parseNavState(rawState, pathname = '/') {
  if (!rawState || typeof rawState !== 'object' || rawState?.[NAV_STATE_MARKER] !== true) {
    return null;
  }
  const parsedPath = parseAppPathname(pathname);
  const topTab = normalizeTopTab(rawState.topTab || parsedPath.topTab);
  const draftId = topTab === 'create'
    ? normalizeDraftRouteId(rawState.draftId || parsedPath.draftId || '')
    : '';
  const workspaceTab = normalizeWorkspaceTab(rawState.workspaceTab);
  const navIndex = Number.isFinite(rawState.navIndex)
    ? Math.max(0, Math.trunc(rawState.navIndex))
    : 0;
  return {
    topTab,
    draftId,
    workspaceTab,
    navIndex,
  };
}

function buildNavState({ topTab, workspaceTab, draftId, navIndex }) {
  const normalizedTopTab = normalizeTopTab(topTab);
  const normalizedWorkspaceTab = normalizeWorkspaceTab(workspaceTab);
  return {
    [NAV_STATE_MARKER]: true,
    topTab: normalizedTopTab,
    workspaceTab: normalizedWorkspaceTab,
    draftId: normalizedTopTab === 'create' ? normalizeDraftRouteId(draftId || '') : '',
    navIndex: Number.isFinite(navIndex) ? Math.max(0, Math.trunc(navIndex)) : 0,
  };
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

function prefersLightScheme() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function readThemeMode() {
  if (typeof window === 'undefined') return 'system';
  try {
    const next = localStorage.getItem(THEME_MODE_KEY);
    if (next) return normalizeThemeMode(next);
    const legacy = localStorage.getItem(LEGACY_THEME_MODE_KEY);
    if (legacy) return normalizeThemeMode(legacy);
    const legacyResolved = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacyResolved === 'dark' || legacyResolved === 'light') {
      return legacyResolved;
    }
  } catch {
    // ignore storage failures
  }
  return 'system';
}

function readThemeScheme() {
  if (typeof window === 'undefined') return 'midnight';
  try {
    const next = localStorage.getItem(THEME_SCHEME_KEY);
    if (next) return normalizeThemeScheme(next);
    const legacy = localStorage.getItem(LEGACY_THEME_SCHEME_KEY);
    if (legacy) return normalizeThemeScheme(legacy);
  } catch {
    // ignore storage failures
  }
  return 'midnight';
}

function applyRootThemeAttributes(resolvedTheme, scheme, mode = 'system') {
  if (typeof document === 'undefined') return;
  const normalizedTheme = resolvedTheme === 'light' ? 'light' : 'dark';
  const normalizedScheme = normalizeThemeScheme(scheme);
  const normalizedMode = normalizeThemeMode(mode);
  const root = document.documentElement;
  root.setAttribute('data-mode', normalizedMode);
  root.setAttribute('data-theme', normalizedTheme);
  root.setAttribute('data-scheme', normalizedScheme);
}

const INITIAL_THEME_MODE = readThemeMode();
const INITIAL_THEME_SCHEME = readThemeScheme();
const INITIAL_THEME = resolveTheme(INITIAL_THEME_MODE, prefersLightScheme());
applyRootThemeAttributes(INITIAL_THEME, INITIAL_THEME_SCHEME, INITIAL_THEME_MODE);

export default function App() {
  const initialRoute = useMemo(() => {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
    const parsedPath = parseAppPathname(pathname);
    if (typeof window === 'undefined') {
      return {
        topTab: parsedPath.topTab,
        draftId: parsedPath.draftId || '',
        workspaceTab: DEFAULT_WORKSPACE_TAB,
        navIndex: 0,
      };
    }
    const navState = parseNavState(window.history.state, pathname);
    return {
      topTab: navState?.topTab ?? parsedPath.topTab,
      draftId: navState?.draftId ?? parsedPath.draftId ?? '',
      workspaceTab: navState?.workspaceTab ?? DEFAULT_WORKSPACE_TAB,
      navIndex: navState?.navIndex ?? 0,
    };
  }, []);
  const [themeMode, setThemeMode] = useState(INITIAL_THEME_MODE);
  const [themeScheme, setThemeScheme] = useState(INITIAL_THEME_SCHEME);
  const [theme, setTheme] = useState(INITIAL_THEME);
  const [topTab, setTopTab] = useState(initialRoute.topTab);
  const [createRouteDraftId, setCreateRouteDraftId] = useState(initialRoute.draftId || '');
  const [workspaceTab, setWorkspaceTab] = useState(initialRoute.workspaceTab || DEFAULT_WORKSPACE_TAB);
  const [navIndex, setNavIndex] = useState(initialRoute.navIndex || 0);
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
  const [bootState, setBootState] = useState('idle');
  const [bootSteps, setBootSteps] = useState(() => buildBootSteps());
  const [bootElapsedSeconds, setBootElapsedSeconds] = useState(0);
  const [bootError, setBootError] = useState(null);
  const [error, setError] = useState('');
  const [codexMismatch, setCodexMismatch] = useState(false);
  const [dismissCodexBanner, setDismissCodexBanner] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [ingestionProgress, setIngestionProgress] = useState(null);
  const [creationDraft, setCreationDraft] = useState(null);
  const [leaveDraftModalOpen, setLeaveDraftModalOpen] = useState(false);
  const [desktopWindowState, setDesktopWindowState] = useState(() =>
    normalizeDesktopWindowState({ state: 'unknown', maximized: false, fullscreen: false, minimized: false })
  );
  const [layoutDebugOpen, setLayoutDebugOpen] = useState(false);
  const [layoutDebug, setLayoutDebug] = useState({
    route: 'home/chat',
    bodyOverflow: '',
    scrollLocks: [],
    scrollContainers: [],
    updatedAt: '',
  });
  const homeRequestMeterRef = useRef(null);
  if (!homeRequestMeterRef.current) {
    homeRequestMeterRef.current = createStartupRequestMeter('home-shell');
  }
  const bootAbortRef = useRef(null);
  const bootStartRef = useRef(0);

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
    const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

    const applyTheme = () => {
      const resolved = resolveTheme(themeMode, Boolean(media?.matches));
      setTheme(resolved);
      applyRootThemeAttributes(resolved, themeScheme, themeMode);
      try {
        localStorage.setItem(THEME_MODE_KEY, themeMode);
        localStorage.setItem(THEME_SCHEME_KEY, themeScheme);
        localStorage.setItem(LEGACY_THEME_SCHEME_KEY, themeScheme);
        localStorage.setItem(LEGACY_THEME_MODE_KEY, themeMode);
        localStorage.setItem(LEGACY_THEME_KEY, resolved);
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
  }, [themeMode, themeScheme]);

  const navigateToTab = useCallback((nextTopTab, options = {}) => {
    const tab = normalizeTopTab(nextTopTab);
    const nextWorkspaceTab = normalizeWorkspaceTab(options?.workspaceTab || workspaceTab);
    const nextDraftId = tab === 'create'
      ? normalizeDraftRouteId(options?.draftId || createRouteDraftId)
      : '';
    const pathname = buildAppPathname(tab, nextDraftId);
    const replace = Boolean(options?.replace);
    const forcePush = Boolean(options?.forcePush);
    if (tab === 'create') {
      setCreateRouteDraftId(nextDraftId);
    } else if (createRouteDraftId) {
      setCreateRouteDraftId('');
    }
    if (nextWorkspaceTab !== workspaceTab) {
      setWorkspaceTab(nextWorkspaceTab);
    }
    setTopTab(tab);
    if (typeof window !== 'undefined') {
      const samePath = window.location.pathname === pathname;
      const shouldReplace = !forcePush && (replace || samePath);
      const nextNavIndex = shouldReplace ? navIndex : navIndex + 1;
      const state = buildNavState({
        topTab: tab,
        workspaceTab: nextWorkspaceTab,
        draftId: nextDraftId,
        navIndex: nextNavIndex,
      });
      if (shouldReplace) {
        window.history.replaceState(state, '', pathname);
      } else {
        window.history.pushState(state, '', pathname);
      }
      setNavIndex(nextNavIndex);
    }
  }, [createRouteDraftId, navIndex, workspaceTab]);

  const setWorkspaceTabWithHistory = useCallback((nextTab, options = {}) => {
    const normalized = normalizeWorkspaceTab(nextTab);
    const replace = Boolean(options?.replace);
    const forcePush = options?.forcePush !== undefined ? Boolean(options.forcePush) : !replace;
    const changed = normalized !== workspaceTab;
    if (changed) {
      setWorkspaceTab(normalized);
    }
    if (topTab !== 'workspace') {
      navigateToTab('workspace', { replace, workspaceTab: normalized });
      return;
    }
    if (changed || replace) {
      navigateToTab('workspace', {
        replace,
        workspaceTab: normalized,
        forcePush,
      });
    }
  }, [navigateToTab, topTab, workspaceTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const marked = parseNavState(window.history.state, window.location.pathname);
    if (marked) return;
    const parsed = parseAppPathname(window.location.pathname);
    const initialState = buildNavState({
      topTab: parsed.topTab,
      workspaceTab,
      draftId: parsed.draftId || '',
      navIndex: 0,
    });
    window.history.replaceState(initialState, '', window.location.pathname);
    setNavIndex(0);
    // initialize marker once on app boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPopState = (event) => {
      const marked = parseNavState(event?.state, window.location.pathname);
      if (marked) {
        setTopTab(marked.topTab);
        setWorkspaceTab(marked.workspaceTab);
        setCreateRouteDraftId(marked.draftId || '');
        setNavIndex(marked.navIndex);
        if (marked.topTab === 'create') {
          setCreationDraft(loadCreationDraft(marked.draftId || null));
        }
        return;
      }
      const parsed = parseAppPathname(window.location.pathname);
      const safeTopTab = normalizeTopTab(parsed.topTab);
      setTopTab(safeTopTab);
      setWorkspaceTab(DEFAULT_WORKSPACE_TAB);
      setCreateRouteDraftId(parsed.draftId || '');
      setNavIndex(0);
      if (safeTopTab === 'create') {
        setCreationDraft(loadCreationDraft(parsed.draftId || null));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refreshProjects = useCallback(async (options = {}) => {
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : BOOT_REQUEST_TIMEOUT_MS;
    homeRequestMeterRef.current?.track('/api/projects');
    const { data } = await fetchWithTimeout('/api/projects', {
      signal: options?.signal,
      timeoutMs,
    });
    const payload = data && typeof data === 'object' ? data : { projects: [] };
    setProjects(Array.isArray(payload?.projects) ? payload.projects : []);
    return payload;
  }, []);

  const refreshCodexMismatch = useCallback(async (options = {}) => {
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : BOOT_REQUEST_TIMEOUT_MS;
    homeRequestMeterRef.current?.track('/api/agents?active_only=false');
    const { data } = await fetchWithTimeout('/api/agents?active_only=false', {
      signal: options?.signal,
      timeoutMs,
    });
    const payload = Array.isArray(data) ? data : [];
    const codex = payload.find((item) => item.id === 'codex');
    const model = String(codex?.model || '').toLowerCase();
    const legacyModels = new Set(['qwen2.5:14b', 'qwen2.5:32b', 'qwen2.5:7b', 'qwen3:14b', 'qwen3:32b']);
    const mismatch = Boolean(codex && codex.backend === 'ollama' && legacyModels.has(model));
    setCodexMismatch(mismatch);
    return mismatch;
  }, []);

  const loadProjectUiState = useCallback(async (projectName, options = {}) => {
    if (!projectName) return;
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : BOOT_REQUEST_TIMEOUT_MS;
    try {
      const { data } = await fetchWithTimeout(`/api/projects/${encodeURIComponent(projectName)}/ui-state`, {
        signal: options?.signal,
        timeoutMs,
      });
      const payload = data && typeof data === 'object' ? data : null;
      if (!payload) return;
      setLayoutPreset(payload.layout_preset || DEFAULT_LAYOUT_PRESET);
      const safePaneLayout = payload?.pane_layout && typeof payload.pane_layout === 'object'
        ? { ...DEFAULT_PANE_LAYOUT, ...payload.pane_layout }
        : DEFAULT_PANE_LAYOUT;
      setPaneLayout(safePaneLayout);
      setPreviewFocus(Boolean(payload.preview_focus_mode));
    } catch {
      if (options?.silent) return;
      setLayoutPreset(DEFAULT_LAYOUT_PRESET);
      setPaneLayout(DEFAULT_PANE_LAYOUT);
      setPreviewFocus(false);
    }
  }, []);

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

  const runBoot = useCallback(async (options = {}) => {
    const reason = String(options?.reason || 'startup');
    bootAbortRef.current?.abort();
    const controller = new AbortController();
    bootAbortRef.current = controller;
    bootStartRef.current = Date.now();
    setBootElapsedSeconds(0);
    setBootState('booting');
    setBootError(null);
    setBootSteps(buildBootSteps());
    if (reason !== 'workspace-open') {
      setError('');
    }

    const nextStepState = {
      projects: { status: 'pending', detail: '' },
      active: { status: 'pending', detail: '' },
      providers: { status: 'pending', detail: '' },
    };
    const markStep = (name, status, detail = '') => {
      if (bootAbortRef.current !== controller) return;
      nextStepState[name] = { status, detail };
      setBootSteps(buildBootSteps(nextStepState));
    };

    const hardTimeout = window.setTimeout(() => {
      controller.abort('boot-hard-timeout');
    }, BOOT_HARD_TIMEOUT_MS);

    try {
      const persistedDraft = loadCreationDraft(createRouteDraftId || null);
      setCreationDraft(persistedDraft);
      if (topTab === 'create' && !persistedDraft?.text) {
        navigateToTab('home', { replace: true });
      }

      const projectsPromise = (async () => {
        try {
          await refreshProjects({ signal: controller.signal, timeoutMs: BOOT_REQUEST_TIMEOUT_MS });
          markStep('projects', 'ok');
        } catch (error) {
          const detail = error?.message || 'Unable to load projects.';
          markStep('projects', 'fail', detail);
          throw toBootError('projects', error, detail);
        }
      })();

      const activeProjectPromise = (async () => {
        try {
          homeRequestMeterRef.current?.track('/api/projects/active/main');
          const { data } = await fetchWithTimeout('/api/projects/active/main', {
            signal: controller.signal,
            timeoutMs: BOOT_REQUEST_TIMEOUT_MS,
          });
          if (data) {
            const normalized = normalizeActiveContext(data);
            setActive(normalized);
          }
          markStep('active', 'ok');
        } catch (error) {
          const detail = error?.message || 'Unable to restore active workspace.';
          markStep('active', 'fail', detail);
          throw toBootError('active', error, detail);
        }
      })();

      const providersPromise = (async () => {
        try {
          homeRequestMeterRef.current?.track('/api/providers');
          await fetchWithTimeout('/api/providers', {
            signal: controller.signal,
            timeoutMs: BOOT_REQUEST_TIMEOUT_MS,
          });
          markStep('providers', 'ok');
        } catch (error) {
          const detail = error?.message || 'Unable to read provider status.';
          markStep('providers', 'fail', detail);
          throw toBootError('providers', error, detail);
        }
      })();

      const settled = await Promise.allSettled([projectsPromise, activeProjectPromise, providersPromise]);
      if (bootAbortRef.current !== controller) return;

      const failures = settled
        .filter((entry) => entry.status === 'rejected')
        .map((entry) => entry.reason)
        .filter(Boolean);

      if (failures.length > 0) {
        const primaryError = failures[0];
        setBootError(primaryError);
        setBootState(failures.length >= BOOT_STEPS.length ? 'error' : 'partial');
        setError(primaryError?.message || 'Startup is incomplete.');
      } else {
        setBootError(null);
        setBootState('ready');
      }
    } catch (error) {
      if (bootAbortRef.current !== controller) return;
      if (controller.signal.aborted) {
        const timeoutError = toBootError(
          'boot',
          new FetchWithTimeoutError('Startup timed out before completion.', 'TIMEOUT'),
          'Startup timed out before completion.'
        );
        setBootError(timeoutError);
        setBootState('error');
        setError(timeoutError.message);
        return;
      }
      const normalized = toBootError('boot', error, 'Failed to initialize app state.');
      setBootError(normalized);
      setBootState('error');
      setError(normalized.message);
    } finally {
      window.clearTimeout(hardTimeout);
      if (bootAbortRef.current === controller) {
        bootAbortRef.current = null;
      }
    }
  }, [createRouteDraftId, navigateToTab, refreshProjects, topTab]);

  useEffect(() => {
    runBoot({ reason: 'startup' });
    // startup boot runs once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bootState !== 'booting') return undefined;
    const tick = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - bootStartRef.current) / 1000));
      setBootElapsedSeconds(elapsed);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [bootState]);

  useEffect(() => {
    return () => {
      bootAbortRef.current?.abort();
      homeRequestMeterRef.current?.stop('app-unmount');
    };
  }, []);

  useEffect(() => {
    if (topTab !== 'workspace') return undefined;
    const controller = new AbortController();
    loadProjectUiState(activeProject, {
      signal: controller.signal,
      timeoutMs: BOOT_REQUEST_TIMEOUT_MS,
      silent: true,
    });
    return () => controller.abort();
  }, [activeProject, loadProjectUiState, topTab]);

  useEffect(() => {
    if (!(topTab === 'workspace' || topTab === 'settings')) return undefined;
    const controller = new AbortController();
    refreshCodexMismatch({
      signal: controller.signal,
      timeoutMs: BOOT_REQUEST_TIMEOUT_MS,
    }).catch(() => {});
    return () => controller.abort();
  }, [refreshCodexMismatch, topTab]);

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

  const createProjectFromDraft = async (overrideDraft = null, options = {}) => {
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
    const requestedTab = String(options?.openTab || 'spec').trim().toLowerCase();
    const nextTab = ['chat', 'spec', 'preview'].includes(requestedTab) ? requestedTab : 'spec';
    navigateToTab('workspace', { workspaceTab: nextTab });
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
    setWorkspaceTabWithHistory(panel || DEFAULT_WORKSPACE_TAB);
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
  const desktopAvailable = hasDesktopWindowApi();
  const desktopIsFullscreen = Boolean(desktopWindowState?.fullscreen);

  const syncDesktopState = useCallback(async () => {
    if (!desktopAvailable) return;
    const synced = await syncDesktopWindowState();
    if (synced?.ok) {
      setDesktopWindowState(normalizeDesktopWindowState(synced.state));
    }
  }, [desktopAvailable]);

  const exitDesktopFullscreen = useCallback(async () => {
    if (!desktopAvailable) return false;
    const result = await invokeDesktopWindow('exit_fullscreen');
    if (result?.ok) {
      setDesktopWindowState(normalizeDesktopWindowState(result?.state || result));
      window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
      return true;
    }
    return false;
  }, [desktopAvailable]);

  const toggleDesktopFullscreen = useCallback(async () => {
    if (!desktopAvailable) return false;
    const result = await invokeDesktopWindow('toggle_fullscreen');
    if (result?.ok) {
      setDesktopWindowState(normalizeDesktopWindowState(result?.state || result));
      window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
      return true;
    }
    return false;
  }, [desktopAvailable]);

  useEffect(() => {
    if (!desktopAvailable) return undefined;
    const onState = (event) => {
      setDesktopWindowState(normalizeDesktopWindowState(event?.detail || {}));
    };
    const onSync = () => {
      syncDesktopState();
    };
    window.addEventListener(DESKTOP_WINDOW_STATE_EVENT, onState);
    window.addEventListener(DESKTOP_WINDOW_SYNC_EVENT, onSync);
    syncDesktopState();
    return () => {
      window.removeEventListener(DESKTOP_WINDOW_STATE_EVENT, onState);
      window.removeEventListener(DESKTOP_WINDOW_SYNC_EVENT, onSync);
    };
  }, [desktopAvailable, syncDesktopState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'F11') {
        if (!desktopAvailable) return;
        event.preventDefault();
        void toggleDesktopFullscreen();
        return;
      }
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
        setWorkspaceTabWithHistory(DEFAULT_WORKSPACE_TAB);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktopAvailable, setWorkspaceTabWithHistory, toggleDesktopFullscreen]);

  useEffect(() => {
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

  const canGoBack = useMemo(() => {
    if (typeof window === 'undefined') return topTab !== 'home';
    const marked = parseNavState(window.history.state, window.location.pathname);
    const hasMarkedHistory = window.history.length > 1 && Boolean(marked?.navIndex > 0);
    return hasMarkedHistory || topTab !== 'home';
  }, [navIndex, topTab]);

  const safeBack = useCallback(() => {
    const detail = { handled: false, source: 'back-button' };
    window.dispatchEvent(new CustomEvent('ai-office:escape', { detail }));
    if (detail.handled) return;

    if (typeof window !== 'undefined') {
      const marked = parseNavState(window.history.state, window.location.pathname);
      if (window.history.length > 1 && marked?.navIndex > 0) {
        window.history.back();
        return;
      }
    }

    if (topTab !== 'home') {
      navigateToTab('home', { replace: true });
      return;
    }
  }, [navigateToTab, topTab]);

  const resetUiState = useCallback(() => {
    clearAllBodyScrollLocks();
    window.dispatchEvent(new CustomEvent('ai-office:reset-ui-state'));
    window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
    setPaletteOpen(false);
    setLeaveDraftModalOpen(false);
    setWorkspaceTabWithHistory(DEFAULT_WORKSPACE_TAB, { replace: true, forcePush: false });
    setError('');
    if (IS_DEV) {
      collectLayoutDebugState();
    }
  }, [collectLayoutDebugState, setWorkspaceTabWithHistory]);

  useEscapeKey((event) => {
    if (desktopIsFullscreen) {
      event.preventDefault();
      void exitDesktopFullscreen();
      return;
    }
    const detail = { handled: false, source: 'global-escape' };
    window.dispatchEvent(new CustomEvent('ai-office:escape', { detail }));
    if (detail.handled) {
      event.preventDefault();
      return;
    }
    if (topTab !== 'workspace') {
      setWorkspaceTabWithHistory(DEFAULT_WORKSPACE_TAB, { replace: true, forcePush: false });
      event.preventDefault();
      return;
    }
    if (workspaceTab !== DEFAULT_WORKSPACE_TAB) {
      setWorkspaceTabWithHistory(DEFAULT_WORKSPACE_TAB, { replace: true, forcePush: false });
      event.preventDefault();
    }
  }, true);

  const cycleThemeScheme = () => {
    setThemeScheme((prev) => nextThemeScheme(prev));
  };

  const themeLabel = themeMode === 'system'
    ? `System (${theme === 'dark' ? 'Dark' : 'Light'})`
    : (theme === 'dark' ? 'Dark' : 'Light');
  const schemeLabel = getThemeSchemeMeta(themeScheme).label;
  const startupIncomplete = bootState === 'partial' || bootState === 'error';
  const workspaceBooting = topTab === 'workspace' && bootState === 'booting';
  const globalStatusLabel = bootState === 'booting'
    ? 'Starting…'
    : (topTab === 'workspace' ? 'Workspace' : topTab === 'settings' ? 'Settings' : 'Ready');

  return (
    <div
      className={`app app-v2 ${previewFocus ? 'preview-focus-enabled' : ''}`}
    >
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
          <div className="app-header-left pywebview-no-drag">
            <button
              className={`refresh-btn ui-btn app-back-btn pywebview-no-drag ${canGoBack ? '' : 'is-disabled'}`}
              onClick={safeBack}
              disabled={!canGoBack}
              aria-disabled={!canGoBack}
            >
              Back
            </button>
            <div className="app-drag-region pywebview-drag-region">
              <div className="app-brand-mark" aria-label="AI Office">
                <span className="app-brand-dot" />
                <span className="app-brand-text">AI Office</span>
              </div>
              <span className="app-route-breadcrumb">{breadcrumbLabel}</span>
            </div>
            <nav className="app-topbar-nav pywebview-no-drag" aria-label="Primary">
              <button className={`ui-tab pywebview-no-drag ${topTab === 'home' || topTab === 'create' ? 'active ui-tab-active' : ''}`} onClick={openHomeTab}>Home</button>
              <button className={`ui-tab pywebview-no-drag ${topTab === 'workspace' ? 'active ui-tab-active' : ''}`} onClick={openWorkspaceTab}>Workspace</button>
              <button className={`ui-tab pywebview-no-drag ${topTab === 'settings' ? 'active ui-tab-active' : ''}`} onClick={() => navigateToTab('settings')}>Settings</button>
            </nav>
          </div>

          <div className="app-header-right pywebview-no-drag">
            {desktopIsFullscreen ? (
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary app-exit-fullscreen-btn pywebview-no-drag"
                onClick={() => {
                  void exitDesktopFullscreen();
                }}
              >
                Exit Fullscreen
              </button>
            ) : null}
            <div className="app-header-details">
              <span className="pill ui-chip app-global-status">
                {globalStatusLabel}
              </span>
              <button
                className="refresh-btn ui-btn app-theme-toggle"
                onClick={cycleThemeScheme}
                data-tooltip="Cycle color scheme"
              >
                🎨 Scheme: {schemeLabel}
              </button>
              <span className="pill ui-chip">Mode: {themeLabel}</span>
              {desktopIsFullscreen ? <span className="pill ui-chip">Fullscreen active</span> : null}
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
              <summary>More</summary>
              <div className="app-header-compact-popover">
                <div className="app-header-compact-row"><strong>View</strong><span>{topTab}</span></div>
                {desktopIsFullscreen ? (
                  <button
                    type="button"
                    className="refresh-btn ui-btn ui-btn-primary"
                    onClick={() => {
                      void exitDesktopFullscreen();
                    }}
                  >
                    Exit Fullscreen
                  </button>
                ) : null}
                <button
                  className="refresh-btn ui-btn app-theme-toggle"
                  onClick={cycleThemeScheme}
                  data-tooltip="Cycle color scheme"
                >
                  🎨 Scheme: {schemeLabel}
                </button>
                <span className="pill ui-chip">Mode: {themeLabel}</span>
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
            <DesktopWindowControls className="pywebview-no-drag" />
          </div>
        </header>

        {startupIncomplete && (
          <div className={`startup-status-banner ${bootState === 'error' ? 'error' : 'partial'}`}>
            <div className="startup-status-copy">
              <strong>Setup incomplete</strong>
              <p>{bootError?.message || 'Some startup checks failed. You can keep using Home while fixing setup.'}</p>
              <div className="startup-status-meta">
                {bootSteps.map((step) => (
                  <span key={step.name} className={`startup-step startup-step-${step.status}`}>
                    {step.label}: {step.status === 'ok' ? 'ok' : step.status === 'fail' ? 'failed' : 'pending'}
                  </span>
                ))}
              </div>
            </div>
            <div className="startup-status-actions">
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary"
                onClick={() => runBoot({ reason: 'retry' })}
              >
                Retry
              </button>
              <button
                type="button"
                className="refresh-btn ui-btn"
                onClick={() => navigateToTab('settings')}
              >
                Open Settings
              </button>
              {topTab === 'workspace' ? (
                <button
                  type="button"
                  className="refresh-btn ui-btn"
                  onClick={() => navigateToTab('home', { replace: true })}
                >
                  Continue to Home
                </button>
              ) : null}
            </div>
          </div>
        )}

        {error && !startupIncomplete && <div className="agent-config-error app-error">{error}</div>}
        {IS_DEV && topTab === 'create' && creationDraft ? (
          <details className="creation-debug-panel">
            <summary>Creation Draft Debug</summary>
            <pre>{JSON.stringify(creationDraft, null, 2)}</pre>
          </details>
        ) : null}

        {topTab === 'home' && (
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

        {topTab === 'create' && (
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

        {workspaceBooting && (
          <div className="workspace-boot-state panel">
            <div className="workspace-boot-state-copy">
              <h3>Loading workspace…</h3>
              <p>Trying for {bootElapsedSeconds}s. You can go back Home if startup checks keep failing.</p>
            </div>
            <ul className="workspace-boot-step-list">
              {bootSteps.map((step) => (
                <li key={step.name} className={`workspace-boot-step workspace-boot-step-${step.status}`}>
                  <span>{step.label}</span>
                  <strong>{step.status === 'ok' ? 'ok' : step.status === 'fail' ? 'failed' : 'pending'}</strong>
                </li>
              ))}
            </ul>
            <div className="workspace-boot-actions">
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary"
                onClick={() => runBoot({ reason: 'workspace-retry' })}
              >
                Retry
              </button>
              <button
                type="button"
                className="refresh-btn ui-btn"
                onClick={() => navigateToTab('settings')}
              >
                Open Settings
              </button>
              <button
                type="button"
                className="refresh-btn ui-btn"
                onClick={() => navigateToTab('home', { replace: true })}
              >
                Continue to Home
              </button>
            </div>
          </div>
        )}

        {!workspaceBooting && topTab === 'workspace' && (
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
            onActiveTabChange={setWorkspaceTabWithHistory}
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

        {topTab === 'settings' && (
          <SettingsShell
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            themeScheme={themeScheme}
            onThemeSchemeChange={setThemeScheme}
            onCycleThemeScheme={cycleThemeScheme}
            activeProject={activeProject}
            onOpenWorkspace={() => navigateToTab('workspace')}
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

      <TooltipLayer dismissToken={routeKey} />

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
