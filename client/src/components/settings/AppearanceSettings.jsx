import { useEffect, useState } from 'react';

const DENSITY_KEY = 'ai-office-ui-density';
const FONT_SIZE_KEY = 'ai-office-ui-font-size';

export default function AppearanceSettings({
  themeMode,
  onThemeModeChange,
}) {
  const [density, setDensity] = useState(() => localStorage.getItem(DENSITY_KEY) || 'comfortable');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_SIZE_KEY) || 'm');

  useEffect(() => {
    const next = density === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.setAttribute('data-density', next);
    localStorage.setItem(DENSITY_KEY, next);
  }, [density]);

  useEffect(() => {
    const next = ['s', 'm', 'l'].includes(fontSize) ? fontSize : 'm';
    document.documentElement.setAttribute('data-font-size', next);
    localStorage.setItem(FONT_SIZE_KEY, next);
  }, [fontSize]);

  return (
    <section className="settings-section-card panel">
      <header className="settings-section-head">
        <div>
          <h4>Appearance</h4>
          <p>Set visual theme and reading density to match your workflow.</p>
        </div>
      </header>

      <div className="settings-field-grid">
        <label className="settings-field">
          <span>Theme</span>
          <select
            className="ui-input"
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Density</span>
          <select
            className="ui-input"
            value={density}
            onChange={(event) => setDensity(event.target.value)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        <label className="settings-field">
          <span>Font size</span>
          <select
            className="ui-input"
            value={fontSize}
            onChange={(event) => setFontSize(event.target.value)}
          >
            <option value="s">Small</option>
            <option value="m">Medium</option>
            <option value="l">Large</option>
          </select>
        </label>
      </div>
    </section>
  );
}
