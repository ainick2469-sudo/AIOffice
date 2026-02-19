import { useEffect, useMemo, useRef, useState } from 'react';
import ImportDropzone from './ImportDropzone';
import TemplateGallery from './TemplateGallery';
import { buildCreationDraft } from '../lib/storage/creationDraft';

const DRAFT_KEY = 'ai-office:create-project-wizard-draft:v1';

const STACK_OPTIONS = [
  { id: 'auto-detect', label: 'Auto-detect' },
  { id: 'react-web', label: 'React Web App' },
  { id: 'python-api', label: 'Python API' },
  { id: 'node-service', label: 'Node Service' },
  { id: 'full-stack', label: 'Full Stack' },
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

export default function CreateProjectWizard({
  templates = [],
  onStartDraftDiscussion,
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
  const promptRef = useRef('');
  const initializedFromDraftRef = useRef('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.prompt) setPrompt(String(parsed.prompt));
      if (parsed?.template) setSelectedTemplate(String(parsed.template));
      if (parsed?.project_name) setProjectName(String(parsed.project_name));
      if (parsed?.stack_choice) setStackChoice(String(parsed.stack_choice));
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
    setQueuedImports(Array.isArray(initialDraft.importQueueRuntime) ? initialDraft.importQueueRuntime : []);
    setStep(1);
    setError('');
    setStatus('Loaded draft into Describe step.');
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
    setPrompt(`Create a refined next iteration for project "${display}". Keep compatibility with the existing stack (${stack}), improve UX quality, and provide a staged implementation plan.`);
    setProjectName(String(summaryProject.name || '').trim());
    setStep(2);
    setError('');
    setStatus('Loaded project summary into the wizard.');
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
    }, 300);
    return () => window.clearTimeout(handle);
  }, [step, prompt, selectedTemplate, projectName, stackChoice, queuedImports, onDraftUpdate]);

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

  const primaryCtaLabel = step === 1 ? 'Next: Review' : step === 2 ? 'Next: Confirm' : 'Discuss Draft';

  const persistWizardDraftNow = () => {
    const nowIso = new Date().toISOString();
    const payload = {
      step,
      prompt: promptRef.current,
      template: selectedTemplate,
      project_name: projectName,
      stack_choice: stackChoice,
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
    const templateId = String(template?.template || '');
    setSelectedTemplate(templateId);
    if (!String(promptRef.current || '').trim() && template?.prompt) {
      const templated = String(template.prompt);
      setPrompt(templated);
      promptRef.current = templated;
    }
    if (stackChoice === 'auto-detect' && templateId) {
      if (templateId.includes('python')) setStackChoice('python-api');
      else if (templateId.includes('node')) setStackChoice('node-service');
      else if (templateId.includes('full')) setStackChoice('full-stack');
      else setStackChoice('react-web');
    }
    setError('');
    setStatus(templateId
      ? 'Template hint added. Your typed request stays unchanged.'
      : 'Blank template selected. Your prompt text remains unchanged.');
  };

  const handleQueueChange = (items) => {
    const next = Array.isArray(items) ? items : [];
    setQueuedImports(next);
    if (!prompt.trim() && next.length > 0) {
      const names = next.map((item) => item?.name).filter(Boolean).join(', ');
      setPrompt(`Deconstruct and understand the imported assets (${names}), then remake it with a clean spec and implementation plan.`);
    }
  };

  const gotoNext = async () => {
    persistWizardDraftNow();
    setError('');
    if (step === 1) {
      const nextPrompt = String(promptRef.current || '');
      if (!nextPrompt.trim()) {
        setError('Describe what you want to build before moving to review.');
        return;
      }
      if (!projectName.trim()) {
        setProjectName(suggestedProjectName(nextPrompt));
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!String(promptRef.current || '').trim()) {
        setError('Prompt cannot be empty.');
        return;
      }
      setStep(3);
      return;
    }
    await beginDraftDiscussion();
  };

  const beginDraftDiscussion = async () => {
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
    if (currentPrompt.trim().length < 3) {
      const captureError = 'Prompt not captured, try again.';
      setError(captureError);
      setStatus('');
      console.error('[create] Prompt rejected: too short.', {
        promptLength: currentPrompt.trim().length,
      });
      return;
    }

    const draftSeed = buildCreationDraft({
      draftId: `draft-${Date.now()}`,
      text: currentPrompt,
      seedPrompt: currentPrompt,
      rawRequest: currentPrompt,
      templateId: selectedTemplate || null,
      templateHint: selectedTemplate || null,
      projectName: resolvedProjectName,
      suggestedName: resolvedProjectName,
      stackHint: stackChoice,
      suggestedStack: stackChoice,
      phase: 'DISCUSS',
      pipelineStep: 'discuss',
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

    setBusy(true);
    setError('');
    setStatus('Opening draft discussion...');
    try {
      await onStartDraftDiscussion?.(draftSeed);
      setStatus('Draft discussion opened.');
    } catch (err) {
      setError(err?.message || 'Unable to open draft discussion.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

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
            Build with a guided flow so project creation is explicit and predictable.
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
                placeholder="What do you want to build?"
              />
              <div className="create-prompt-meta">
                <span>{String(prompt || '').length} characters</span>
                <span>Enter = continue, Shift+Enter = newline</span>
              </div>
              <TemplateGallery
                templates={templates}
                selectedTemplate={selectedTemplate}
                disabled={busy}
                onSelect={applyTemplate}
              />
              <ImportDropzone queuedItems={queuedImports} onQueueChange={handleQueueChange} disabled={busy} />
            </div>
          )}

          {step === 2 && (
            <div className="create-step-panel">
              <div className="create-review-grid">
                <div className="create-review-block">
                  <h4>Prompt (exact input)</h4>
                  <pre className="create-review-prompt">{prompt}</pre>
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
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="create-step-panel">
              <div className="create-confirm-callout">
                <strong>This opens Draft Discuss mode first.</strong>
                <p>You will review ideas with agents before explicitly creating a project.</p>
              </div>
              <div className="create-confirm-list">
                <div><strong>Project:</strong> {resolvedProjectName}</div>
                <div><strong>Stack:</strong> {stackChoice}</div>
                <div><strong>Imports:</strong> {queuedImports.length ? `${importSummary.items} queue item(s), ${importSummary.files} files` : 'None'}</div>
                <div><strong>Target:</strong> <code>{targetDirectoryPreview}</code></div>
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
              <button type="button" className="refresh-btn ui-btn ui-btn-primary" onClick={gotoNext} disabled={busy}>
                {busy ? 'Working...' : primaryCtaLabel}
              </button>
            </div>
          </div>
        </div>

        <aside className="create-wizard-summary">
          <h3>Live Summary</h3>
          <div className="create-summary-row">
            <span>Project name</span>
            <strong>{resolvedProjectName}</strong>
          </div>
          <div className="create-summary-row">
            <span>Stack</span>
            <strong>{stackChoice}</strong>
          </div>
          <div className="create-summary-row">
            <span>Files to import</span>
            <strong>{importSummary.files}</strong>
          </div>
          <div className="create-summary-row">
            <span>Queue items</span>
            <strong>{importSummary.items}</strong>
          </div>
          <div className="create-summary-row">
            <span>Target dir</span>
            <code>{targetDirectoryPreview}</code>
          </div>
          <div className="create-summary-next">
            <h4>Next actions after create</h4>
            <ul>
              <li>Open Workspace automatically</li>
              <li>Review draft spec and task seed</li>
              <li>Run Preview from the Preview panel</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
