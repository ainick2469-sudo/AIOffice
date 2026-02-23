import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCreationDraft } from '../lib/storage/creationDraft';

const DRAFT_KEY = 'ai-office:create-project-wizard-draft:v3-simple';

const TEMPLATE_OPTIONS = [
  {
    id: 'blank-guided',
    label: 'Blank',
    stackPreset: 'auto-detect',
    description: 'Start from scratch with guided defaults.',
  },
  {
    id: 'react-web',
    label: 'React',
    stackPreset: 'react-web',
    description: 'Create a React web app starter.',
  },
  {
    id: 'python-api',
    label: 'Python',
    stackPreset: 'python-api',
    description: 'Create a Python backend starter.',
  },
];

function normalizeProjectName(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function makePrompt(projectName, templateLabel, note) {
  const safeName = String(projectName || 'new-project').trim();
  const trimmedNote = String(note || '').trim();
  if (trimmedNote) return trimmedNote;
  return `Create a ${templateLabel.toLowerCase()} project named "${safeName}".`;
}

export default function CreateProjectWizard({
  templates = [],
  onStartDraftDiscussion,
  onCreateProjectFromDraft,
  summaryProject = null,
  initialDraft = null,
  onDraftUpdate = null,
}) {
  const [projectName, setProjectName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank-guided');
  const [promptNote, setPromptNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const initializedFromDraftRef = useRef('');
  const promptRef = useRef('');

  const mergedTemplateOptions = useMemo(() => {
    const byId = new Map();
    TEMPLATE_OPTIONS.forEach((item) => byId.set(item.id, { ...item }));
    (templates || []).forEach((item) => {
      const id = String(item?.id || item?.template || '').trim();
      if (!id || !byId.has(id)) return;
      const current = byId.get(id);
      byId.set(id, {
        ...current,
        label: String(item?.title || item?.label || current.label),
        description: String(item?.description || current.description),
        stackPreset: String(item?.stackPreset || item?.stack || current.stackPreset),
      });
    });
    return TEMPLATE_OPTIONS.map((item) => byId.get(item.id) || item);
  }, [templates]);

  const selectedTemplateRecord = useMemo(
    () => mergedTemplateOptions.find((item) => item.id === selectedTemplate) || mergedTemplateOptions[0],
    [mergedTemplateOptions, selectedTemplate]
  );

  const resolvedProjectName = useMemo(
    () => normalizeProjectName(projectName) || 'new-project',
    [projectName]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.project_name) setProjectName(String(parsed.project_name));
      if (parsed?.template_id) setSelectedTemplate(String(parsed.template_id));
      if (parsed?.prompt_note) {
        const nextNote = String(parsed.prompt_note);
        setPromptNote(nextNote);
        promptRef.current = nextNote;
      }
    } catch {
      // ignore invalid local drafts
    }
  }, []);

  useEffect(() => {
    if (!initialDraft?.id && !initialDraft?.draftId) return;
    const draftId = String(initialDraft?.id || initialDraft?.draftId || '');
    if (!draftId || initializedFromDraftRef.current === draftId) return;
    initializedFromDraftRef.current = draftId;
    setProjectName(String(initialDraft?.suggestedName || initialDraft?.project_name || ''));
    setSelectedTemplate(String(initialDraft?.templateId || 'blank-guided'));
    const nextPrompt = String(initialDraft?.rawRequest || initialDraft?.text || '');
    setPromptNote(nextPrompt);
    promptRef.current = nextPrompt;
    setError('');
    setStatus('Loaded draft.');
  }, [
    initialDraft?.id,
    initialDraft?.draftId,
    initialDraft?.suggestedName,
    initialDraft?.project_name,
    initialDraft?.templateId,
    initialDraft?.rawRequest,
    initialDraft?.text,
  ]);

  useEffect(() => {
    if (!summaryProject?.name) return;
    const nextName = String(summaryProject.name || '').trim();
    setProjectName(nextName);
    const nextPrompt = `Continue evolving "${summaryProject.display_name || nextName}" with a ${selectedTemplateRecord?.label || 'blank'} template.`;
    setPromptNote(nextPrompt);
    promptRef.current = nextPrompt;
    setStatus('Loaded project summary into quick create.');
    setError('');
  }, [summaryProject?.name, summaryProject?.display_name]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nowIso = new Date().toISOString();
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          project_name: projectName,
          template_id: selectedTemplate,
          prompt_note: promptRef.current,
          saved_at: nowIso,
        }));
        setDraftSavedAt(new Date());
      } catch {
        // ignore storage failures
      }

      onDraftUpdate?.({
        text: promptRef.current,
        rawRequest: promptRef.current,
        seedPrompt: promptRef.current,
        templateId: selectedTemplate,
        projectName: resolvedProjectName,
        suggestedName: resolvedProjectName,
        stackHint: selectedTemplateRecord?.stackPreset || 'auto-detect',
        suggestedStack: selectedTemplateRecord?.stackPreset || 'auto-detect',
        phase: 'DISCUSS',
        pipelineStep: 'describe',
        importQueueRuntime: [],
        importQueue: [],
        lastEditedAt: nowIso,
      });
    }, 220);
    return () => window.clearTimeout(handle);
  }, [onDraftUpdate, projectName, promptNote, resolvedProjectName, selectedTemplate, selectedTemplateRecord?.stackPreset]);

  const clearDraft = () => {
    setProjectName('');
    setSelectedTemplate('blank-guided');
    setPromptNote('');
    promptRef.current = '';
    setStatus('Draft cleared.');
    setError('');
    setDraftSavedAt(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const buildDraftSeed = () => {
    const finalPrompt = makePrompt(
      resolvedProjectName,
      selectedTemplateRecord?.label || 'Blank',
      promptRef.current
    );
    return buildCreationDraft({
      draftId: `draft-${Date.now()}`,
      text: finalPrompt,
      rawRequest: finalPrompt,
      seedPrompt: finalPrompt,
      templateId: selectedTemplateRecord?.id || selectedTemplate,
      templateHint: selectedTemplateRecord?.id || selectedTemplate,
      projectName: resolvedProjectName,
      suggestedName: resolvedProjectName,
      stackHint: selectedTemplateRecord?.stackPreset || 'auto-detect',
      suggestedStack: selectedTemplateRecord?.stackPreset || 'auto-detect',
      phase: 'READY_TO_BUILD',
      pipelineStep: 'build',
      importQueueRuntime: [],
      importQueue: [],
      brainstormMessages: [],
      createdAt: new Date().toISOString(),
      lastEditedAt: new Date().toISOString(),
    });
  };

  const createProject = async () => {
    if (busy) return;
    if (!resolvedProjectName.trim()) {
      setError('Project name is required.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('Creating project...');
    try {
      const draftSeed = buildDraftSeed();
      if (typeof onCreateProjectFromDraft === 'function') {
        await onCreateProjectFromDraft(draftSeed, { openTab: 'chat' });
      } else if (typeof onStartDraftDiscussion === 'function') {
        await onStartDraftDiscussion(draftSeed);
      } else {
        throw new Error('No create handler configured.');
      }
      setStatus('Project created.');
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore storage failures
      }
    } catch (err) {
      setError(err?.message || 'Unable to create project.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const draftSavedLabel = draftSavedAt
    ? `Draft saved ${draftSavedAt.toLocaleTimeString()}`
    : 'Draft not saved yet';

  return (
    <section className="create-wizard-card">
      <div className="create-wizard-layout">
        <div className="create-wizard-main">
          <div className="create-wizard-top">
            <h1>Create a Project</h1>
            <button type="button" className="refresh-btn ui-btn ui-btn-ghost" onClick={clearDraft} disabled={busy}>
              Clear Draft
            </button>
          </div>
          <p className="create-wizard-subtitle">
            One-step flow: choose a name, pick a template, and create.
          </p>

          <div className="create-step-panel">
            <label className="create-step-label">Project name</label>
            <input
              className="ui-input"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="my-new-project"
              autoFocus
            />

            <label className="create-step-label">Template</label>
            <div className="create-destination-grid">
              {mergedTemplateOptions.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`create-destination-card ${selectedTemplate === template.id ? 'active' : ''}`}
                  onClick={() => setSelectedTemplate(template.id)}
                  disabled={busy}
                >
                  <strong>{template.label}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>

            <label className="create-step-label">Project brief (optional)</label>
            <p className="create-step-helper">If blank, AI Office generates a default brief from name + template.</p>
            <textarea
              className="ui-input create-step-prompt"
              rows={4}
              value={promptNote}
              onChange={(event) => {
                const next = event.target.value;
                setPromptNote(next);
                promptRef.current = next;
              }}
              placeholder={`Build a ${selectedTemplateRecord?.label?.toLowerCase() || 'blank'} project named "${resolvedProjectName}".`}
            />
          </div>

          {error && <div className="agent-config-error">{error}</div>}
          {status && <div className="agent-config-notice">{status}</div>}

          <div className="create-wizard-actions">
            <div className="create-wizard-draft-status">{draftSavedLabel}</div>
            <div className="create-wizard-action-buttons">
              <button type="button" className="refresh-btn ui-btn ui-btn-primary" onClick={createProject} disabled={busy}>
                {busy ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>

        <aside className="create-wizard-summary expanded">
          <div className="create-summary-header">
            <h3>Creation Summary</h3>
          </div>
          <div className="create-summary-content">
            <div className="create-summary-item">
              <span>Name</span>
              <strong>{resolvedProjectName}</strong>
            </div>
            <div className="create-summary-item">
              <span>Template</span>
              <strong>{selectedTemplateRecord?.label || 'Blank'}</strong>
            </div>
            <div className="create-summary-item">
              <span>Stack</span>
              <strong>{selectedTemplateRecord?.stackPreset || 'auto-detect'}</strong>
            </div>
            <div className="create-summary-item">
              <span>Destination</span>
              <strong>Workspace Chat</strong>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
