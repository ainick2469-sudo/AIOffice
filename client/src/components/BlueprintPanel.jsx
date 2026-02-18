import { useEffect, useMemo, useState } from 'react';

export default function BlueprintPanel({
  channel = 'main',
  onOpenOracle = null,
}) {
  const [activeProject, setActiveProject] = useState({ project: 'ai-office', branch: 'main' });
  const [blueprint, setBlueprint] = useState({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = () => {
    setLoading(true);
    setNotice('');
    fetch(`/api/blueprint/current?channel=${encodeURIComponent(channel)}`)
      .then(r => r.json())
      .then((data) => {
        if (data?.ok) {
          setBlueprint(data.blueprint || { nodes: [], edges: [] });
        } else {
          setBlueprint({ nodes: [], edges: [] });
          setNotice(data?.error || 'Failed to load blueprint.');
        }
      })
      .catch(() => setNotice('Failed to load blueprint.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch(`/api/projects/active/${channel}`)
      .then(r => r.json())
      .then((data) => {
        setActiveProject({ project: data?.project || 'ai-office', branch: data?.branch || 'main' });
      })
      .catch(() => {});
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const regenerate = () => {
    setLoading(true);
    setNotice('');
    fetch(`/api/blueprint/regenerate?channel=${encodeURIComponent(channel)}`, { method: 'POST' })
      .then(r => r.json())
      .then((data) => {
        if (data?.ok) {
          setBlueprint(data.blueprint || { nodes: [], edges: [] });
          setNotice('Blueprint regenerated.');
        } else {
          setNotice(data?.error || 'Blueprint regeneration failed.');
        }
      })
      .catch(() => setNotice('Blueprint regeneration failed.'))
      .finally(() => setLoading(false));
  };

  const nodes = useMemo(() => (Array.isArray(blueprint?.nodes) ? blueprint.nodes : []), [blueprint]);
  const edges = useMemo(() => (Array.isArray(blueprint?.edges) ? blueprint.edges : []), [blueprint]);

  const layout = useMemo(() => {
    const sec = nodes.filter(n => String(n.id || '').startsWith('sec-'));
    const mod = nodes.filter(n => !String(n.id || '').startsWith('sec-'));

    const positions = {};
    sec.forEach((n, idx) => {
      positions[n.id] = { x: 30, y: 30 + idx * 70 };
    });
    mod.forEach((n, idx) => {
      positions[n.id] = { x: 360, y: 30 + idx * 70 };
    });

    const height = Math.max(200, 60 + Math.max(sec.length, mod.length) * 70);
    const width = 780;
    return { positions, width, height };
  }, [nodes]);

  const openNode = (node) => {
    const terms = Array.isArray(node?.search_terms) ? node.search_terms : [];
    const q = terms[0] || node?.label || '';
    if (!q) return;
    onOpenOracle?.(q);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>🧭 Blueprint</h3>
        <div className="project-path">{activeProject.project} @ {activeProject.branch}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="refresh-btn" onClick={refresh} disabled={loading}>Refresh</button>
          <button onClick={regenerate} disabled={loading}>Regenerate</button>
        </div>
      </div>

      <div className="panel-body">
        {notice && <div className="builder-status">{notice}</div>}
        {loading && <div className="project-path">Loading...</div>}

        {nodes.length === 0 ? (
          <div className="project-path">
            No blueprint yet. Click Regenerate to build one from the current Spec.
          </div>
        ) : (
          <svg width="100%" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8 }}>
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L10,3 L0,6 Z" fill="#94a3b8" />
              </marker>
            </defs>

            {edges.map((e, idx) => {
              const from = layout.positions[e.from];
              const to = layout.positions[e.to];
              if (!from || !to) return null;
              return (
                <line
                  key={`edge-${idx}`}
                  x1={from.x + 260}
                  y1={from.y + 20}
                  x2={to.x}
                  y2={to.y + 20}
                  stroke="#94a3b8"
                  strokeWidth="1.5"
                  markerEnd="url(#arrow)"
                />
              );
            })}

            {nodes.map((n) => {
              const pos = layout.positions[n.id] || { x: 30, y: 30 };
              return (
                <g key={n.id} onClick={() => openNode(n)} style={{ cursor: 'pointer' }}>
                  <rect x={pos.x} y={pos.y} width="260" height="40" rx="8" fill="#0f172a" stroke="#334155" />
                  <text x={pos.x + 10} y={pos.y + 25} fill="#e2e8f0" fontSize="13">
                    {String(n.label || n.id).slice(0, 36)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}

        {nodes.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4>Modules</h4>
            <div className="process-list">
              {nodes.slice(0, 30).map((n) => (
                <div key={`list-${n.id}`} className="process-item">
                  <div className="process-main">
                    <strong>{n.label || n.id}</strong>
                    {Array.isArray(n.search_terms) && n.search_terms[0] && (
                      <div className="process-meta">Search: {n.search_terms[0]}</div>
                    )}
                  </div>
                  <div className="process-actions">
                    <button onClick={() => openNode(n)}>Search in Oracle</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
