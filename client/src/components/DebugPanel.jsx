import { useState } from 'react';

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export default function DebugPanel({ channel = 'main' }) {
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastBundleName, setLastBundleName] = useState('');

  const exportBundle = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/debug/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          minutes: Number(minutes || 30),
          include_prompts: false,
          redact_secrets: true,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || payload?.error || `Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `debug-bundle-${channel}-${ts}.zip`;
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setLastBundleName(name);
    } catch (err) {
      setError(err?.message || 'Failed to export debug bundle.');
    } finally {
      setBusy(false);
    }
  };

  const copyInstructions = async () => {
    const ok = await copyToClipboard(
      `Debug bundle: Export a zip from AI Office.\n` +
      `Channel: ${channel}\n` +
      `Minutes: ${minutes}\n` +
      (lastBundleName ? `Last bundle: ${lastBundleName}\n` : '')
    );
    if (!ok) {
      setError('Copy failed (clipboard unavailable).');
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Debug</h3>
        <div className="audit-header-actions">
          <button className="refresh-btn" onClick={() => exportBundle().catch(() => {})} disabled={busy}>
            Export Debug Bundle
          </button>
          <button className="refresh-btn" onClick={() => copyInstructions().catch(() => {})} disabled={busy}>
            Copy Summary
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div className="audit-filter-bar">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ opacity: 0.85 }}>Minutes</span>
            <input
              type="number"
              min="1"
              max="1440"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              style={{ width: 120 }}
            />
          </label>
        </div>

        <div style={{ opacity: 0.85, lineHeight: 1.4 }}>
          Exports a zip containing recent console events, tool logs, task snapshot, active permissions/autonomy,
          and running process logs for the selected channel. Secrets are redacted.
        </div>

        {lastBundleName && (
          <div style={{ marginTop: 12, opacity: 0.9 }}>
            Last export: <code>{lastBundleName}</code>
          </div>
        )}

        {error && <div className="panel-empty audit-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
