import { useEffect, useMemo, useRef, useState } from 'react';
import ImportDropzone from './ImportDropzone';
import TemplateGallery from './TemplateGallery';
import { buildCreationDraft } from '../lib/storage/creationDraft';

const DRAFT_KEY = 'ai-office:create-project-wizard-draft:v2';
const DEFAULT_RATIO = typeof window !== 'undefined' && window.matchMedia('(max-width: 1120px)').matches
  ? false
  : true;

const STACK_OPTIONS = [
  { id: 'auto-detect', label: 'Auto-detect (recommended)' },
  { id: 'react-web', label: 'React Web App' },
  { id: 'python-api', label: 'Python API' },
  { id: 'python-cli', label: 'Python CLI Tool' },
  { id: 'node-service', label: 'Node Service' },
  { id: 'full-stack', label: 'Full Stack' },
];

const SUGGESTED_STARTERS = [
  'Build a polished landing page with pricing and contact flow.',
  'Build a simple todo app with login and a dashboard.',
  'Build an API with an admin dashboard for key metrics.',
  'Build a Python CLI tool for local workflow automation.',
];

const CREATE_DESTINATIONS = [
  {
    id: 'chat',
    label: 'Open Workspace (recommended)',
    description: 'Launch into Workspace with the full project context.',
  },
  {
    id: 'spec',
    label: 'Open Spec',
    description: 'Start directly in Spec to review and refine requirements.',
  },
  {
    id: 'preview',
    label: 'Open Preview',
    description: 'Open Preview first to run or validate startup commands.',
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

function suggestedProjectName(prompt) {
  const firstLine = String(prompt || '').split('\n')[0] || '';
  return normalizeProjectName(firstLine.slice(0, 48)) || 'new-project';
}

function normalizeTemplate(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || item.template || '').trim();
  if (!id) return null;
  return {
    id,
    template: String(item.template || id),
    title: String(item.title || item.label || id),
    description: String(item.description || ''),
    prompt: String(item.prompt || ''),
    stackPreset: String(item.stackPreset || item.stack || 'auto-detect'),
    recommended: Boolean(item.recommended),
    bullets: Array.isArray(item.bullets)
      ? item.bullets.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

function stackCommands(stackChoice) {
  switch (String(stackChoice || '').trim()) {
    case 'react-web':
      return ['npm install', 'npm run dev', 'npm run test'];
    case 'python-api':
      return ['python -m venv .venv', 'pip install -r requirements.txt', 'uvicorn app.main:app --reload'];
    case 'python-cli':
      return ['python -m venv .venv', 'pip install -r requirements.txt', 'python -m app --help'];
    case 'node-service':
      return ['npm install', 'npm run dev', 'npm test'];
    case 'full-stack':
      return ['Install frontend dependencies', 'Install backend dependencies', 'Run both preview profiles'];
    default:
      return ['Auto-detect stack', 'Generate preview/build command presets', 'Open Preview panel to run'];
  }
}

export default function CreateProjectWizard({
  templates = [],
  onStartDraftDiscussion,
  onCreateProjectFromDraft,
  summaryProject = null,
  initialDraft = null,
  onDraftUpdate = null,
}) {
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [projectName, setProjectName] = useState('');
  const [stackChoice, setStackChoice] = useState('auto-detect');
  const [queuedImports, setQueuedImports] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [importExpanded, setImportExpanded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(DEFAULT_RATIO);
  const [createDestination, setCreateDestination] = useState('chat');
  const [providerHealth, setProviderHealth] = useState({ openai: null, ollama: null });
  const promptRef = useRef('');
  const initializedFromDraftRef = useRef('');

  const normalizedTemplates = useMemo(
    () => templates.map(normalizeTemplate).filter(Boolean),
    [templates]
  );

  const selectedTemplateRecord = useMemo(
    () => normalizedTemplates.find((item) => item.id === selectedTemplate) || null,
    [normalizedTemplates, selectedTemplate]
  );

  useEffect(() => {
    let cancelled = false;
    const loadProviderHealth = async () => {
      const entries = await Promise.allSettled([
        fetch('/api/openai/status'),
        fetch('/api/ollama/status'),
      ]);
      if (cancelled) return;
      const next = { openai: null, ollama: null };
      if (entries[0]?.status === 'fulfilled') {
        try {
          const payload = await entries[0].value.json();
          next.openai = Boolean(payload?.available);
        } catch {
          next.openai = false;
        }
      } else {
        next.openai = false;
      }
      if (entries[1]?.status === 'fulfilled') {
        try {
          const payload = await entries[1].value.json();
          next.ollama = Boolean(payload?.available);
        } catch {
          next.ollama = false;
        }
      } else {
        next.ollama = false;
      }
      setProviderHealth(next);
    };
    loadProviderHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.prompt) setPrompt(String(parsed.prompt));
      if (parsed?.template) setSelectedTemplate(String(parsed.template));
      if (parsed?.project_name) setProjectName(String(parsed.project_name));
      if (parsed?.stack_choice) setStackChoice(String(parsed.stack_choice));
      if (Array.isArray(parsed?.queued_imports)) setQueuedImports(parsed.queued_imports);
      if (Boolean(parsed?.import_expanded)) setImportExpanded(true);
      if (Number(parsed?.step) >= 1 && Number(parsed?.step) <= 3) {
        setStep(Number(parsed.step));
      }
    } catch {
      // ignore invalid drafts
    }
  }, []);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    if (!initialDraft?.id) return;
    if (initializedFromDraftRef.current === initialDraft.id) return;
    initializedFromDraftRef.current = initialDraft.id;
    setPrompt(String(initialDraft.text || ''));
    setSelectedTemplate(String(initialDraft.templateId || ''));
    setProjectName(String(initialDraft.suggestedName || initialDraft.project_name || ''));
    setStackChoice(String(initialDraft.suggestedStack || initialDraft.stack_choice || 'auto-detect'));
    const imported = Array.isArray(initialDraft.importQueueRuntime) ? initialDraft.importQueueRuntime : [];
    setQueuedImports(imported);
    setImportExpanded(imported.length > 0);
    setStep(1);
    setError('');
    setStatus('Loaded draft into Describe.');
  }, [
    initialDraft?.id,
    initialDraft?.text,
    initialDraft?.templateId,
    initialDraft?.suggestedName,
    initialDraft?.suggestedStack,
    initialDraft?.project_name,
    initialDraft?.stack_choice,
    initialDraft?.importQueueRuntime,
  ]);

  useEffect(() => {
    if (!summaryProject?.name) return;
    const display = summaryProject.display_name || summaryProject.name;
    const stack = summaryProject.detected_kind || 'unknown';
    setPrompt(`Create the next iteration for "${display}". Keep compatibility with the current stack (${stack}), improve UX quality, and provide a phased implementation plan.`);
    setProjectName(String(summaryProject.name || '').trim());
    setStep(2);
    setError('');
    setStatus('Loaded summary context into Review.');
  }, [summaryProject?.name, summaryProject?.display_name, summaryProject?.detected_kind]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nowIso = new Date().toISOString();
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            step,
            prompt,
            template: selectedTemplate,
            project_name: projectName,
            stack_choice: stackChoice,
            queued_imports: queuedImports,
            import_expanded: importExpanded,
            destination: createDestination,
            saved_at: nowIso,
          })
        );
        setDraftSavedAt(new Date());
      } catch {
        // ignore storage failures
      }
      onDraftUpdate?.({
        text: prompt,
        seedPrompt: prompt,
        templateId: selectedTemplate || null,
        projectName: normalizeProjectName(projectName),
        suggestedName: normalizeProjectName(projectName),
        stackHint: stackChoice,
        suggestedStack: stackChoice,
        importQueueRuntime: queuedImports,
        importQueue: queuedImports,
        phase: 'DISCUSS',
        pipelineStep: 'describe',
        lastEditedAt: nowIso,
      });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [step, prompt, selectedTemplate, projectName, stackChoice, queuedImports, importExpanded, createDestination, onDraftUpdate]);

  const resolvedProjectName = useMemo(
    () => normalizeProjectName(projectName) || suggestedProjectName(prompt),
    [projectName, prompt]
  );

  const targetDirectoryPreview = useMemo(
    () => `workspaces/${resolvedProjectName}/repo`,
    [resolvedProjectName]
  );

  const importSummary = useMemo(() => {
    const count = queuedImports.reduce((acc, item) => acc + Number(item?.count || 0), 0);
    return {
      items: queuedImports.length,
      files: count,
    };
  }, [queuedImports]);

  const selectedDestination = useMemo(
    () => CREATE_DESTINATIONS.find((item) => item.id === createDestination) || CREATE_DESTINATIONS[0],
    [createDestination]
  );

  const potentialIssues = useMemo(() => {
    const issues = [];
    if (!selectedTemplate) {
      issues.push({ id: 'template', message: 'No template selected. Blank guided flow will be used.' });
    }
    if (selectedTemplate === 'import-existing-project' && queuedImports.length === 0) {
      issues.push({ id: 'import', message: 'Import template selected but no files/folders are queued yet.' });
    }
    if (providerHealth.openai === false) {
      issues.push({ id: 'openai', message: 'No providers configured (OpenAI unavailable). Check Settings > Providers.' });
    }
    if (providerHealth.ollama === false) {
      issues.push({ id: 'ollama', message: 'Ollama not reachable. Local model routes may fail until it is running.' });
    }
    return issues;
  }, [providerHealth.openai, providerHealth.ollama, queuedImports.length, selectedTemplate]);

  const persistWizardDraftNow = () => {
    const nowIso = new Date().toISOString();
    const payload = {
      step,
      prompt: promptRef.current,
      template: selectedTemplate,
      project_name: projectName,
      stack_choice: stackChoice,
      queued_imports: queuedImports,
      import_expanded: importExpanded,
      destination: createDestination,
      saved_at: nowIso,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      setDraftSavedAt(new Date());
    } catch {
      // ignore storage failures
    }
    onDraftUpdate?.({
      text: promptRef.current,
      seedPrompt: promptRef.current,
      templateId: selectedTemplate || null,
      projectName: normalizeProjectName(projectName),
      suggestedName: normalizeProjectName(projectName),
      stackHint: stackChoice,
      suggestedStack: stackChoice,
      importQueueRuntime: queuedImports,
      importQueue: queuedImports,
      phase: 'DISCUSS',
      pipelineStep: 'describe',
      lastEditedAt: nowIso,
    });
  };

  const clearDraft = () => {
    setPrompt('');
    promptRef.current = '';
    setSelectedTemplate('');
    setProjectName('');
    setStackChoice('auto-detect');
    setStep(1);
    setQueuedImports([]);
    setImportExpanded(false);
    setCreateDestination('chat');
    setError('');
    setStatus('Draft cleared.');
    setDraftSavedAt(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const applyTemplate = (template) => {
    const templateId = String(template?.id || template?.template || '');
    setSelectedTemplate(templateId);
    if (!String(promptRef.current || '').trim() && template?.prompt) {
      const templated = String(template.prompt);
      setPrompt(templated);
      promptRef.current = templated;
    }
    if (stackChoice === 'auto-detect' && template?.stackPreset) {
      setStackChoice(String(template.stackPreset));
    }
    if (templateId === 'import-existing-project') {
      setImportExpanded(true);
    }
    setError('');
    setStatus(templateId
      ? `${template.title || 'Template'} selected.`
      : 'Template cleared.');
  };

  const fillStarter = (text) => {
    const value = String(text || '');
    setPrompt(value);
    promptRef.current = value;
    setError('');
  };

  const handleQueueChange = (items) => {
    const next = Array.isArray(items) ? items : [];
    setQueuedImports(next);
    if (next.length > 0) {
      setImportExpanded(true);
    }
    if (!prompt.trim() && next.length > 0) {
      const names = next.map((item) => item?.name).filter(Boolean).join(', ');
      const generated = `Analyze the imported project (${names}) and propose a clean roadmap with Discuss -> Spec -> Build steps.`;
      setPrompt(generated);
      promptRef.current = generated;
    }
  };

  const ensureStepOneValid = () => {
    const nextPrompt = String(promptRef.current || '');
    if (!nextPrompt.trim()) {
      setError('Describe what you want to build before moving to review.');
      return false;
    }
    if (!projectName.trim()) {
      setProjectName(suggestedProjectName(nextPrompt));
    }
    return true;
  };

  const ensureStepTwoValid = () => {
    if (!String(promptRef.current || '').trim()) {
      setError('Prompt cannot be empty.');
      return false;
    }
    return true;
  };

  const buildDraftSeed = () => buildCreationDraft({
    draftId: `draft-${Date.now()}`,
    text: String(promptRef.current || ''),
    seedPrompt: String(promptRef.current || ''),
    rawRequest: String(promptRef.current || ''),
    templateId: selectedTemplate || null,
    templateHint: selectedTemplate || null,
    projectName: resolvedProjectName,
    suggestedName: resolvedProjectName,
    stackHint: stackChoice,
    suggestedStack: stackChoice,
    phase: 'READY_TO_BUILD',
    pipelineStep: 'build',
    createdAt: new Date().toISOString(),
    lastEditedAt: new Date().toISOString(),
    importQueueRuntime: queuedImports,
    importQueue: queuedImports.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      count: item.count,
      bytes: item.bytes,
      summary: item.summary,
      entries: (item.entries || []).map((entry) => ({
        path: entry.path || '',
        name: entry.file?.name || '',
        size: entry.file?.size || 0,
        type: entry.file?.type || '',
        hasFile: Boolean(entry.file),
      })),
    })),
    brainstormMessages: [],
  });

  const beginDraftDiscussion = async () => {
    if (busy) return;
    const draftSeed = buildDraftSeed();
    setBusy(true);
    setError('');
    setStatus('Opening Discuss mode...');
    try {
      await onStartDraftDiscussion?.(draftSeed);
      setStatus('Discuss mode opened.');
    } catch (err) {
      setError(err?.message || 'Unable to open draft discussion.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    if (busy) return;
    persistWizardDraftNow();
    const currentPrompt = String(promptRef.current || '');
    const latestStatePrompt = String(prompt || '');
    if (currentPrompt !== latestStatePrompt) {
      const captureError = 'Prompt not captured, try again.';
      setError(captureError);
      setStatus('');
      console.error('[create] Prompt capture mismatch on submit.', {
        currentPromptLength: currentPrompt.length,
        statePromptLength: latestStatePrompt.length,
      });
      return;
    }
    if (!currentPrompt.trim()) {
      setError('Prompt cannot be empty.');
      return;
    }

    const draftSeed = buildDraftSeed();
    setBusy(true);
    setError('');
    setStatus(`Creating project and preparing ${selectedDestination.label.toLowerCase()}...`);
    try {
      if (typeof onCreateProjectFromDraft === 'function') {
        await onCreateProjectFromDraft(draftSeed, { openTab: createDestination });
      } else if (typeof onStartDraftDiscussion === 'function') {
        await onStartDraftDiscussion(draftSeed);
      } else {
        throw new Error('No create handler configured.');
      }
      setStatus('Project created successfully.');
    } catch (err) {
      setError(err?.message || 'Unable to create project.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const gotoNext = async () => {
    persistWizardDraftNow();
    setError('');
    if (step === 1) {
      if (!ensureStepOneValid()) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!ensureStepTwoValid()) return;
      setStep(3);
      return;
    }
    await createProject();
  };

  const primaryCtaLabel = step === 1 ? 'Next: Review' : step === 2 ? 'Next: Create' : 'Create Project';

  return (
    <section className="create-wizard-card">
      <div className="create-wizard-layout">
        <div className="create-wizard-main">
          <div className="create-wizard-top">
            <h1>Create a Project</h1>
            <button type="button" className="refresh-btn ui-btn" onClick={clearDraft} disabled={busy}>
              Clear Draft
            </button>
          </div>
          <p className="create-wizard-subtitle">
            Beginner flow: Describe your idea, review what gets created, then create with one confirmation.
          </p>

          <div className="create-stepper">
            <div className={`create-step ${step >= 1 ? 'active' : ''}`}>
              <span className="create-step-index">1</span>
              <span>Describe</span>
            </div>
            <div className={`create-step ${step >= 2 ? 'active' : ''}`}>
              <span className="create-step-index">2</span>
              <span>Review</span>
            </div>
            <div className={`create-step ${step >= 3 ? 'active' : ''}`}>
              <span className="create-step-index">3</span>
              <span>Create</span>
            </div>
          </div>

          {step === 1 && (
            <div className="create-step-panel">
              <label className="create-step-label">Describe what you want to build</label>
              <textarea
                value={prompt}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  promptRef.current = nextValue;
                  setPrompt(nextValue);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    gotoNext();
                  }
                }}
                className="ui-input create-step-prompt"
                rows={8}
                placeholder="Example: Build a simple todo app with login and a dashboard. Needs a local preview and tests."
              />
              <div className="create-prompt-meta">
                <span>{String(prompt || '').length} characters</span>
                <span>Enter = continue, Shift+Enter = newline</span>
              </div>

              <div className="create-starter-chip-row">
                {SUGGESTED_STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    className="ui-chip create-starter-chip"
                    onClick={() => fillStarter(starter)}
                    disabled={busy}
                  >
                    {starter}
                  </button>
                ))}
              </div>

              <TemplateGallery
                templates={normalizedTemplates}
                selectedTemplate={selectedTemplate}
                disabled={busy}
                onSelect={applyTemplate}
              />
              <ImportDropzone
                open={importExpanded}
                onToggleOpen={setImportExpanded}
                queuedItems={queuedImports}
                onQueueChange={handleQueueChange}
                disabled={busy}
              />
            </div>
          )}

          {step === 2 && (
            <div className="create-step-panel">
              <div className="create-review-grid">
                <div className="create-review-block">
                  <h4>Prompt (exact input)</h4>
                  <pre className="create-review-prompt">{prompt}</pre>

                  <div className="create-next-box">
                    <h5>What happens next</h5>
                    <ul>
                      <li>Project files/folders are created under your workspace path.</li>
                      <li>You are taken into Workspace with your chosen next step.</li>
                      <li>You can continue in Spec first or jump straight into Preview.</li>
                    </ul>
                  </div>
                </div>
                <div className="create-review-block">
                  <label className="create-step-label">Project name</label>
                  <input
                    className="ui-input"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder={suggestedProjectName(prompt)}
                  />

                  <label className="create-step-label">Stack selection</label>
                  <select className="ui-input" value={stackChoice} onChange={(event) => setStackChoice(event.target.value)}>
                    {STACK_OPTIONS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>

                  <label className="create-step-label">Template selected</label>
                  <div className="create-target-dir">{selectedTemplateRecord?.title || 'Blank (Guided)'}</div>

                  <label className="create-step-label">Target directory preview</label>
                  <code className="create-target-dir">{targetDirectoryPreview}</code>

                  <label className="create-step-label">Imports queued</label>
                  <div className="create-import-review">
                    {queuedImports.length === 0 && <span>None</span>}
                    {queuedImports.map((item) => (
                      <div key={item.id} className="create-import-review-item">
                        <span className="ui-chip">{item.kind}</span>
                        <span>{item.name}</span>
                        <span>{item.summary}</span>
                      </div>
                    ))}
                  </div>

                  <label className="create-step-label">Available commands after create</label>
                  <ul className="create-command-preview">
                    {stackCommands(stackChoice).map((command) => (
                      <li key={command}><code>{command}</code></li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="create-step-panel">
              <div className="create-confirm-callout">
                <strong>This will create a new project.</strong>
                <p>The project appears in the Projects sidebar and Recent Projects list immediately after creation.</p>
              </div>
              <div className="create-confirm-list">
                <div><strong>Project:</strong> {resolvedProjectName}</div>
                <div><strong>Stack:</strong> {stackChoice}</div>
                <div><strong>Template:</strong> {selectedTemplateRecord?.title || 'Blank (Guided)'}</div>
                <div><strong>Imports:</strong> {queuedImports.length ? `${importSummary.items} queue item(s), ${importSummary.files} files` : 'None'}</div>
                <div><strong>Target:</strong> <code>{targetDirectoryPreview}</code></div>
              </div>
              <div className="create-destination-grid">
                {CREATE_DESTINATIONS.map((destination) => (
                  <button
                    key={destination.id}
                    type="button"
                    className={`create-destination-card ${createDestination === destination.id ? 'active' : ''}`}
                    onClick={() => setCreateDestination(destination.id)}
                    disabled={busy}
                  >
                    <strong>{destination.label}</strong>
                    <span>{destination.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="agent-config-error">{error}</div>}
          {status && <div className="agent-config-notice">{status}</div>}

          <div className="create-wizard-actions">
            <div className="create-wizard-draft-status">
              {draftSavedAt ? `Draft saved ${draftSavedAt.toLocaleTimeString()}` : 'Draft not saved yet'}
            </div>
            <div className="create-wizard-action-buttons">
              {step > 1 && (
                <button
                  type="button"
                  className="refresh-btn ui-btn"
                  onClick={() => setStep((prev) => Math.max(1, prev - 1))}
                  disabled={busy}
                >
                  Back
                </button>
              )}
              {step === 3 && typeof onStartDraftDiscussion === 'function' ? (
                <button
                  type="button"
                  className="refresh-btn ui-btn"
                  onClick={beginDraftDiscussion}
                  disabled={busy}
                >
                  Discuss First
                </button>
              ) : null}
              <button type="button" className="refresh-btn ui-btn ui-btn-primary" onClick={gotoNext} disabled={busy}>
                {busy ? 'Working...' : primaryCtaLabel}
              </button>
            </div>
          </div>
        </div>

        <aside className={`create-wizard-summary ${summaryOpen ? 'expanded' : 'collapsed'}`}>
          <div className="create-summary-header">
            <h3>Creation Summary</h3>
            <button type="button" className="refresh-btn ui-btn" onClick={() => setSummaryOpen((prev) => !prev)}>
              {summaryOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {summaryOpen ? (
            <>
              <div className="create-summary-row">
                <span>Name</span>
                <strong>{resolvedProjectName}</strong>
              </div>
              <div className="create-summary-row">
                <span>Stack</span>
                <strong>{stackChoice}</strong>
              </div>
              <div className="create-summary-row">
                <span>Template</span>
                <strong>{selectedTemplateRecord?.title || 'Blank (Guided)'}</strong>
              </div>
              <div className="create-summary-row">
                <span>Import items</span>
                <strong>{importSummary.items}</strong>
              </div>
              <div className="create-summary-row">
                <span>Target path</span>
                <code>{targetDirectoryPreview}</code>
              </div>

              {importSummary.items > 0 ? (
                <div className="create-summary-row">
                  <span>Queued files</span>
                  <strong>{importSummary.files}</strong>
                </div>
              ) : null}

              <div className="create-summary-next">
                <h4>Potential issues</h4>
                {potentialIssues.length === 0 ? (
                  <p>No blockers detected from current local checks.</p>
                ) : (
                  <ul>
                    {potentialIssues.map((issue) => (
                      <li key={issue.id}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="create-summary-collapsed-copy">
              Name, stack, template, imports, and target path update live as you edit.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
