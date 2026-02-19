import { useEffect, useMemo, useRef, useState } from 'react';
import DraftDiscussView from './discuss/DraftDiscussView';
import SplitPane from './layout/SplitPane';
import SpecCompletenessMeter from './spec/SpecCompletenessMeter';
import SpecEditor from './spec/SpecEditor';
import SpecPreview from './spec/SpecPreview';
import SpecWizard from './spec/SpecWizard';
import {
  SPEC_SECTIONS,
  buildSpecMarkdown,
  computeCompleteness,
  createEmptySections,
  parseSpecMarkdown,
} from './spec/specSchema';

const PLAN_APPROVAL_MIN_COMPLETENESS = 70;
const PIPELINE_STEPS = ['discuss', 'plan', 'build'];

function normalizeStep(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (PIPELINE_STEPS.includes(raw)) return raw;
  return 'discuss';
}

function splitRatioKey(draft) {
  const name = String(draft?.suggestedName || draft?.id || 'draft').trim().toLowerCase() || 'draft';
  return `ai-office:creation-plan-ratio:${name.replace(/[^a-z0-9-]+/g, '-')}`;
}

function clampRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.52;
  if (parsed < 0.2) return 0.2;
  if (parsed > 0.8) return 0.8;
  return parsed;
}

function readRatio(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0.52;
    return clampRatio(Number(raw));
  } catch {
    return 0.52;
  }
}

function seedSectionsFromDraft(draft) {
  const sections = createEmptySections();
  const prompt = String(draft?.rawRequest || draft?.text || '').trim();
  const stack = String(draft?.suggestedStack || '').trim();
  const goals = String(draft?.summary?.goals || '').trim();
  const risks = String(draft?.summary?.risks || '').trim();
  const questions = String(draft?.summary?.questions || '').trim();
  const nextSteps = String(draft?.summary?.nextSteps || '').trim();

  if (prompt) {
    sections.problem_goal = `- Raw user request (verbatim):\n${prompt}`;
  }
  if (stack && stack !== 'auto-detect') {
    sections.target_platform = `- Stack preference: ${stack}`;
  } else {
    sections.target_platform = '- Auto-detect based on prompt and imported files';
  }
  sections.core_loop = nextSteps
    ? `- ${nextSteps}`
    : '- Discuss requirements\n- Confirm spec\n- Build and verify\n- Run preview';
  sections.features = goals
    ? `### Must\n- ${goals}\n\n### Should\n- Clarify UX and data flow\n\n### Could\n- Add optional polish features`
    : '### Must\n- Deliver the core experience requested by the user\n\n### Should\n- Add quality and reliability guardrails\n\n### Could\n- Add optional enhancements';
  sections.non_goals = '- Avoid scope creep before the first working preview.';
  sections.ux_notes = '- Primary creation flow: Discuss -> Plan -> Build\n- Keep interfaces beginner-friendly and explicit.';
  sections.data_state_model = '- Project draft stores raw request, planning summary, and spec draft before creation.';
  sections.acceptance_criteria = [
    '- [ ] Original request is preserved verbatim in the final project spec.',
    '- [ ] Spec reaches readiness threshold before project creation.',
    '- [ ] Build workspace opens only after explicit approval.',
  ].join('\n');
  sections.risks_unknowns = [risks, questions]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n') || '- Clarify any unresolved requirements before starting implementation.';

  return sections;
}

function seedIdeaBank(draft) {
  const prompt = String(draft?.rawRequest || draft?.text || '').trim();
  const templateHint = String(draft?.templateHint || draft?.templateId || '').trim();
  const parts = ['# Idea Bank', '', '## Seed'];
  if (prompt) {
    parts.push('- Raw request (verbatim):');
    parts.push(prompt);
  }
  if (templateHint) {
    parts.push(`- Template hint: ${templateHint}`);
  }
  parts.push('', '## Planning notes', '- ');
  return `${parts.join('\n').trim()}\n`;
}

function wizardToSections(answers, prevSections) {
  const next = { ...(prevSections || createEmptySections()) };
  const goalLines = [answers.goal, answers.users].filter(Boolean).map((line) => `- ${line.trim()}`);
  if (goalLines.length > 0) next.problem_goal = goalLines.join('\n');

  if (answers.platform) next.target_platform = `- ${answers.platform.trim()}`;
  if (answers.core_loop) next.core_loop = `- ${answers.core_loop.trim()}`;

  const featureLines = [];
  if (answers.must) featureLines.push(`### Must\n- ${answers.must.trim()}`);
  if (answers.should) featureLines.push(`### Should\n- ${answers.should.trim()}`);
  if (answers.could) featureLines.push(`### Could\n- ${answers.could.trim()}`);
  if (featureLines.length > 0) next.features = featureLines.join('\n\n');

  if (answers.non_goals) next.non_goals = `- ${answers.non_goals.trim()}`;
  if (answers.ux) next.ux_notes = `- ${answers.ux.trim()}`;
  if (answers.data_state) next.data_state_model = `- ${answers.data_state.trim()}`;
  if (answers.acceptance) next.acceptance_criteria = `- [ ] ${answers.acceptance.trim()}`;
  if (answers.risks) next.risks_unknowns = `- ${answers.risks.trim()}`;
  return next;
}

