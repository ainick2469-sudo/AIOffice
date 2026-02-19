import { useMemo, useState } from 'react';
import CreateProjectWizard from './CreateProjectWizard';
import RecentProjects from './RecentProjects';
import templateLibrary from '../config/projectTemplates.json';

export default function CreateHome({
  projects = [],
  onOpenProject,
  onStartDraftDiscussion,
  onProjectDeleted,
  onProjectRenamed,
}) {
  const [summaryProject, setSummaryProject] = useState(null);

  const recentProjects = useMemo(() => {
    return [...(projects || [])].sort((a, b) => {
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects]);

  const renameProject = async (project) => {
    const current = project?.display_name || project?.name || '';
    const next = window.prompt('Rename project', current);
    if (!next || next.trim() === current) return;
    const resp = await fetch(`/api/projects/${encodeURIComponent(project.name)}/display-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: next.trim() }),
    });
    const payload = resp.ok ? await resp.json() : null;
    if (!resp.ok) {
      window.alert(payload?.detail || 'Rename failed.');
      return;
    }
    onProjectRenamed?.(payload);
  };

  const deleteProject = async (project) => {
    const confirmed = window.confirm(`Delete project "${project?.display_name || project?.name}"?`);
    if (!confirmed) return;

    const first = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, { method: 'DELETE' });
    const firstPayload = first.ok ? await first.json() : null;
    if (!first.ok) {
      window.alert(firstPayload?.detail || 'Delete failed.');
      return;
    }
    if (firstPayload?.requires_confirmation) {
      const second = await fetch(
        `/api/projects/${encodeURIComponent(project.name)}?confirm_token=${encodeURIComponent(firstPayload.confirm_token)}`,
        { method: 'DELETE' }
      );
      const secondPayload = second.ok ? await second.json() : null;
      if (!second.ok) {
        window.alert(secondPayload?.detail || 'Delete failed.');
        return;
      }
    }
    onProjectDeleted?.(project.name);
  };

  return (
    <div className="create-home create-home-v3">
      <CreateProjectWizard
        templates={templateLibrary}
        onStartDraftDiscussion={onStartDraftDiscussion}
        summaryProject={summaryProject}
      />

      <RecentProjects
        projects={recentProjects}
        onOpenProject={onOpenProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onOpenSummary={(project) => setSummaryProject(project)}
      />
    </div>
  );
}
