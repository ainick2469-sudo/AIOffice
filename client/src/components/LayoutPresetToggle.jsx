const DEFAULT_OPTIONS = [
  { id: 'split', label: 'Split' },
  { id: 'full-ide', label: 'Full IDE' },
  { id: 'focus-preview', label: 'Focus Preview' },
];

export default function LayoutPresetToggle({
  value = 'split',
  onChange,
  onReset,
  showReset = true,
  options = DEFAULT_OPTIONS,
}) {
  return (
    <div className="layout-preset-toggle-wrap">
      <label className="layout-preset-toggle">
        <span>Layout</span>
        <select className="ui-input" value={value} onChange={(event) => onChange?.(event.target.value)}>
          {(options || DEFAULT_OPTIONS).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {showReset && (
        <button type="button" className="refresh-btn ui-btn" onClick={() => onReset?.()}>
          Reset Layout
        </button>
      )}
    </div>
  );
}
