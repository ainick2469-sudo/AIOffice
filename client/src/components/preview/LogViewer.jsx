export default function LogViewer({
  logsSearch,
  onLogsSearchChange,
  autoScroll,
  onToggleAutoScroll,
  paused,
  onTogglePaused,
  filteredLogs,
  logsRef,
}) {
  return (
    <section className="preview-v3-section preview-v3-logs">
      <div className="preview-v3-section-header">
        <div>
          <h4>Logs</h4>
          <p>Use logs for startup diagnostics, URL detection, and runtime errors.</p>
        </div>
        <div className="preview-v3-log-controls">
          <button type="button" className="ui-btn" onClick={onTogglePaused}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="ui-btn" onClick={onToggleAutoScroll}>
            Auto-scroll: {autoScroll ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="preview-v3-log-search-row">
        <input
          value={logsSearch}
          onChange={(event) => onLogsSearchChange?.(event.target.value)}
          placeholder="Search logs..."
        />
      </div>

      <pre ref={logsRef} className="preview-v3-log-body">
        {(filteredLogs || []).length > 0 ? filteredLogs.join('\n') : '(no logs yet)'}
      </pre>
    </section>
  );
}
