import { useMemo, useState } from 'react';

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

export default function TemplateGallery({
  templates = [],
  selectedTemplate = '',
  disabled = false,
  onSelect,
}) {
  const [open, setOpen] = useState(true);

  const normalizedTemplates = useMemo(
    () => templates.map(normalizeTemplate).filter(Boolean),
    [templates]
  );

  return (
    <section className="template-gallery">
      <div className="template-gallery-header">
        <div>
          <h4>Starter Templates</h4>
          <p>Pick one strong starter and customize it in Review.</p>
        </div>
        <button type="button" className="refresh-btn ui-btn" onClick={() => setOpen((prev) => !prev)}>
          {open ? 'Hide Templates' : 'Show Templates'}
        </button>
      </div>
      {open && (
        <div className="template-gallery-grid">
          {normalizedTemplates.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={disabled}
              className={`template-card ${selectedTemplate === item.id ? 'active' : ''} ${item.recommended ? 'recommended' : ''}`}
              onClick={() => onSelect?.(item)}
            >
              <div className="template-card-head">
                <strong>{item.title}</strong>
                {item.recommended ? <span className="ui-chip template-recommended">Recommended</span> : null}
              </div>
              <span className="template-card-description">{item.description}</span>
              <div className="template-card-meta">
                <span className="ui-chip template-stack">{String(item.stackPreset || 'auto-detect').replace(/-/g, ' ')}</span>
              </div>
              {item.bullets.length > 0 ? (
                <ul className="template-bullets">
                  {item.bullets.map((bullet) => (
                    <li key={`${item.id}-${bullet}`}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
