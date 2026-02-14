import { useState, useEffect } from 'react';

export default function Controls() {
  const [gateRunning, setGateRunning] = useState(false);
  const [gateHistory, setGateHistory] = useState([]);
  const [pulse, setPulse] = useState({ enabled: false, running: false, interval_seconds: 300 });

  useEffect(() => {
    fetch('/api/pulse/status').then(r => r.json()).then(setPulse).catch(() => {});
    fetch('/api/release-gate/history').then(r => r.json()).then(setGateHistory).catch(() => {});
  }, []);

  const triggerGate = () => {
    setGateRunning(true);
    fetch('/api/release-gate', { method: 'POST' })
      .then(r => r.json())
      .then(() => setTimeout(() => setGateRunning(false), 5000))
      .catch(() => setGateRunning(false));
  };

  const togglePulse = () => {
    const endpoint = pulse.enabled ? '/api/pulse/stop' : '/api/pulse/start';
    fetch(endpoint, { method: 'POST' })
      .then(r => r.json())
      .then(() => fetch('/api/pulse/status').then(r => r.json()).then(setPulse));
  };

  return (
    <div className="panel controls-panel">
      <div className="panel-header"><h3>Controls</h3></div>
      <div className="panel-body">
        <div className="control-section">
          <h4>Release Gate</h4>
          <p className="control-desc">Run multi-agent review pipeline</p>
          <button
            className="control-btn gate-btn"
            onClick={triggerGate}
            disabled={gateRunning}
          >
            {gateRunning ? '🔍 Running...' : '🚀 Run Release Gate'}
          </button>
          {gateHistory.length > 0 && (
            <div className="gate-history">
              <h5>Recent Results</h5>
              {gateHistory.slice(0, 3).map(g => (
                <div key={g.id} className={`gate-result ${g.title.includes('release_ready') ? 'pass' : 'fail'}`}>
                  <span>{g.title}</span>
                  <span className="gate-time">{new Date(g.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="control-section">
          <h4>Office Pulse</h4>
          <p className="control-desc">
            Periodic checks every {pulse.interval_seconds}s
          </p>
          <button className="control-btn pulse-btn" onClick={togglePulse}>
            {pulse.enabled ? '⏸ Stop Pulse' : '💓 Start Pulse'}
          </button>
          <span className={`pulse-status ${pulse.enabled ? 'active' : ''}`}>
            {pulse.enabled ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    </div>
  );
}
