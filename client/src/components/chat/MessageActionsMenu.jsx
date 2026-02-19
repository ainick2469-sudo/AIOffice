export default function MessageActionsMenu({
  open = false,
  pinned = false,
  onToggle,
  onCopy,
  onReply,
  onPinToggle,
  onCreateTask,
  onAddToSpec,
}) {
  return (
    <div className="msg-actions-menu">
      <button
        type="button"
        className="msg-action-btn msg-actions-kebab"
        aria-expanded={open}
        aria-label="Message actions"
        onClick={onToggle}
      >
        ...
      </button>
      {open ? (
        <div className="msg-actions-dropdown">
          <button type="button" onClick={onCopy}>Copy text</button>
          <button type="button" onClick={onReply}>Reply</button>
          <button type="button" onClick={onPinToggle}>{pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" onClick={onCreateTask}>Create task from this</button>
          <button type="button" onClick={onAddToSpec}>Add to spec</button>
        </div>
      ) : null}
    </div>
  );
}
