export default function LogViewer({
  logsOpen,
  onToggleLogs,
  logsSearch,
  onLogsSearchChange,
  autoScroll,
  onToggleAutoScroll,
  filteredLogs,
  logsRef,
}) {
  return (
    <section className="preview-v3-section preview-v3-logs">
      <div className="preview-v3-section-header">
        <div>
          <h4>Logs</h4>
          <p>Step 3: use logs to confirm startup, URL, and runtime health.</p>
        </div>
        <button type="button" className="control-btn ui-btn" onClick={onToggleLogs}>
          {logsOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {logsOpen && (
        <>
          <div className="preview-v3-log-controls">
            <input
              value={logsSearch}
              onChange={(event) => onLogsSearchChange?.(event.target.value)}
              placeholder="Search logs..."
            />
            <button type="button" className="control-btn ui-btn" onClick={onToggleAutoScroll}>
              {autoScroll ? 'Auto-scroll On' : 'Auto-scroll Off'}
            </button>
          </div>

          <pre ref={logsRef} className="preview-v3-log-body">
            {(filteredLogs || []).length > 0 ? filteredLogs.join('\n') : '(no logs yet)'}
          </pre>
        </>
      )}
    </section>
  );
}
