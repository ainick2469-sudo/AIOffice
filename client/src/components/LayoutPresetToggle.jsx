const OPTIONS = [
  { id: 'chat-preview', label: 'Chat + Preview' },
  { id: 'chat-files', label: 'Chat + Files' },
  { id: 'full-ide', label: 'Full IDE' },
  { id: 'focus', label: 'Focus (Preview only)' },
];

export default function LayoutPresetToggle({ value = 'full-ide', onChange, onReset }) {
  return (
    <div className="layout-preset-toggle-wrap">
      <label className="layout-preset-toggle">
        <span>Layout</span>
        <select value={value} onChange={(event) => onChange?.(event.target.value)}>
          {OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="refresh-btn" onClick={() => onReset?.()}>
        Reset Layout
      </button>
    </div>
  );
}
