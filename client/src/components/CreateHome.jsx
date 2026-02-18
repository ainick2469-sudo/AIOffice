import { useMemo, useState } from 'react';
import ImportDropzone from './ImportDropzone';
import templateLibrary from '../config/projectTemplates.json';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function normalizeProjectName(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function CreateHome({
  projects = [],
  onOpenProject,
  onProjectDeleted,
  onProjectRenamed,
  onProjectImported,
}) {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [importPhase, setImportPhase] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const recentProjects = useMemo(() => {
    return [...(projects || [])].sort((a, b) => {
      const aTime = new Date(a?.last_opened_at || a?.updated_at || 0).getTime() || 0;
      const bTime = new Date(b?.last_opened_at || b?.updated_at || 0).getTime() || 0;
      return bTime - aTime;
    });
  }, [projects]);

  const createFromPrompt = async (seedPrompt, seedTemplate = '') => {
    const finalPrompt = String(seedPrompt || prompt).trim();
    if (!finalPrompt) return;
    setBusy(true);
    setError('');
    setStatus('Creating project...');
    try {
      const projectName = normalizeProjectName(finalPrompt.split('\n')[0].slice(0, 48));
      const resp = await fetch('/api/projects/create_from_prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          template: seedTemplate || template || null,
          project_name: projectName || null,
        }),
      });
      const payload = resp.ok ? await resp.json() : null;
      if (!resp.ok) {
        throw new Error(payload?.detail || payload?.error || 'Project creation failed.');
      }
      setStatus(`Created ${payload?.project?.name || 'project'}.`);
      setPrompt('');
      onOpenProject?.(payload);
    } catch (err) {
      setError(err?.message || 'Project creation failed.');
    } finally {
      setBusy(false);
    }
  };

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
    <div className="create-home">
      <section className="create-hero-card">
        <h1>Chat to create</h1>
        <p>Describe what you want to build. AI Office will create a project, draft a spec, and start the builder loop.</p>
        <div className="create-input-row">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What do you want to build?"
            rows={4}
          />
          <button
            className="create-submit-btn"
            disabled={busy || !prompt.trim()}
            onClick={() => createFromPrompt(prompt)}
            title="Create project"
          >
            →
          </button>
        </div>
        <div className="create-template-row">
          {templateLibrary.map((chip) => (
            <button
              key={chip.id}
              className={`template-chip ${template === chip.template ? 'active' : ''}`}
              onClick={() => {
                setTemplate(chip.template || '');
                setPrompt(chip.prompt || '');
              }}
              disabled={busy}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {status && <div className="agent-config-notice">{status}</div>}
        {error && <div className="agent-config-error">{error}</div>}
      </section>

      <section className="create-import-wrap">
        <ImportDropzone onImported={onProjectImported} onPhaseChange={setImportPhase} />
        {importPhase && <div className="create-project-last-opened">Import phase: {importPhase}</div>}
      </section>

      <section className="create-recent-projects">
        <div className="create-section-header">
          <h3>Recent Projects</h3>
          <span>{recentProjects.length}</span>
        </div>
        <div className="create-project-grid">
          {recentProjects.map((project) => (
            <article key={project.name} className="create-project-card">
              <div className="create-project-title">{project.display_name || project.name}</div>
              <div className="create-project-meta">
                <span>Stack: {(project.detected_kind || 'unknown').toUpperCase()}</span>
                <span>Updated: {formatWhen(project.updated_at)}</span>
                <span>Last opened: {formatWhen(project.last_opened_at)}</span>
              </div>
              <div className="create-project-actions">
                <button className="refresh-btn primary" onClick={() => onOpenProject?.({ project, channel_id: project.channel_id })}>
                  Open
                </button>
                <button className="refresh-btn" onClick={() => renameProject(project)}>
                  Rename
                </button>
                <button className="stop-btn" onClick={() => deleteProject(project)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
          {recentProjects.length === 0 && <div className="panel-empty">No projects yet.</div>}
        </div>
      </section>
    </div>
  );
}
