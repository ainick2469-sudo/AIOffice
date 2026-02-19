export default function ContextStrip({
  items = [],
  onRemove,
  onOpenPicker,
}) {
  return (
    <div className="chat-context-strip">
      <div className="chat-context-strip-title">Context</div>
      <div className="chat-context-strip-items">
        {items.length === 0 ? (
          <span className="chat-context-strip-empty">No context selected.</span>
        ) : (
          items.map((item) => (
            <span key={item.id} className="chat-context-chip">
              <strong>{item.type}</strong>
              <span>{item.label}</span>
              <button type="button" onClick={() => onRemove?.(item.id)} aria-label="Remove context">
                x
              </button>
            </span>
          ))
        )}
      </div>
      <button type="button" className="msg-action-btn ui-btn" onClick={onOpenPicker}>
        + Add context
      </button>
    </div>
  );
}
