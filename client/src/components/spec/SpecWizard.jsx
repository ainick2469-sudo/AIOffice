const WIZARD_QUESTIONS = [
  {
    id: 'goal',
    label: 'What are we building, and why now?',
    placeholder: 'Example: Build a desktop-first AI work OS for planning and verified coding.',
  },
  {
    id: 'users',
    label: 'Who is the primary user and what outcome do they need?',
    placeholder: 'Example: Solo founder needs to go from idea to working app quickly.',
  },
  {
    id: 'platform',
    label: 'What platform should this target first?',
    placeholder: 'Example: Web app (desktop-first), Chrome/Edge.',
  },
  {
    id: 'core_loop',
    label: 'Describe the core loop users repeat.',
    placeholder: 'Example: Discuss goal -> approve spec -> build -> verify -> preview.',
  },
  {
    id: 'must',
    label: 'List must-have features.',
    placeholder: 'Example: Project-first workspace, approvals queue, preview mode.',
  },
  {
    id: 'should',
    label: 'List should-have features.',
    placeholder: 'Example: Version history, command palette, debug export.',
  },
  {
    id: 'could',
    label: 'List could-have features (nice to have).',
    placeholder: 'Example: voice controls, advanced telemetry.',
  },
  {
    id: 'non_goals',
    label: 'What is explicitly out of scope?',
    placeholder: 'Example: Mobile app, marketplace integrations.',
  },
  {
    id: 'ux',
    label: 'What screens and key interactions matter most?',
    placeholder: 'Example: Create Home, Discuss mode, Build mode, Spec, Preview.',
  },
  {
    id: 'data_state',
    label: 'What core data or state model should this use?',
    placeholder: 'Example: projects, channels, specs, tasks; draft -> approved transitions.',
  },
  {
    id: 'acceptance',
    label: 'What acceptance checks prove success?',
    placeholder: 'Example: Can create project from prompt, approve spec, run preview.',
  },
  {
    id: 'risks',
    label: 'What risks or unknowns should we track?',
    placeholder: 'Example: Provider connectivity, model routing fallback behavior.',
  },
];

export default function SpecWizard({
  enabled,
  onToggle,
  answers,
  onAnswerChange,
}) {
  return (
    <section className="spec-wizard">
      <div className="spec-wizard-header">
        <div>
          <h4>Spec Wizard</h4>
          <p>Answer quick prompts and the editor sections fill automatically.</p>
        </div>
        <button type="button" className="control-btn ui-btn" onClick={onToggle}>
          {enabled ? 'Hide Wizard' : 'Show Wizard'}
        </button>
      </div>

      {enabled && (
        <div className="spec-wizard-grid">
          {WIZARD_QUESTIONS.map((question) => (
            <label key={question.id} className="spec-wizard-field">
              <span>{question.label}</span>
              <textarea
                value={String(answers?.[question.id] || '')}
                onChange={(event) => onAnswerChange?.(question.id, event.target.value)}
                placeholder={question.placeholder}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
