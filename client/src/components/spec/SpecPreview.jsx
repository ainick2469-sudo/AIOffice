import MessageContent from '../MessageContent';

function sectionTitleMap(sections) {
  const map = {};
  (sections || []).forEach((section) => {
    map[section.key] = section.title;
  });
  return map;
}

export default function SpecPreview({
  markdown,
  ideaBankMd,
  selectedHistory,
  historyContent,
  compareEnabled,
  changedSectionKeys,
  lineDiffSummary = null,
  sections,
}) {
  const titleByKey = sectionTitleMap(sections);
  const selectedName = selectedHistory?.name || '';
  const displayMarkdown = String(historyContent || markdown || '').trim();
  const showHistory = Boolean(selectedHistory);

  return (
    <div className="spec-preview">
      <div className="spec-preview-header">
        <h4>{showHistory ? `History: ${selectedName}` : 'Live Spec Preview'}</h4>
        <span className="pill ui-chip">{showHistory ? 'Read-only' : 'Current draft'}</span>
      </div>

      <div className="spec-preview-body">
        {displayMarkdown ? (
          <MessageContent content={displayMarkdown} />
        ) : (
          <div className="spec-preview-empty">No preview content yet.</div>
        )}
      </div>

      {!showHistory && (
        <details className="spec-preview-idea-bank">
          <summary>Idea Bank Preview</summary>
          <div className="spec-preview-idea-body">
            <MessageContent content={String(ideaBankMd || '').trim() || '_No idea bank notes yet._'} />
          </div>
        </details>
      )}

      {compareEnabled && (
        <section className="spec-compare-summary">
          <h5>Compare Summary</h5>
          {Array.isArray(changedSectionKeys) && changedSectionKeys.length > 0 ? (
            <ul>
              {changedSectionKeys.map((key) => (
                <li key={key}>{titleByKey[key] || key}</li>
              ))}
            </ul>
          ) : (
            <p>No section-level differences detected.</p>
          )}
          {lineDiffSummary ? (
            <p>Line delta: +{lineDiffSummary.added} / -{lineDiffSummary.removed}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
