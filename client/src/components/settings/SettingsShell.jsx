import { useCallback, useEffect, useMemo, useState } from 'react';
import Controls from '../Controls';
import SettingsNav from './SettingsNav';
import ApiKeysPanel from './ApiKeysPanel';
import AgentsTable from './AgentsTable';
import AgentConfigDrawer from './AgentConfigDrawer';
import AdvancedSettings from './AdvancedSettings';
import { useBeginnerMode } from '../beginner/BeginnerModeContext';

const CATEGORY_KEY = 'ai-office-settings-category';
const DIAGNOSTICS_KEY = 'ai-office-provider-diagnostics';
const SETTINGS_FOCUS_KEY = 'ai-office-settings-focus';

const CATEGORIES = [
  {
    id: 'providers',
    label: 'API Keys',
    description: 'Provider keys, model defaults, and connection tests.',
    keywords: ['openai', 'claude', 'ollama', 'providers', 'keys', 'models'],
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Per-agent model bindings and credential source.',
    keywords: ['agents', 'routing', 'model', 'provider'],
  },
  {
    id: 'system',
    label: 'System',
    description: 'Reset tools, diagnostics, and runtime controls.',
    keywords: ['reset', 'diagnostics', 'advanced', 'memory', 'about'],
  },
];

function matchesSearch(text, query) {
  const source = String(text || '').toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return source.includes(needle);
}

function categoryMatches(category, query) {
  const blob = [category.label, category.description, ...(category.keywords || [])].join(' ');
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

  const [category, setCategory] = useState(() => localStorage.getItem(CATEGORY_KEY) || 'providers');
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

  const providerDefaults = useMemo(() => {
    const map = {};
    providers.forEach((row) => {
      if (row?.provider && row?.key_ref) {
        map[row.provider] = row.key_ref;
      }
    });
    return map;
  }, [providers]);

  const hasCloudKeys = useMemo(
    () => providers.some((row) => ['openai', 'claude'].includes(String(row?.provider || '').toLowerCase()) && row?.has_key),
    [providers]
  );

  const firstRunSetup = !hasCloudKeys;

  useEffect(() => {
    if (firstRunSetup && category !== 'providers') {
      setCategory('providers');
    }
  }, [firstRunSetup, category]);

  const diagnosticsSummary = useMemo(() => {
    const entries = Object.entries(providerDiagnostics || {});
    if (!entries.length) return 'No provider diagnostics yet.';
    const ok = entries.filter(([, value]) => value?.ok === true).length;
    return `${ok}/${entries.length} provider diagnostics passing.`;
  }, [providerDiagnostics]);

  const routingSummary = useMemo(() => {
    if (!agents.length) return 'No agents loaded.';
    const routed = agents.filter((agent) => hasAgentBinding(agent)).length;
    return `${routed}/${agents.length} agents have provider/model bindings.`;
  }, [agents]);

  const filteredCategories = useMemo(() => {
    const scoped = CATEGORIES.filter((item) => categoryMatches(item, search));
    return scoped.length ? scoped : CATEGORIES;
  }, [search]);

  useEffect(() => {
    if (!filteredCategories.some((item) => item.id === category)) {
      setCategory(filteredCategories[0]?.id || 'providers');
    }
  }, [filteredCategories, category]);

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

  const renderProviders = () => (
    <>
      <section className="settings-section-card panel">
        <header className="settings-section-head">
          <div>
            <h4>{firstRunSetup ? 'Initial Setup' : 'API Keys'}</h4>
            <p>
              {firstRunSetup
                ? 'Add at least one cloud key to unlock full capability.'
                : 'Manage provider keys, defaults, and connection tests.'}
            </p>
          </div>
          <button type="button" className="ui-btn" onClick={refreshAll} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>
        <div className="settings-general-grid">
          <article>
            <h5>Cloud keys</h5>
            <p>{hasCloudKeys ? 'Configured' : 'Missing'}</p>
          </article>
          <article>
            <h5>Diagnostics</h5>
            <p>{diagnosticsSummary}</p>
          </article>
          <article>
            <h5>Agent routing</h5>
            <p>{routingSummary}</p>
          </article>
          <article>
            <h5>Next</h5>
            <p>{hasCloudKeys ? 'Bind agents and start building.' : 'Save and test your provider keys.'}</p>
          </article>
        </div>
      </section>

      <ApiKeysPanel
        modelCatalog={modelCatalog}
        focusSignal={focusSignal}
        onSaved={async () => {
          await Promise.all([loadProviders(), loadModelCatalog()]);
          if (!hasCloudKeys) {
            setNotice('Provider keys saved. You can now configure agent routing.');
          }
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

  const renderSystem = () => (
    <>
      <section className="settings-section-card panel">
        <header className="settings-section-head">
          <div>
            <h4>System</h4>
            <p>Reset tools, advanced diagnostics, and runtime controls.</p>
          </div>
          <button type="button" className="ui-btn" onClick={() => onOpenWorkspace?.()}>
            Open Workspace
          </button>
        </header>

        <div className="settings-general-actions">
          <article className="settings-general-action-card">
            <h5>Beginner Mode</h5>
            <p>Show or hide guided UI hints.</p>
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
            <h5>Progress reset</h5>
            <p>Clear guided progress indicators without deleting projects.</p>
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
      </section>

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
          Existing advanced operations remain available here.
          Theme mode and scheme now live in the top app bar.
        </p>
        <Controls />
      </details>

      <section className="settings-section-card panel">
        <header className="settings-section-head">
          <div>
            <h4>About</h4>
            <p>How settings affect runtime behavior.</p>
          </div>
        </header>
        <ul className="settings-about-list">
          <li>API Keys configure provider defaults and test diagnostics.</li>
          <li>Agents define per-role provider/model routing.</li>
          <li>System contains reset and diagnostics tools.</li>
        </ul>
      </section>
    </>
  );

  if (firstRunSetup) {
    return (
      <div className="settings-v3-shell">
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
          {renderProviders()}
        </section>
      </div>
    );
  }

  return (
    <div className="settings-v3-shell">
      <SettingsNav
        categories={filteredCategories}
        selectedCategory={category}
        onSelectCategory={(next) => {
          setNotice('');
          setError('');
          setCategory(next);
        }}
        search={search}
        onSearchChange={(value) => {
          setNotice('');
          setError('');
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

        {category === 'providers' && renderProviders()}
        {category === 'agents' && renderAgents()}
        {category === 'system' && renderSystem()}

        {category !== 'providers' && !hasCloudKeys ? (
          <div className="settings-v3-banner agent-config-error">
            <strong>Setup incomplete</strong>
            <p>Add at least one cloud provider key in API Keys before running agent workflows.</p>
            <button type="button" className="ui-btn" onClick={() => jumpToCategory('providers', 'providers:openai')}>
              Go to API Keys
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
