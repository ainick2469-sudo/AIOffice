export default function ProviderDiagnostics({
  provider,
  status,
  diagnostic,
  onCopyDiagnostics,
}) {
  const lastTestText = diagnostic?.last_test_at
    ? new Date(diagnostic.last_test_at).toLocaleString()
    : 'Not tested yet';

  return (
    <details className="settings-provider-diagnostics">
      <summary>Diagnostics</summary>
      <div className="settings-provider-diagnostics-body">
        <div className="settings-provider-diagnostics-grid">
          <div>
            <span>Provider</span>
            <strong>{provider.toUpperCase()}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div>
            <span>Last test</span>
            <strong>{lastTestText}</strong>
          </div>
          <div>
            <span>Latency</span>
            <strong>{diagnostic?.latency_ms ? `${diagnostic.latency_ms}ms` : 'n/a'}</strong>
          </div>
        </div>

        {diagnostic?.error_summary ? (
          <div className="settings-provider-diagnostics-error">
            <strong>Last error</strong>
            <p>{diagnostic.error_summary}</p>
          </div>
        ) : (
          <div className="settings-provider-diagnostics-ok">
            No provider error recorded.
          </div>
        )}

        <button type="button" className="ui-btn" onClick={onCopyDiagnostics}>
          Copy diagnostics
        </button>
      </div>
    </details>
  );
}
