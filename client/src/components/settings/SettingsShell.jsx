import { useCallback, useEffect, useMemo, useState } from 'react';
import Controls from '../Controls';
import SettingsNav from './SettingsNav';
import ApiKeysPanel from './ApiKeysPanel';
import AgentsTable from './AgentsTable';
import AgentConfigDrawer from './AgentConfigDrawer';
import AppearanceSettings from './AppearanceSettings';
import AdvancedSettings from './AdvancedSettings';
import SetupChecklist from './SetupChecklist';
import { useBeginnerMode } from '../beginner/BeginnerModeContext';

const CATEGORY_KEY = 'ai-office-settings-category';
const DIAGNOSTICS_KEY = 'ai-office-provider-diagnostics';
const SETTINGS_FOCUS_KEY = 'ai-office-settings-focus';
const PROVIDER_ORDER = ['openai', 'claude', 'ollama'];
const RECENT_TEST_WINDOW_MS = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  {
    id: 'general',
    label: 'General',
    description: 'Overview, status, and quick orientation.',
    keywords: ['overview', 'status', 'summary'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, density, and font controls.',
    keywords: ['theme', 'density', 'font'],
  },
  {
    id: 'providers',
    label: 'Providers',
    description: 'API keys, base URLs, models, diagnostics.',
    keywords: ['openai', 'claude', 'ollama', 'keys', 'diagnostics'],
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Per-agent runtime bindings and model routing.',
    keywords: ['agent', 'provider', 'model', 'key'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Export diagnostics and reset local layout state.',
    keywords: ['diagnostics', 'layout', 'reset'],
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version notes and how settings apply.',
    keywords: ['about', 'version', 'help'],
  },
];

function matchesSearch(text, query) {
  const source = String(text || '').toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return source.includes(needle);
}

function categoryMatches(category, query) {
  const blob = [
    category.label,
    category.description,
    ...(category.keywords || []),
  ].join(' ');
  return matchesSearch(blob, query);
}

function loadDiagnostics() {
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDiagnostics(next) {
  try {
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

function parseTimestamp(value) {
  if (!value) return 0;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function providerMapFromList(providers = []) {
  const map = {};
  (providers || []).forEach((provider) => {
    const id = String(provider?.provider || '').trim().toLowerCase();
    if (!id) return;
    map[id] = provider;
  });
  return map;
}

function isOllamaReachable(row) {
  if (!row) return false;
  if (row?.reachable === false || row?.available === false) return false;
  const status = String(row?.status || '').trim().toLowerCase();
  if (['offline', 'error', 'unreachable', 'down'].includes(status)) return false;
  if (row?.last_error) return false;
  return true;
}

function hasAgentBinding(agent) {
  const provider = String(agent?.provider_ref || agent?.backend || '').trim();
  const model = String(agent?.model_id || agent?.model || '').trim();
  return Boolean(provider && model);
}

export default function SettingsShell({
  themeMode,
  onThemeModeChange,
  themeScheme,
  onThemeSchemeChange,
  onCycleThemeScheme,
  activeProject,
  onOpenWorkspace,
}) {
  const {
    enabled: beginnerMode,
    setEnabled: setBeginnerMode,
    resetProjectProgress,
    resetAllProgress,
  } = useBeginnerMode();
  const [category, setCategory] = useState(() => localStorage.getItem(CATEGORY_KEY) || 'general');
  const [search, setSearch] = useState('');
  const [providers, setProviders] = useState([]);
  const [modelCatalog, setModelCatalog] = useState({ providers: {} });
  const [agents, setAgents] = useState([]);
  const [providerDiagnostics, setProviderDiagnostics] = useState(loadDiagnostics);
  const [editingAgent, setEditingAgent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [focusSignal, setFocusSignal] = useState({ target: '', token: 0 });

  const loadProviders = useCallback(async () => {
    const response = await fetch('/api/providers');
    const payload = response.ok ? await response.json() : { providers: [] };
    const list = Array.isArray(payload?.providers) ? payload.providers : [];
    setProviders(list);
    return list;
  }, []);

  const loadAgents = useCallback(async () => {
    const response = await fetch('/api/agents?active_only=false');
    const payload = response.ok ? await response.json() : [];
    const list = Array.isArray(payload) ? payload : [];
    setAgents(list);
    return list;
  }, []);

  const loadModelCatalog = useCallback(async () => {
    const response = await fetch('/api/settings/models');
    const payload = response.ok ? await response.json() : { providers: {} };
    const providersMap = payload?.providers && typeof payload.providers === 'object'
      ? payload.providers
      : {};
    setModelCatalog({ providers: providersMap });
    return providersMap;
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadProviders(), loadAgents(), loadModelCatalog()]);
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load settings data.');
    } finally {
      setLoading(false);
    }
  }, [loadProviders, loadAgents, loadModelCatalog]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    localStorage.setItem(CATEGORY_KEY, category);
  }, [category]);

  const triggerFocus = useCallback((target) => {
    const focusTarget = String(target || '').trim();
    if (!focusTarget) return;
    setFocusSignal({ target: focusTarget, token: Date.now() });
  }, []);

  const jumpToCategory = useCallback((nextCategory, focusTarget = '') => {
    setNotice('');
    setError('');
    setCategory(nextCategory);
    const nextFocus = String(focusTarget || '').trim();
    if (!nextFocus) return;
    try {
      localStorage.setItem(SETTINGS_FOCUS_KEY, nextFocus);
    } catch {
      // ignore storage failures
    }
    triggerFocus(nextFocus);
  }, [triggerFocus]);

  useEffect(() => {
    try {
      const raw = String(localStorage.getItem(SETTINGS_FOCUS_KEY) || '').trim();
      if (!raw) return;
      if (!raw.startsWith(`${category}:`)) return;
      triggerFocus(raw);
      localStorage.removeItem(SETTINGS_FOCUS_KEY);
    } catch {
      // ignore storage failures
    }
  }, [category, triggerFocus]);

  useEffect(() => {
    if (!focusSignal?.target) return undefined;
    const token = focusSignal.token;
    const timer = window.setTimeout(() => {
      setFocusSignal((prev) => (prev.token === token ? { target: '', token: prev.token } : prev));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [focusSignal]);

  const filteredCategories = useMemo(() => {
    const scoped = CATEGORIES.filter((item) => categoryMatches(item, search));
    return scoped.length ? scoped : CATEGORIES;
  }, [search]);

  useEffect(() => {
    if (!filteredCategories.some((item) => item.id === category)) {
      setCategory(filteredCategories[0]?.id || 'general');
    }
  }, [filteredCategories, category]);

  const providerDefaults = useMemo(() => {
    const map = {};
    providers.forEach((row) => {
      if (row?.provider && row?.key_ref) {
        map[row.provider] = row.key_ref;
      }
    });
    return map;
  }, [providers]);

  const setupChecklistItems = useMemo(() => {
    const providerMap = providerMapFromList(providers);
    const openaiConfigured = Boolean(providerMap?.openai?.has_key);
    const claudeConfigured = Boolean(providerMap?.claude?.has_key);
    const ollamaConfigured = isOllamaReachable(providerMap?.ollama);
    const cloudConfigured = openaiConfigured || claudeConfigured;
    const providerConfiguredCount = [openaiConfigured, claudeConfigured, ollamaConfigured].filter(Boolean).length;
    const hasAnyProviderConfigured = providerConfiguredCount > 0;

    const diagnosticsEntries = Object.values(providerDiagnostics || {})
      .filter((entry) => entry && typeof entry === 'object');
    const hasStatusOk = diagnosticsEntries.some((entry) => {
      const status = String(entry?.status || '').trim().toLowerCase();
      return status === 'ok' || status === 'success' || status === 'connected';
    });
    const hasRecentSuccess = diagnosticsEntries.some((entry) => {
      if (entry?.ok !== true) return false;
      const stamp = parseTimestamp(entry?.last_test_at || entry?.last_tested_at);
      if (!stamp) return false;
      return Date.now() - stamp <= RECENT_TEST_WINDOW_MS;
    });
    const diagnosticsAreOld = diagnosticsEntries.length > 0 && !hasRecentSuccess && !hasStatusOk;
    const diagnosticsHealthy = hasRecentSuccess || hasStatusOk;

    const totalAgents = agents.length;
    const routedAgents = agents.filter((agent) => hasAgentBinding(agent)).length;
    const routedCoverage = totalAgents > 0 ? routedAgents / totalAgents : 0;

    const hasProject = Boolean(String(activeProject || '').trim());
    const cloudProviders = [
      openaiConfigured ? 'OpenAI' : '',
      claudeConfigured ? 'Claude' : '',
    ].filter(Boolean).join(' + ');

    const providerItem = (() => {
      if (cloudConfigured) {
        return {
          state: 'pass',
          detail: `Cloud provider key detected (${cloudProviders}).`,
        };
      }
      if (ollamaConfigured) {
        return {
          state: 'warn',
          detail: 'Only local Ollama is ready. Add at least one cloud key for best reliability.',
        };
      }
      return {
        state: 'fail',
        detail: 'No provider key configured and Ollama is not reachable.',
      };
    })();

    const diagnosticsItem = (() => {
      if (!diagnosticsEntries.length) {
        return {
          state: 'fail',
          detail: 'No provider tests recorded yet.',
        };
      }
      if (diagnosticsHealthy && !diagnosticsAreOld) {
        return {
          state: 'pass',
          detail: 'Recent provider connection success found.',
        };
      }
      return {
        state: 'warn',
        detail: 'Provider diagnostics exist but are stale or inconclusive. Re-run tests.',
      };
    })();

    const routingItem = (() => {
      if (!totalAgents) {
        return {
          state: 'fail',
          detail: 'No agents detected. Refresh settings and verify runtime data.',
        };
      }
      if (routedCoverage >= 0.8) {
        return {
          state: 'pass',
          detail: `${routedAgents}/${totalAgents} agents have provider + model bindings.`,
        };
      }
      if (routedAgents > 0) {
        return {
          state: 'warn',
          detail: `${routedAgents}/${totalAgents} agents are fully bound. Complete remaining bindings.`,
        };
      }
      return {
        state: 'fail',
        detail: 'Agents are missing provider/model bindings.',
      };
    })();

    const previewItem = (() => {
      if (!hasProject) {
        return {
          state: 'fail',
          detail: 'No active project selected yet.',
        };
      }
      if (hasAnyProviderConfigured && diagnosticsHealthy) {
        return {
          state: 'pass',
          detail: `Project "${activeProject}" is ready for preview startup checks.`,
        };
      }
      return {
        state: 'warn',
        detail: 'Preview likely needs provider setup or a fresh provider test first.',
      };
    })();

    return [
      {
        id: 'provider-keys',
        title: 'Add provider keys',
        state: providerItem.state,
        detail: providerItem.detail,
        actionLabel: 'Go to Providers',
        onAction: () => jumpToCategory('providers', 'providers:openai'),
      },
      {
        id: 'provider-test',
        title: 'Test provider connection',
        state: diagnosticsItem.state,
        detail: diagnosticsItem.detail,
        actionLabel: 'Open Providers > Test',
        onAction: () => jumpToCategory('providers', 'providers:diagnostics'),
      },
      {
        id: 'agent-routing',
        title: 'Confirm agent routing',
        state: routingItem.state,
        detail: routingItem.detail,
        actionLabel: 'Go to Agents',
        onAction: () => jumpToCategory('agents', 'agents:routing'),
      },
      {
        id: 'preview-ready',
        title: 'Preview ready',
        state: previewItem.state,
        detail: previewItem.detail,
        actionLabel: 'Open Workspace',
        onAction: () => {
          setNotice('');
          setError('');
          onOpenWorkspace?.();
        },
      },
    ];
  }, [activeProject, agents, jumpToCategory, onOpenWorkspace, providerDiagnostics, providers]);

  const updateDiagnostic = (provider, diagnostic) => {
    setProviderDiagnostics((prev) => {
      const next = {
        ...prev,
        [provider]: {
          ...(prev[provider] || {}),
          ...diagnostic,
        },
      };
      saveDiagnostics(next);
      return next;
    });
  };

  const clearMessages = () => {
    if (notice) setNotice('');
    if (error) setError('');
  };

  const renderGeneral = () => (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>General</h4>
          <p>Quick summary of your runtime configuration and what to fix first.</p>
        </div>
        <button type="button" className="ui-btn" onClick={refreshAll} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="settings-general-grid">
        <article>
          <h5>Providers configured</h5>
          <p>{providers.filter((item) => item?.has_key || item?.provider === 'ollama').length} of {PROVIDER_ORDER.length}</p>
        </article>
        <article>
          <h5>Agents available</h5>
          <p>{agents.length}</p>
        </article>
        <article>
          <h5>Active project</h5>
          <p>{activeProject || 'ai-office'}</p>
        </article>
        <article>
          <h5>Current theme</h5>
          <p>{themeMode} / {themeScheme}</p>
        </article>
      </div>

      <SetupChecklist items={setupChecklistItems} />

      <details className="settings-inline-details settings-general-guidance">
        <summary>Beginner guidance and progress reset</summary>
        <div className="settings-general-actions">
          <article className="settings-general-action-card">
            <h5>Beginner Mode</h5>
            <p>Show guided steps, contextual help, and simplified controls across Workspace.</p>
            <div className="settings-general-action-buttons">
              <button
                type="button"
                className={`ui-btn ${beginnerMode ? 'ui-btn-primary' : ''}`}
                onClick={() => setBeginnerMode(!beginnerMode)}
              >
                {beginnerMode ? 'Beginner Mode On' : 'Beginner Mode Off'}
              </button>
            </div>
          </article>

          <article className="settings-general-action-card">
            <h5>Reset Beginner Progress</h5>
            <p>Clear stepper progress and recommended-action history for this project.</p>
            <div className="settings-general-action-buttons">
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  resetProjectProgress(activeProject || 'ai-office');
                  setNotice(`Reset beginner progress for ${activeProject || 'ai-office'}.`);
                  setError('');
                }}
              >
                Reset current project
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  resetAllProgress();
                  setNotice('Reset beginner progress for all projects.');
                  setError('');
                }}
              >
                Reset all projects
              </button>
            </div>
          </article>
        </div>
      </details>
    </section>
  );

  const renderProviders = () => (
    <>
      <ApiKeysPanel
        modelCatalog={modelCatalog}
        focusSignal={focusSignal}
        onSaved={async () => {
          await Promise.all([loadProviders(), loadModelCatalog()]);
        }}
        onDiagnosticUpdate={updateDiagnostic}
        onError={(message) => {
          setError(message);
          setNotice('');
        }}
        onNotice={(message) => {
          setNotice(message);
          setError('');
        }}
      />
    </>
  );

  const renderAgents = () => (
    <>
      <AgentsTable
        agents={agents}
        providerDefaults={providerDefaults}
        search={search}
        focusSignal={focusSignal}
        onEditAgent={(agent) => setEditingAgent(agent)}
      />
      <AgentConfigDrawer
        open={Boolean(editingAgent)}
        agent={editingAgent}
        providerConfigs={providers}
        modelCatalog={modelCatalog}
        onClose={() => setEditingAgent(null)}
        onSaved={async () => {
          await loadAgents();
          await loadProviders();
        }}
        onError={(message) => {
          setError(message);
          setNotice('');
        }}
        onNotice={(message) => {
          setNotice(message);
          setError('');
        }}
      />
    </>
  );

  const renderAdvanced = () => (
    <>
      <AdvancedSettings
        themeMode={themeMode}
        activeProject={activeProject}
        providerDiagnostics={providerDiagnostics}
        focusSignal={focusSignal}
        onError={(message) => {
          setError(message);
          setNotice('');
        }}
        onNotice={(message) => {
          setNotice(message);
          setError('');
        }}
      />

      <details className="settings-inline-details settings-controls-wrap">
        <summary>Legacy controls</summary>
        <p>
          Existing advanced operations are still available here. This section is collapsed by default to keep Settings clean.
        </p>
        <Controls />
      </details>
    </>
  );

  const renderAbout = () => (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>About</h4>
          <p>How these settings affect runtime behavior.</p>
        </div>
      </header>
      <ul className="settings-about-list">
        <li>Provider cards save model/key-reference/base URL using existing API endpoints.</li>
        <li>Agent runtime binds provider + model + key source per agent.</li>
        <li>Appearance options are local UI preferences and do not touch backend state.</li>
        <li>Advanced export creates a local JSON diagnostics report for sharing errors.</li>
      </ul>
    </section>
  );

  return (
    <div className="settings-v3-shell">
      <SettingsNav
        categories={filteredCategories}
        selectedCategory={category}
        onSelectCategory={(next) => {
          clearMessages();
          setCategory(next);
        }}
        search={search}
        onSearchChange={(value) => {
          clearMessages();
          setSearch(value);
        }}
      />

      <section className="settings-v3-content">
        {error ? (
          <div className="settings-v3-banner agent-config-error">
            <strong>Settings error</strong>
            <p>{error}</p>
          </div>
        ) : null}
        {notice ? (
          <div className="settings-v3-banner agent-config-notice">
            <strong>Update</strong>
            <p>{notice}</p>
          </div>
        ) : null}

        {category === 'general' && renderGeneral()}
        {category === 'appearance' && (
          <AppearanceSettings
            themeMode={themeMode}
            onThemeModeChange={onThemeModeChange}
            themeScheme={themeScheme}
            onThemeSchemeChange={onThemeSchemeChange}
            onCycleThemeScheme={onCycleThemeScheme}
          />
        )}
        {category === 'providers' && renderProviders()}
        {category === 'agents' && renderAgents()}
        {category === 'advanced' && renderAdvanced()}
        {category === 'about' && renderAbout()}
      </section>
    </div>
  );
}
