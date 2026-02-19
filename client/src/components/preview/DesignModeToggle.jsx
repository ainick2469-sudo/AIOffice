export default function DesignModeToggle({
  enabled,
  unavailable,
  onToggle,
}) {
  return (
    <div className="preview-v3-design-toggle">
      <div className="preview-v3-design-copy">
        <h4>Design Mode</h4>
        <p>
          Click elements in preview and draft an edit request without touching code.
        </p>
      </div>
      <button
        type="button"
        className={`control-btn ui-btn ${enabled ? 'ui-btn-primary' : ''}`}
        onClick={onToggle}
        disabled={Boolean(unavailable)}
      >
        {enabled ? 'Design Mode On' : 'Design Mode Off'}
      </button>
    </div>
  );
}
