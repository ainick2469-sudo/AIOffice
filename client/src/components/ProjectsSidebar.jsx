import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const listRef = useRef(null);

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects]);

  const ROW_HEIGHT = 84;
  const OVERSCAN = 6;
  const totalHeight = sorted.length * ROW_HEIGHT;
  const visibleCount = Math.max(8, Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(sorted.length, startIndex + visibleCount);
  const virtualItems = sorted.slice(startIndex, endIndex);
  const translateY = startIndex * ROW_HEIGHT;

  useEffect(() => {
    const updateHeight = () => {
      const el = listRef.current;
      if (!el) return;
      setViewportHeight(el.clientHeight || 480);
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  return (
    <aside className="projects-sidebar">
      <div className="projects-sidebar-header">
        <h2>Projects</h2>
      </div>
      <div
        className="projects-sidebar-list"
        ref={listRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {sorted.length === 0 && <div className="panel-empty">No projects</div>}
        {sorted.length > 0 && (
          <div className="projects-sidebar-virtual-spacer" style={{ height: `${totalHeight}px` }}>
            <div className="projects-sidebar-virtual-window" style={{ transform: `translateY(${translateY}px)` }}>
              {virtualItems.map((project) => (
                <div key={project.name} className={`projects-sidebar-item ${project.name === activeProject ? 'active' : ''}`}>
                  <button className="projects-sidebar-open" onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}>
                    <div className="projects-sidebar-title">{projectLabel(project)}</div>
                    <div className="projects-sidebar-meta">{project.detected_kind || 'unknown stack'}</div>
                  </button>
                  <div className="projects-sidebar-actions">
                    <button className="ui-btn" onClick={() => onRenameProject?.(project)} title="Rename">✎</button>
                    <button className="ui-btn ui-btn-destructive" onClick={() => onDeleteProject?.(project)} title="Delete">×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
