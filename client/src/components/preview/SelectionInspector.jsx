function valueOrDash(value) {
  const text = String(value || '').trim();
  return text || '—';
}

export default function SelectionInspector({
  enabled,
  unavailableReason,
  selection,
  previewUrl,
  requestText,
  onRequestTextChange,
  onDraftRequest,
  onCopyDraft,
}) {
  if (!enabled && !selection && !unavailableReason) return null;

  return (
    <section className="preview-v3-section preview-v3-inspector">
      <div className="preview-v3-section-header">
        <div>
          <h4>Selection Inspector</h4>
          <p>Select an element in preview, then describe the change you want.</p>
        </div>
      </div>

      {unavailableReason ? (
        <div className="preview-v3-fallback">
          <strong>Design Mode unavailable in embedded preview.</strong>
          <span>{unavailableReason}</span>
          <span>Use Open Preview, then describe what you clicked.</span>
        </div>
      ) : (
        <div className="preview-v3-selection-grid">
          <div className="preview-v3-selection-item">
            <span>Tag</span>
            <strong>{valueOrDash(selection?.tag)}</strong>
          </div>
          <div className="preview-v3-selection-item">
            <span>ID</span>
            <strong>{valueOrDash(selection?.id)}</strong>
          </div>
          <div className="preview-v3-selection-item">
            <span>Classes</span>
            <strong>{Array.isArray(selection?.classes) && selection.classes.length > 0 ? selection.classes.join(' ') : '—'}</strong>
          </div>
          <div className="preview-v3-selection-item wide">
            <span>DOM path</span>
            <strong>{valueOrDash(selection?.path)}</strong>
          </div>
          <div className="preview-v3-selection-item wide">
            <span>Text snippet</span>
            <strong>{valueOrDash(selection?.text)}</strong>
          </div>
          <div className="preview-v3-selection-item wide">
            <span>URL</span>
            <strong>{valueOrDash(previewUrl)}</strong>
          </div>
        </div>
      )}

      <label className="preview-v3-field">
        What change do you want?
        <textarea
          value={requestText}
          onChange={(event) => onRequestTextChange?.(event.target.value)}
          placeholder="Example: Make this button larger, use rounded corners, and switch the label to 'Start Free Trial'."
        />
      </label>

      <div className="preview-v3-inspector-actions">
        <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={onDraftRequest}>
          Draft Edit Request
        </button>
        <button type="button" className="control-btn ui-btn" onClick={onCopyDraft}>
          Copy Draft
        </button>
      </div>
    </section>
  );
}
