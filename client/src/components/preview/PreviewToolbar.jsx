export default function PreviewToolbar({
  statusLabel,
  statusClass,
  isRunning,
  previewUrl,
  onStart,
  onStop,
  onRestart,
  onOpenExternal,
  onCopyUrl,
}) {
  return (
    <section className="preview-v3-section preview-v3-controls">
      <div className="preview-v3-section-header">
        <div>
          <h4>Preview Controls</h4>
          <p>Step 2: start or restart your app server and keep an eye on status.</p>
        </div>
        <span className={`preview-v3-status ${statusClass}`}>{statusLabel}</span>
      </div>

      <div className="preview-v3-control-row">
        <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={onStart}>
          Start
        </button>
        <button type="button" className="control-btn ui-btn" onClick={onStop} disabled={!isRunning}>
          Stop
        </button>
        <button type="button" className="control-btn ui-btn" onClick={onRestart}>
          Restart
        </button>
      </div>

      {previewUrl ? (
        <div className="preview-v3-url-row">
          <button
            type="button"
            className="preview-v3-url-btn"
            onClick={onOpenExternal}
            title={previewUrl}
          >
            Open Preview {previewUrl}
          </button>
          <button type="button" className="control-btn ui-btn" onClick={onCopyUrl}>
            Copy URL
          </button>
          <button type="button" className="control-btn ui-btn" onClick={onOpenExternal}>
            Open External
          </button>
        </div>
      ) : (
        <div className="preview-v3-url-waiting">
          <strong>Waiting for server URL…</strong>
          <span>When your app starts, the live URL appears here automatically.</span>
        </div>
      )}
    </section>
  );
}
