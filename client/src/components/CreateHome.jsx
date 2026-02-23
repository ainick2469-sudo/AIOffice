import { useMemo, useState } from 'react';
import CreateProjectWizard from './CreateProjectWizard';
import RecentProjects from './RecentProjects';
import templateLibrary from '../config/projectTemplates.json';

export default function CreateHome({
  projects = [],
  onOpenProject,
  onStartDraftDiscussion,
  onResumeDraft,
  creationDraft = null,
  onCreationDraftChange = null,
  onCreateProjectFromDraft = null,
  onDiscardCreationDraft = null,
  onProjectDeleted,
  onProjectRenamed,
  createOnly = false,
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
      {!createOnly && creationDraft?.text ? (
        <section className="panel create-resume-draft">
          <div>
            <h3>Resume Draft</h3>
            <p>Your last creation draft is ready. Continue Discuss → Spec → Build without losing progress.</p>
          </div>
          <div className="create-resume-actions">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={() => onResumeDraft?.(creationDraft?.draftId || creationDraft?.id || '')}
            >
              Resume Draft
            </button>
            <button type="button" className="ui-btn" onClick={() => onDiscardCreationDraft?.()}>
              Clear Draft
            </button>
          </div>
        </section>
      ) : null}

      <CreateProjectWizard
        templates={templateLibrary}
        onStartDraftDiscussion={onStartDraftDiscussion}
        onCreateProjectFromDraft={onCreateProjectFromDraft}
        summaryProject={summaryProject}
        initialDraft={creationDraft}
        onDraftUpdate={onCreationDraftChange}
      />

      {!createOnly ? (
        <RecentProjects
          projects={recentProjects}
          onOpenProject={onOpenProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onOpenSummary={(project) => setSummaryProject(project)}
        />
      ) : null}
    </div>
  );
}