function ChecklistItem({ ok, label }) {
  return (
    <div className={`creation-checklist-item ${ok ? 'ok' : ''}`}>
      <span>{ok ? '✓' : '•'}</span>
      <span>{label}</span>
    </div>
  );
}

export default function CreationPipeline({
  draft,
  channel = 'main',
  beginnerMode = false,
  onDraftChange,
  onBackToDescribe,
  onDiscardDraft,
  onApproveAndCreate,
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnswers, setWizardAnswers] = useState({});
  const sectionRefs = useRef({});
  const initializedIdRef = useRef('');

  const ratioKey = useMemo(() => splitRatioKey(draft), [draft]);
  const [planRatio, setPlanRatio] = useState(() => readRatio(ratioKey));
  const [sectionValues, setSectionValues] = useState(createEmptySections());
  const [ideaBankMd, setIdeaBankMd] = useState('');

  const step = normalizeStep(draft?.pipelineStep);
  const specMarkdown = useMemo(() => buildSpecMarkdown(sectionValues), [sectionValues]);
  const completeness = useMemo(() => computeCompleteness(sectionValues), [sectionValues]);

  const summaryGoals = String(draft?.summary?.goals || '').trim();
  const hasPrompt = Boolean(String(draft?.text || '').trim());
  const hasSummary = Boolean(summaryGoals || String(draft?.summary?.nextSteps || '').trim());
  const isPlanReady = completeness.percent >= PLAN_APPROVAL_MIN_COMPLETENESS;

  const readyChecklist = [
    { ok: hasPrompt, label: 'Raw request captured in full' },
    { ok: hasSummary, label: 'Discuss summary has planning context' },
    { ok: isPlanReady, label: `Spec completeness is at least ${PLAN_APPROVAL_MIN_COMPLETENESS}%` },
  ];

  useEffect(() => {
    if (!draft?.id) return;
    if (initializedIdRef.current === draft.id) return;
    initializedIdRef.current = draft.id;

    const fromDraftSpec = String(draft.specDraftMd || '').trim();
    const seededSections = fromDraftSpec
      ? parseSpecMarkdown(fromDraftSpec)
      : seedSectionsFromDraft(draft);
    const seededIdeaBank = String(draft.ideaBankMd || '').trim() || seedIdeaBank(draft);

    setSectionValues(seededSections);
    setIdeaBankMd(seededIdeaBank);
    setPlanRatio(readRatio(ratioKey));
    setWizardOpen(false);
    setWizardAnswers({});
    setError('');
  }, [draft, ratioKey]);

  useEffect(() => {
    if (step !== 'plan') return;
    onDraftChange?.({
      pipelineStep: 'plan',
      specDraftMd: specMarkdown,
      ideaBankMd,
      lastEditedAt: new Date().toISOString(),
      rawRequest: String(draft?.rawRequest || draft?.text || ''),
    });
  }, [step, specMarkdown, ideaBankMd, draft?.rawRequest, draft?.text, onDraftChange]);

  const setStep = (nextStep) => {
    const normalized = normalizeStep(nextStep);
    onDraftChange?.({
      pipelineStep: normalized,
      lastEditedAt: new Date().toISOString(),
    });
  };

  const jumpToSection = (key) => {
    const node = sectionRefs.current?.[key];
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const onWizardAnswerChange = (id, value) => {
    setWizardAnswers((prev) => {
      const nextAnswers = { ...prev, [id]: value };
      setSectionValues((current) => wizardToSections(nextAnswers, current));
      return nextAnswers;
    });
  };

  const approveAndCreate = async () => {
    if (creating) return;
    if (!isPlanReady) {
      setError(`Approval blocked: spec completeness is ${completeness.percent}%.`);
      return;
    }

    setCreating(true);
    setError('');
    try {
      const payload = {
        ...draft,
        rawRequest: String(draft?.rawRequest || draft?.text || ''),
        specDraftMd: specMarkdown,
        ideaBankMd,
        pipelineStep: 'build',
        lastEditedAt: new Date().toISOString(),
      };
      onDraftChange?.(payload);
      await onApproveAndCreate?.(payload);
    } catch (err) {
      setError(err?.message || 'Failed to create project from approved plan.');
      setStep('plan');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="creation-pipeline-shell">
      <header className="creation-pipeline-header panel">
        <div>
          <h2>Discuss → Plan → Build</h2>
          <p>Keep the full request intact, refine with agents, then explicitly approve before project creation.</p>
        </div>
        <div className="creation-pipeline-actions">
          <button type="button" className="ui-btn" onClick={onBackToDescribe}>
            Back to Describe
          </button>
          <button type="button" className="ui-btn ui-btn-destructive" onClick={onDiscardDraft}>
            Start Over
          </button>
        </div>
      </header>

      <div className="creation-pipeline-stepper panel">
        <button
          type="button"
          className={`creation-step-chip ${step === 'discuss' ? 'active' : ''}`}
          onClick={() => setStep('discuss')}
        >
          1. Discuss
        </button>
        <button
          type="button"
          className={`creation-step-chip ${step === 'plan' ? 'active' : ''}`}
          onClick={() => setStep('plan')}
        >
          2. Plan
        </button>
        <div className={`creation-step-chip static ${step === 'build' ? 'active' : ''}`}>
          3. Build
        </div>
        <span className="creation-step-copy">
          {step === 'discuss' && 'Discussing your idea (Step 1/3)'}
          {step === 'plan' && 'Confirming spec before project creation (Step 2/3)'}
          {step === 'build' && 'Creating project workspace (Step 3/3)'}
        </span>
      </div>

      {step === 'discuss' && (
        <DraftDiscussView
          channel={channel}
          projectName="ai-office"
          beginnerMode={beginnerMode}
          draft={draft}
          onDraftChange={onDraftChange}
          onPrimaryAction={() => setStep('plan')}
          primaryActionLabel="Proceed to Build"
          onDiscardDraft={onDiscardDraft}
          onEditDraft={onBackToDescribe}
        />
      )}

      {step === 'plan' && (
        <div className="creation-plan-shell panel">
          <div className="creation-plan-top">
            <div>
              <h3>Plan and Spec Confirmation</h3>
              <p>Approve only when the spec is clear, testable, and ready for implementation.</p>
            </div>
            <div className="creation-plan-actions">
              <button type="button" className="ui-btn" onClick={() => setStep('discuss')}>
                Back to Discuss
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={approveAndCreate}
                disabled={creating}
              >
                {creating ? 'Creating Project…' : 'Approve & Create Project'}
              </button>
            </div>
          </div>

          <SpecCompletenessMeter completeness={completeness} onJumpToSection={jumpToSection} />

          <section className="creation-checklist">
            <h4>Ready to build checklist</h4>
            <div className="creation-checklist-grid">
              {readyChecklist.map((item) => (
                <ChecklistItem key={item.label} ok={item.ok} label={item.label} />
              ))}
            </div>
          </section>

          <SpecWizard
            enabled={wizardOpen}
            onToggle={() => setWizardOpen((prev) => !prev)}
            answers={wizardAnswers}
            onAnswerChange={onWizardAnswerChange}
          />

          <div className="creation-plan-split">
            <SplitPane
              direction="vertical"
              ratio={planRatio}
              defaultRatio={0.52}
              minPrimary={420}
              minSecondary={360}
              persistKey={ratioKey}
              primaryLabel="Spec Editor"
              secondaryLabel="Spec Preview"
              onRatioChange={(next) => {
                const normalized = clampRatio(next);
                setPlanRatio(normalized);
                try {
                  localStorage.setItem(ratioKey, String(normalized));
                } catch {
                  // ignore storage failures
                }
              }}
            >
              <section className="creation-plan-editor">
                <SpecEditor
                  sections={SPEC_SECTIONS}
                  values={sectionValues}
                  missingKeys={completeness.missing}
                  sectionRefs={sectionRefs}
                  onChangeSection={(key, value) => setSectionValues((prev) => ({ ...prev, [key]: value }))}
                  ideaBankMd={ideaBankMd}
                  onChangeIdeaBank={setIdeaBankMd}
                  onJumpToSection={jumpToSection}
                />
              </section>
              <section className="creation-plan-preview">
                <SpecPreview
                  markdown={specMarkdown}
                  ideaBankMd={ideaBankMd}
                  selectedHistory={null}
                  historyContent=""
                  compareEnabled={false}
                  changedSectionKeys={[]}
                  sections={SPEC_SECTIONS}
                />
              </section>
            </SplitPane>
          </div>
        </div>
      )}

      {step === 'build' && (
        <div className="creation-build-wait panel">
          <h3>Creating project workspace…</h3>
          <p>Please wait while the project is initialized and Build mode opens.</p>
        </div>
      )}

      {error ? <div className="agent-config-error">{error}</div> : null}
    </section>
  );
}
