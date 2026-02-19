import { useEffect, useRef, useState } from 'react';

export default function PreviewTopBar({
  statusLabel,
  statusClass,
  isRunning,
  previewUrl,
  autoScroll,
  onStart,
  onRestart,
  onStop,
  onCopyUrl,
  onOpenExternal,
  onToggleDevicePreset,
  devicePreset,
  onToggleAutoScroll,
  onOpenAdvanced,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  return (
    <section className="preview-topbar">
      <div className="preview-topbar-left">
        <span className={`preview-v3-status ${statusClass}`}>{statusLabel}</span>
        <button
          type="button"
          className={`preview-url-chip ${previewUrl ? 'active' : ''}`}
          onClick={onCopyUrl}
          disabled={!previewUrl}
          title={previewUrl || 'Preview URL not detected yet'}
        >
          {previewUrl || 'Waiting for URL...'}
        </button>
      </div>

      <div className="preview-topbar-center">
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={isRunning ? onRestart : onStart}
        >
          {isRunning ? 'Restart Preview' : 'Start Preview'}
        </button>
      </div>

      <div className="preview-topbar-right">
        <button
          type="button"
          className="ui-btn"
          onClick={onStop}
          disabled={!isRunning}
        >
          Stop
        </button>

        <div className="preview-more-menu" ref={menuRef}>
          <button
            type="button"
            className={`ui-btn preview-more-trigger ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="preview-more-popover" role="menu">
              <button type="button" className="ui-btn" onClick={() => { onOpenExternal?.(); setMenuOpen(false); }} disabled={!previewUrl}>
                Open in Browser
              </button>
              <button type="button" className="ui-btn" onClick={() => { onCopyUrl?.(); setMenuOpen(false); }} disabled={!previewUrl}>
                Copy URL
              </button>
              <button type="button" className="ui-btn" onClick={() => { onToggleDevicePreset?.('mobile'); setMenuOpen(false); }}>
                Device: {devicePreset === 'mobile' ? 'Mobile' : 'Set Mobile'}
              </button>
              <button type="button" className="ui-btn" onClick={() => { onToggleDevicePreset?.('tablet'); setMenuOpen(false); }}>
                Device: {devicePreset === 'tablet' ? 'Tablet' : 'Set Tablet'}
              </button>
              <button type="button" className="ui-btn" onClick={() => { onToggleDevicePreset?.('desktop'); setMenuOpen(false); }}>
                Device: {devicePreset === 'desktop' ? 'Desktop' : 'Set Desktop'}
              </button>
              <button type="button" className="ui-btn" onClick={() => { onToggleAutoScroll?.(); setMenuOpen(false); }}>
                Logs Auto-scroll: {autoScroll ? 'On' : 'Off'}
              </button>
              <button type="button" className="ui-btn" onClick={() => { onOpenAdvanced?.(); setMenuOpen(false); }}>
                Edit command/port
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
