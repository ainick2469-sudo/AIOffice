import { useCallback, useEffect, useState } from 'react';

const LIMIT = 200;

export default function ConsolePanel({ channel = 'main' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ eventType: '', source: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(LIMIT) });
      if (filters.eventType) params.set('event_type', filters.eventType);
      if (filters.source) params.set('source', filters.source);
      const response = await fetch(`/api/console/events/${channel}?${params.toString()}`);
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(payload?.detail || `Failed to load console events (${response.status})`);
      }
      setEvents(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setError(err?.message || 'Failed to load console events.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [channel, filters.eventType, filters.source]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="panel console-panel">
      <div className="panel-header">
        <h3>Console Events</h3>
        <div className="audit-header-actions">
          <button className="refresh-btn" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>
      <div className="panel-body">
        <div className="audit-filter-bar">
          <input
            type="text"
            placeholder="Filter by event type..."
            value={filters.eventType}
            onChange={(event) => setFilters(prev => ({ ...prev, eventType: event.target.value }))}
          />
          <input
            type="text"
            placeholder="Filter by source..."
            value={filters.source}
            onChange={(event) => setFilters(prev => ({ ...prev, source: event.target.value }))}
          />
        </div>

        {error && <div className="panel-empty audit-error">{error}</div>}
        {loading && <div className="panel-empty">Loading...</div>}
        {!loading && events.length === 0 && (
          <div className="panel-empty">No console events for this channel.</div>
        )}

        {!loading && events.map((item) => {
          const severity = item.severity || 'info';
          return (
            <div key={item.id} className={`console-entry severity-${severity}`}>
              <div className="audit-header">
                <span className="audit-agent">{item.source}</span>
                <span className={`audit-type type-${item.event_type}`}>{item.event_type}</span>
                <span className="audit-time">{new Date(item.created_at).toLocaleString()}</span>
              </div>
              {item.message && <div className="audit-command">{item.message}</div>}
              {item.data && Object.keys(item.data).length > 0 && (
                <pre className="audit-output">{JSON.stringify(item.data, null, 2)}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
