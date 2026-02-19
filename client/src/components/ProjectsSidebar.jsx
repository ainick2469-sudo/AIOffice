import { useEffect, useMemo, useRef, useState } from 'react';

const PINNED_KEY = 'ai-office:projects-sidebar:pinned';

function projectLabel(project) {
  return project?.display_name || project?.name || 'project';
}

function projectInitial(label) {
  const text = String(label || '').trim();
  if (!text) return '•';
  return text[0].toUpperCase();
}

function readPinnedProjects() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writePinnedProjects(nextSet) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(nextSet)));
  } catch {
    // ignore storage failures
  }
}

export default function ProjectsSidebar({
  projects = [],
  activeProject = '',
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  collapsed = false,
  onToggleCollapsed = null,
}) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const [search, setSearch] = useState('');
  const [pinnedProjects, setPinnedProjects] = useState(() => readPinnedProjects());
  const listRef = useRef(null);

  const sorted = useMemo(() => {
    const normalizedSearch = String(search || '').trim().toLowerCase();
    const filtered = normalizedSearch
      ? projects.filter((project) => {
          const name = projectLabel(project).toLowerCase();
          const stack = String(project?.detected_kind || '').toLowerCase();
          return name.includes(normalizedSearch) || stack.includes(normalizedSearch);
        })
      : projects;

    return [...filtered].sort((a, b) => {
      const aPinned = pinnedProjects.has(String(a?.name || ''));
      const bPinned = pinnedProjects.has(String(b?.name || ''));
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects, search, pinnedProjects]);

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

  const togglePinned = (projectName) => {
    const key = String(projectName || '').trim();
    if (!key) return;
    setPinnedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writePinnedProjects(next);
      return next;
    });
  };

  if (collapsed) {
    return (
      <aside className="projects-sidebar collapsed">
        <div className="projects-sidebar-header collapsed">
          <button
            type="button"
            className="ui-btn projects-sidebar-collapse-btn"
            onClick={() => onToggleCollapsed?.()}
            title="Expand projects sidebar"
          >
            ▸
          </button>
        </div>
        <div className="projects-sidebar-list collapsed" ref={listRef}>
          {sorted.length === 0 ? (
            <div className="projects-sidebar-mini-empty">•</div>
          ) : (
            sorted.map((project) => (
              <button
                type="button"
                key={project.name}
                className={`projects-sidebar-mini-item ${project.name === activeProject ? 'active' : ''}`}
                onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}
                title={`${projectLabel(project)}${project?.detected_kind ? ` · ${project.detected_kind}` : ''}`}
              >
                {projectInitial(projectLabel(project))}
              </button>
            ))
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="projects-sidebar">
      <div className="projects-sidebar-header">
        <h2>Projects</h2>
        <button
          type="button"
          className="ui-btn projects-sidebar-collapse-btn"
          onClick={() => onToggleCollapsed?.()}
          title="Collapse projects sidebar"
        >
          ◂
        </button>
      </div>

      <div className="projects-sidebar-search">
        <input
          className="ui-input"
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search projects..."
        />
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
              {virtualItems.map((project) => {
                const isPinned = pinnedProjects.has(String(project?.name || ''));
                return (
                  <div key={project.name} className={`projects-sidebar-item ${project.name === activeProject ? 'active' : ''}`}>
                    <button className="projects-sidebar-open" onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}>
                      <div className="projects-sidebar-title">{projectLabel(project)}</div>
                      <div className="projects-sidebar-meta">
                        {project.detected_kind || 'unknown stack'}
                        {isPinned ? ' · pinned' : ''}
                      </div>
                    </button>
                    <div className="projects-sidebar-actions">
                      <button
                        type="button"
                        className={`ui-btn ${isPinned ? 'ui-btn-primary' : ''}`}
                        onClick={() => togglePinned(project.name)}
                        title={isPinned ? 'Unpin project' : 'Pin project'}
                      >
                        ★
                      </button>
                      <button className="ui-btn" onClick={() => onRenameProject?.(project)} title="Rename">✎</button>
                      <button className="ui-btn ui-btn-destructive" onClick={() => onDeleteProject?.(project)} title="Delete">×</button>
                    </div>
                  </div>
                );
              })}
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

