import { SPEC_SECTIONS } from './specSchema';

export default function SpecEditor({
  sections,
  values,
  missingKeys,
  sectionRefs,
  onChangeSection,
  ideaBankMd,
  onChangeIdeaBank,
  onJumpToSection,
}) {
  const missing = new Set(missingKeys || []);

  return (
    <div className="spec-editor">
      <div className="spec-editor-nav">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`spec-editor-chip ${missing.has(section.key) ? 'missing' : ''}`}
            onClick={() => onJumpToSection?.(section.key)}
          >
            {section.title}
          </button>
        ))}
      </div>

      <div className="spec-editor-sections">
        {sections.map((section) => (
          <section
            key={section.key}
            ref={(node) => {
              if (!sectionRefs?.current) return;
              sectionRefs.current[section.key] = node;
            }}
            className={`spec-editor-section ${missing.has(section.key) ? 'missing' : ''}`}
          >
            <header>
              <h4>{section.title}</h4>
              <p>{section.hint}</p>
            </header>
            <textarea
              value={String(values?.[section.key] || '')}
              onChange={(event) => onChangeSection?.(section.key, event.target.value)}
              placeholder={section.placeholder}
            />
          </section>
        ))}

        <section className="spec-editor-section idea-bank">
          <header>
            <h4>Idea Bank</h4>
            <p>Optional notes, alternatives, references, and parked ideas.</p>
          </header>
          <textarea
            value={ideaBankMd}
            onChange={(event) => onChangeIdeaBank?.(event.target.value)}
            placeholder="Store optional ideas, alternatives, references, and parking-lot notes."
          />
        </section>
      </div>
    </div>
  );
}

export { SPEC_SECTIONS };
