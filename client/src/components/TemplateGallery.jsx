import { useState } from 'react';

function compactPrompt(text) {
  const value = String(text || '').trim();
  if (value.length <= 120) return value;
  return `${value.slice(0, 117)}...`;
}

export default function TemplateGallery({
  templates = [],
  selectedTemplate = '',
  disabled = false,
  onSelect,
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="template-gallery">
      <div className="template-gallery-header">
        <h4>Starter Templates</h4>
        <button type="button" className="refresh-btn ui-btn" onClick={() => setOpen((prev) => !prev)}>
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {open && (
        <div className="template-gallery-grid">
          <button
            type="button"
            disabled={disabled}
            className={`template-card blank ${selectedTemplate === '' ? 'active' : ''}`}
            onClick={() => onSelect?.({ template: '', prompt: '', label: 'Blank' })}
          >
            <strong>Blank</strong>
            <span>Start from scratch with your own prompt.</span>
          </button>
          {templates.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={disabled}
              className={`template-card ${selectedTemplate === item.template ? 'active' : ''}`}
              onClick={() => onSelect?.(item)}
            >
              <strong>{item.label}</strong>
              <span>{compactPrompt(item.prompt)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
