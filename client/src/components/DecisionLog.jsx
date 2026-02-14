import { useState, useEffect } from 'react';
import MessageContent from './MessageContent';

export default function DecisionLog() {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/decisions')
      .then(r => r.json())
      .then(data => { setDecisions(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="panel decision-log">
      <div className="panel-header">
        <h3>📌 Decision Log</h3>
        <button className="refresh-btn" onClick={() => {
          setLoading(true);
          fetch('/api/decisions').then(r => r.json())
            .then(data => { setDecisions(Array.isArray(data) ? data : []); setLoading(false); });
        }}>↻ Refresh</button>
      </div>
      <div className="decision-list">
        {loading && <div className="decision-empty">Loading...</div>}
        {!loading && decisions.length === 0 && (
          <div className="decision-empty">No decisions recorded yet. Decisions are created during Release Gate reviews.</div>
        )}
        {decisions.map(d => (
          <div key={d.id} className={`decision-card status-${d.status}`}>
            <div className="decision-header">
              <span className={`decision-status ${d.status}`}>{d.status?.toUpperCase()}</span>
              <span className="decision-time">{new Date(d.created_at).toLocaleString()}</span>
            </div>
            <div className="decision-body">
              <MessageContent content={d.summary || d.content || 'No details'} />
            </div>
            {d.decided_by && <div className="decision-by">Decided by: {d.decided_by}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
