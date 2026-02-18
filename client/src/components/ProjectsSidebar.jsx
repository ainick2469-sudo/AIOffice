import { useMemo, useState } from 'react';

function projectLabel(project) {
  return project?.display_name || project?.name || 'project';
}

export default function ProjectsSidebar({
  projects = [],
  activeProject = '',
  onOpenProject,
  onRenameProject,
  onDeleteProject,
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects]);

  return (
    <aside className="projects-sidebar">
      <div className="projects-sidebar-header">
        <h2>Projects</h2>
      </div>
      <div className="projects-sidebar-list">
        {sorted.map((project) => (
          <div key={project.name} className={`projects-sidebar-item ${project.name === activeProject ? 'active' : ''}`}>
            <button className="projects-sidebar-open" onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}>
              <div className="projects-sidebar-title">{projectLabel(project)}</div>
              <div className="projects-sidebar-meta">{project.detected_kind || 'unknown stack'}</div>
            </button>
            <div className="projects-sidebar-actions">
              <button onClick={() => onRenameProject?.(project)} title="Rename">✎</button>
              <button onClick={() => onDeleteProject?.(project)} title="Delete">×</button>
            </div>
          </div>
        ))}
        {sorted.length === 0 && <div className="panel-empty">No projects</div>}
      </div>

      <div className="projects-sidebar-people">
        <button className="projects-sidebar-people-toggle" onClick={() => setPeopleOpen((prev) => !prev)}>
          People {peopleOpen ? '▾' : '▸'}
        </button>
        {peopleOpen && <div className="projects-sidebar-people-empty">DMs remain available in Chat context.</div>}
      </div>
    </aside>
  );
}
