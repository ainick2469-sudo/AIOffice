function formatPresetMeta(preset) {
  if (!preset?.port) return 'Port: auto';
  return `Port: ${preset.port}`;
}

export default function SetupAssistant({
  loading,
  stackLabel,
  presets,
  setupNotes,
  draftCmd,
  draftPort,
  onDraftCmdChange,
  onDraftPortChange,
  processOptions,
  selectedProcessId,
  onSelectProcess,
  onSaveConfig,
  onUsePreset,
}) {
  return (
    <section className="preview-v3-advanced-shell">
      <header className="preview-v3-advanced-header">
        <div>
          <h4>Advanced Preview Setup</h4>
          <p>Use this only when you need to override command, port, or process selection.</p>
        </div>
        <span className="pill ui-chip">Detected stack: {stackLabel}</span>
      </header>

      <div className="preview-v3-advanced-notes">
        <p>Command must start a dev server bound to <code>127.0.0.1</code>.</p>
        <p>If you change port, also update command flags to match.</p>
      </div>

      <section className="preview-v3-preset-shell">
        <h5>Use detected preset</h5>
        {loading ? (
          <div className="preview-v3-empty-state compact">Detecting starter presets...</div>
        ) : (
          <div className="preview-v3-preset-grid">
            {(presets || []).map((preset) => (
              <article key={preset.id} className="preview-v3-preset-card">
                <div className="preview-v3-preset-head">
                  <h6>{preset.title}</h6>
                  <span className="pill ui-chip">{formatPresetMeta(preset)}</span>
                </div>
                <p>{preset.description}</p>
                <code>{preset.command}</code>
                <button type="button" className="ui-btn" onClick={() => onUsePreset?.(preset)}>
                  Use preset
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {Array.isArray(setupNotes) && setupNotes.length > 0 ? (
        <ul className="preview-v3-setup-notes">
          {setupNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="preview-v3-advanced-panel">
        <label className="preview-v3-field">
          Preview command
          <input
            value={draftCmd}
            onChange={(event) => onDraftCmdChange?.(event.target.value)}
            placeholder="npm run dev -- --host 127.0.0.1 --port 5173"
          />
        </label>

        <div className="preview-v3-advanced-row">
          <label className="preview-v3-field">
            Preferred port
            <input
              value={draftPort}
              onChange={(event) => onDraftPortChange?.(event.target.value)}
              placeholder="5173"
            />
          </label>

          <label className="preview-v3-field">
            Process selector
            <select
              value={selectedProcessId}
              onChange={(event) => onSelectProcess?.(event.target.value)}
            >
              <option value="">(auto)</option>
              {(processOptions || []).map((proc) => (
                <option key={proc.id} value={proc.id}>
                  {proc.name || proc.id} {proc.port ? `:${proc.port}` : ''} [{proc.status}]
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="preview-v3-advanced-actions">
          <button type="button" className="ui-btn ui-btn-primary" onClick={onSaveConfig}>
            Save Config
          </button>
        </div>
      </div>
    </section>
  );
}
