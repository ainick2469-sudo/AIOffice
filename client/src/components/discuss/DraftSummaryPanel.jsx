const SUMMARY_FIELDS = [
  { id: 'goals', label: 'Goals', hint: 'What the project should achieve.' },
  { id: 'risks', label: 'Risks', hint: 'Unknowns and failure points.' },
  { id: 'questions', label: 'Open Questions', hint: 'Questions to answer before build.' },
  { id: 'nextSteps', label: 'Proposed Next Steps', hint: 'Immediate sequence after approval.' },
];

export default function DraftSummaryPanel({
  summary,
  onChangeSummary,
  suggestedName,
  suggestedStack,
  importQueue = [],
}) {
  const writeField = (id, value) => {
    onChangeSummary?.({
      ...(summary || {}),
      [id]: value,
    });
  };

  return (
    <section className="draft-summary-panel panel">
      <header className="draft-summary-head">
        <h3>Draft Summary</h3>
        <p>Capture planning notes before creating the real project.</p>
      </header>

      <div className="draft-summary-meta">
        <div><span>Name</span><strong>{suggestedName || 'new-project'}</strong></div>
        <div><span>Stack</span><strong>{suggestedStack || 'auto-detect'}</strong></div>
        <div><span>Imports</span><strong>{importQueue.length || 0} queued item(s)</strong></div>
      </div>

      <div className="draft-summary-fields">
        {SUMMARY_FIELDS.map((field) => (
          <label key={field.id} className="draft-summary-field">
            <span>{field.label}</span>
            <small>{field.hint}</small>
            <textarea
              className="ui-input"
              rows={3}
              value={summary?.[field.id] || ''}
              onChange={(event) => writeField(field.id, event.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
