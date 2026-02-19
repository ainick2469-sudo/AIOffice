import { useEffect, useMemo, useState } from 'react';
import {
  THEME_SCHEMES,
  getThemeSchemeMeta,
  nextThemeScheme,
} from '../../lib/themeCatalog';

const DENSITY_KEY = 'ai-office-ui-density';
const FONT_SIZE_KEY = 'ai-office-ui-font-size';

export default function AppearanceSettings({
  themeMode,
  onThemeModeChange,
  themeScheme,
  onThemeSchemeChange,
  onCycleThemeScheme,
}) {
  const [density, setDensity] = useState(() => localStorage.getItem(DENSITY_KEY) || 'comfortable');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_SIZE_KEY) || 'm');
  const currentScheme = useMemo(() => getThemeSchemeMeta(themeScheme), [themeScheme]);

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

  const cycleTheme = () => {
    if (typeof onCycleThemeScheme === 'function') {
      onCycleThemeScheme();
      return;
    }
    onThemeSchemeChange?.(nextThemeScheme(themeScheme));
  };

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
          <span>Theme mode</span>
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

      <div className="theme-gallery-strip panel">
        <div className="theme-gallery-head">
          <div>
            <strong>Theme Gallery</strong>
            <span>Choose a curated scheme or cycle in one click.</span>
          </div>
          <button
            type="button"
            className="ui-btn"
            onClick={cycleTheme}
            data-tooltip="Cycle color scheme"
          >
            Cycle Theme
          </button>
        </div>

        <div className="theme-gallery-grid">
          {THEME_SCHEMES.map((scheme) => {
            const selected = scheme.id === currentScheme.id;
            return (
              <button
                key={scheme.id}
                type="button"
                className={`theme-gallery-card ${selected ? 'selected' : ''}`}
                onClick={() => onThemeSchemeChange?.(scheme.id)}
                data-tooltip={scheme.description}
              >
                <div className="theme-gallery-card-head">
                  <strong>{scheme.label}</strong>
                  {selected ? <span className="ui-chip pill is-active">Selected</span> : null}
                </div>
                <p>{scheme.description}</p>
                <div className="theme-gallery-swatches">
                  <span className="theme-swatch bg" />
                  <span className="theme-swatch panel" />
                  <span className="theme-swatch accent" style={{ background: scheme.accent }} />
                  <span className="theme-swatch accent2" style={{ background: scheme.accent2 }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="appearance-preview-strip panel">
        <div className="appearance-preview-head">
          <strong>Theme preview</strong>
          <span>Live sample of panel, text, chips, and button states.</span>
        </div>
        <div className="appearance-preview-body">
          <article className="appearance-preview-card">
            <h5>{currentScheme.label} sample panel</h5>
            <p>Primary content text with muted metadata below.</p>
            <small>Muted helper text</small>
          </article>
          <div className="appearance-preview-chips">
            <span className="ui-chip">Project chip</span>
            <span className="ui-chip pill is-active">Active state</span>
          </div>
          <div className="appearance-preview-actions">
            <button type="button" className="ui-btn ui-btn-primary">Primary</button>
            <button type="button" className="ui-btn">Secondary</button>
          </div>
        </div>
      </div>
    </section>
  );
}
