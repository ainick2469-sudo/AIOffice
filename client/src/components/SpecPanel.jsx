import { useEffect, useState } from 'react';

export default function SpecPanel({ channel }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [status, setStatus] = useState({ project: 'ai-office', status: 'none', spec_version: null });
  const [specMd, setSpecMd] = useState('');
  const [ideaMd, setIdeaMd] = useState('');
  const [history, setHistory] = useState([]);
  const [confirmText, setConfirmText] = useState('');
  const [message, setMessage] = useState('');

  const loadCurrent = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/spec/current?channel=${encodeURIComponent(channel || 'main')}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.detail || data?.error || 'Failed to load spec');
      }
      setStatus({ project: data.project, status: data.status, spec_version: data.spec_version });
      setSpecMd(data.spec_md || '');
      setIdeaMd(data.idea_bank_md || '');
      if (data.project) {
        fetch(`/api/spec/history?project=${encodeURIComponent(data.project)}&limit=20`)
          .then(r => (r.ok ? r.json() : { items: [] }))
          .then((payload) => setHistory(payload?.items || []))
          .catch(() => setHistory([]));
      }
    } catch (err) {
      setMessage(err?.message || 'Failed to load spec');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const saveSpec = async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/spec/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel || 'main',
          spec_md: specMd,
          idea_bank_md: ideaMd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.detail || data?.error || 'Failed to save spec');
      }
      setStatus({ project: data.project, status: data.status, spec_version: data.spec_version });
      setHistory((prev) => prev);
      setMessage(`Saved as DRAFT (version ${data.version || data.spec_version || ''})`);
      await loadCurrent();
    } catch (err) {
      setMessage(err?.message || 'Failed to save spec');
    } finally {
      setSaving(false);
    }
  };

  const approveSpec = async () => {
    if (confirmText.trim().toUpperCase() !== 'APPROVE SPEC') {
      setMessage("Type 'APPROVE SPEC' to approve.");
      return;
    }
    setApproving(true);
    setMessage('');
    try {
      const res = await fetch('/api/spec/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel || 'main',
          confirm_text: confirmText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        throw new Error(data?.detail || data?.error || 'Failed to approve spec');
      }
      setConfirmText('');
      setStatus((prev) => ({ ...prev, status: data.status || 'approved' }));
      setMessage('Spec approved. Mutating tools are now allowed.');
      await loadCurrent();
    } catch (err) {
      setMessage(err?.message || 'Failed to approve spec');
    } finally {
      setApproving(false);
    }
  };

  const badgeClass = (value) => {
    const v = (value || '').toLowerCase();
    if (v === 'approved') return 'active';
    if (v === 'draft') return 'warn';
    return '';
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Spec / Idea Bank</h3>
      </div>
      <div className="panel-body">
        <div className="control-section">
          <div className="builder-status">
            Project: <strong>{status.project}</strong>{' '}
            <span className={`convo-status ${badgeClass(status.status)}`}>
              Spec: {String(status.status || 'none').toUpperCase()}
            </span>{' '}
            {status.spec_version ? <span className="convo-status">v{status.spec_version}</span> : null}
          </div>
          <div className="model-controls-row" style={{ marginTop: 8 }}>
            <button className="control-btn pulse-btn" onClick={loadCurrent} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="control-btn gate-btn" onClick={saveSpec} disabled={saving}>
              {saving ? 'Saving...' : 'Save (Draft)'}
            </button>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type APPROVE SPEC"
              style={{ maxWidth: 220 }}
            />
            <button
              className="control-btn gate-btn"
              onClick={approveSpec}
              disabled={approving || String(status.status || '').toLowerCase() !== 'draft'}
              title={String(status.status || '').toLowerCase() !== 'draft' ? 'Spec must be in DRAFT to approve' : ''}
            >
              {approving ? 'Approving...' : 'Approve Spec'}
            </button>
          </div>
          {message ? <div className="builder-status">{message}</div> : null}
        </div>

        <div className="control-section">
          <h4>Build Spec</h4>
          <textarea
            value={specMd}
            onChange={(e) => setSpecMd(e.target.value)}
            placeholder="# Build Spec..."
            style={{ width: '100%', minHeight: 260 }}
          />
        </div>

        <div className="control-section">
          <h4>Idea Bank</h4>
          <textarea
            value={ideaMd}
            onChange={(e) => setIdeaMd(e.target.value)}
            placeholder="# Idea Bank..."
            style={{ width: '100%', minHeight: 200 }}
          />
        </div>

        <div className="control-section">
          <h4>History</h4>
          {history.length === 0 ? (
            <div className="control-desc">No history snapshots yet.</div>
          ) : (
            <div className="gate-history">
              {history.slice(0, 12).map((item) => (
                <div key={item.path} className="gate-result">
                  <span>{item.name}</span>
                  <span className="gate-time">{new Date(item.modified_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

