import { useState } from 'react';

function hasDesktopApi() {
  return typeof window !== 'undefined' && Boolean(window.pywebview?.api);
}

async function invokeDesktop(method) {
  if (!hasDesktopApi()) return { ok: false, error: 'desktop_api_unavailable' };
  const fn = window.pywebview?.api?.[method];
  if (typeof fn !== 'function') return { ok: false, error: `missing_method:${method}` };
  try {
    const result = await fn();
    if (result && typeof result === 'object') return result;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export default function DesktopWindowControls({ className = '' }) {
  const isDesktop = hasDesktopApi();
  const [isMaximized, setIsMaximized] = useState(false);

  if (!isDesktop) return null;

  const handleMinimize = async () => {
    const result = await invokeDesktop('minimize');
    if (!result?.ok && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Minimize failed', result);
    }
  };

  const handleToggleMaximize = async () => {
    const result = await invokeDesktop('toggle_maximize');
    if (result?.ok) {
      setIsMaximized((prev) => !prev);
      return;
    }
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Toggle maximize failed', result);
    }
  };

  const handleClose = async () => {
    const result = await invokeDesktop('close');
    if (!result?.ok && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Close failed', result);
    }
  };

  return (
    <div className={`desktop-window-controls ${className}`.trim()} aria-label="Window controls">
      <button
        type="button"
        className="desktop-window-btn minimize pywebview-no-drag"
        title="Minimize"
        aria-label="Minimize window"
        onClick={handleMinimize}
      >
        <span aria-hidden="true">_</span>
      </button>
      <button
        type="button"
        className="desktop-window-btn maximize pywebview-no-drag"
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        onClick={handleToggleMaximize}
      >
        <span aria-hidden="true">{isMaximized ? '[]' : '[ ]'}</span>
      </button>
      <button
        type="button"
        className="desktop-window-btn close pywebview-no-drag"
        title="Close"
        aria-label="Close window"
        onClick={handleClose}
      >
        <span aria-hidden="true">X</span>
      </button>
    </div>
  );
}
