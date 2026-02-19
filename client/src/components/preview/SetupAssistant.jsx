function formatPresetMeta(preset) {
  if (!preset?.port) return 'Port: auto';
  return `Port: ${preset.port}`;
}

export default function SetupAssistant({
  beginnerMode = false,
  loading,
  stackLabel,
  presets,
  setupNotes,
  advancedOpen,
  onToggleAdvanced,
  onUsePreset,
  draftCmd,
  draftPort,
  onDraftCmdChange,
  onDraftPortChange,
  processOptions,
  selectedProcessId,
  onSelectProcess,
  onSaveConfig,
}) {
  return (
    <section className="preview-v3-section preview-v3-setup">
      <div className="preview-v3-section-header">
        <div>
          <h4>Setup Assistant</h4>
          <p>Step 1: choose a run preset, then start preview.</p>
        </div>
        <button type="button" className="control-btn ui-btn" onClick={onToggleAdvanced}>
          {advancedOpen ? 'Hide Advanced' : beginnerMode ? 'Advanced (optional)' : 'Advanced'}
        </button>
      </div>

      <div className="preview-v3-stack-line">
        <span className="pill ui-chip">Detected stack: {stackLabel}</span>
      </div>

      {loading ? (
        <div className="preview-v3-empty-state">Scanning project files for starter presets…</div>
      ) : (
        <div className="preview-v3-preset-grid">
          {(presets || []).map((preset) => (
            <article key={preset.id} className="preview-v3-preset-card">
              <div className="preview-v3-preset-head">
                <h5>{preset.title}</h5>
                <span className="pill ui-chip">{formatPresetMeta(preset)}</span>
              </div>
              <p>{preset.description}</p>
              <code>{preset.command}</code>
              <button type="button" className="control-btn ui-btn" onClick={() => onUsePreset?.(preset)}>
                Use this preset
              </button>
            </article>
          ))}
        </div>
      )}

      {Array.isArray(setupNotes) && setupNotes.length > 0 && (
        <ul className="preview-v3-setup-notes">
          {setupNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {advancedOpen && (
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
              Process
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
            <button type="button" className="control-btn ui-btn" onClick={onSaveConfig}>
              Save Config
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
