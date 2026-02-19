function resetLayoutKeys() {
  const keys = Object.keys(localStorage);
  let removed = 0;
  keys.forEach((key) => {
    const isLayoutKey = key.startsWith('ai-office:') && (
      key.includes('layout')
      || key.includes('pane')
      || key.includes('split')
      || key.includes('workspace-subtab')
      || key.includes('git-layout')
    );
    if (isLayoutKey) {
      localStorage.removeItem(key);
      removed += 1;
    }
  });
  return removed;
}

function buildDiagnostics(themeMode, activeProject, providerDiagnostics) {
  return {
    generated_at: new Date().toISOString(),
    app: 'ai-office',
    frontend_version: 'ui-settings-v3',
    project: activeProject || 'ai-office',
    theme_mode: themeMode,
    user_agent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    ui_density: document.documentElement.getAttribute('data-density') || 'comfortable',
    ui_font_size: document.documentElement.getAttribute('data-font-size') || 'm',
    provider_diagnostics: providerDiagnostics || {},
  };
}

export default function AdvancedSettings({
  themeMode,
  activeProject,
  providerDiagnostics,
  onNotice,
  onError,
}) {
  const exportDiagnostics = async () => {
    try {
      const payload = buildDiagnostics(themeMode, activeProject, providerDiagnostics);
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ai-office-diagnostics-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice?.('Diagnostics bundle exported.');
    } catch (error) {
      onError?.(error?.message || 'Failed to export diagnostics.');
    }
  };

  const resetLayout = () => {
    try {
      const removed = resetLayoutKeys();
      onNotice?.(`Reset UI layout keys (${removed} removed). Reload workspace to apply defaults.`);
    } catch (error) {
      onError?.(error?.message || 'Failed to reset layout keys.');
    }
  };

  return (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>Advanced</h4>
          <p>Diagnostics and local UI state controls. No server changes are made here.</p>
        </div>
      </header>

      <div className="settings-advanced-actions">
        <button type="button" className="ui-btn ui-btn-primary" onClick={exportDiagnostics}>
          Export diagnostics bundle
        </button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={resetLayout}>
          Reset UI layout
        </button>
      </div>
    </section>
  );
}
