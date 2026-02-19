import { useEffect, useRef } from 'react';

function matchesSearch(agent, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const blob = [
    agent?.id,
    agent?.display_name,
    agent?.backend,
    agent?.model,
    agent?.provider_key_ref,
    agent?.role,
  ]
    .map((part) => String(part || '').toLowerCase())
    .join(' ');
  return blob.includes(needle);
}

export default function AgentsTable({
  agents,
  providerDefaults,
  search,
  focusSignal,
  onEditAgent,
}) {
  const filtered = (agents || []).filter((agent) => matchesSearch(agent, search));
  const sectionRef = useRef(null);

  useEffect(() => {
    const target = String(focusSignal?.target || '').trim().toLowerCase();
    if (!target.startsWith('agents:')) return undefined;
    if (!sectionRef.current) return undefined;
    sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    sectionRef.current.classList.add('settings-focus-flash');
    const timer = window.setTimeout(() => sectionRef.current?.classList.remove('settings-focus-flash'), 2200);
    return () => window.clearTimeout(timer);
  }, [focusSignal]);

  return (
    <section className="settings-agents-table panel" ref={sectionRef} data-settings-focus="agents:routing">
      <header className="settings-section-head">
        <div>
          <h4>Agent runtime bindings</h4>
          <p>Choose provider, model, and key source for each agent.</p>
        </div>
        <span className="ui-chip">{filtered.length} agents</span>
      </header>

      <div className="settings-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Key source</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((agent) => {
              const fallback = providerDefaults?.[agent.backend] || '';
              const keySource = agent.provider_key_ref || fallback || 'not set';
              return (
                <tr key={agent.id}>
                  <td>
                    <div className="settings-agent-name-cell">
                      <strong>{agent.display_name || agent.id}</strong>
                      <span>{agent.id}</span>
                    </div>
                  </td>
                  <td>{agent.backend || 'unknown'}</td>
                  <td>{agent.model || 'unset'}</td>
                  <td>
                    <span className="ui-chip" title="Provider key reference used at runtime">
                      {keySource}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="ui-btn" onClick={() => onEditAgent(agent)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!filtered.length && (
        <div className="panel-empty">No agents match your search.</div>
      )}
    </section>
  );
}
