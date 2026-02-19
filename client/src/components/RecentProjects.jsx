import { useMemo, useState } from 'react';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function RecentProjects({
  projects = [],
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onOpenSummary,
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((project) => {
      const haystack = [
        project?.display_name,
        project?.name,
        project?.detected_kind,
        project?.branch,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [projects, query]);

  return (
    <section className="recent-projects-shell">
      <div className="create-section-header">
        <h3>Recent Projects</h3>
        <span>{filtered.length}</span>
      </div>
      <div className="recent-projects-filter">
        <input
          className="ui-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, stack, or branch..."
        />
      </div>

      <div className="create-project-grid">
        {filtered.map((project) => (
          <article key={project.name} className="create-project-card">
            <div className="create-project-card-top">
              <div className="create-project-title">{project.display_name || project.name}</div>
              <span className="ui-chip create-project-stack">{(project.detected_kind || 'unknown').toUpperCase()}</span>
            </div>
            <div className="create-project-meta">
              <span>Branch: {project.branch || 'main'}</span>
              <span>Last opened: {formatWhen(project.last_opened_at)}</span>
              <span>Updated: {formatWhen(project.updated_at)}</span>
            </div>
            <div className="create-project-actions">
              <button
                type="button"
                className="refresh-btn ui-btn ui-btn-primary primary"
                onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}
              >
                Open Workspace
              </button>
              <button type="button" className="refresh-btn ui-btn" onClick={() => onOpenSummary?.(project)}>
                Open Summary
              </button>
              <button type="button" className="refresh-btn ui-btn" onClick={() => onRenameProject?.(project)}>
                Rename
              </button>
              <button type="button" className="stop-btn ui-btn ui-btn-destructive" onClick={() => onDeleteProject?.(project)}>
                Delete
              </button>
            </div>
          </article>
        ))}
        {filtered.length === 0 && <div className="panel-empty">No projects match your search.</div>}
      </div>
    </section>
  );
}
