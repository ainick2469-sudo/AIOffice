import { useCallback, useEffect, useState } from 'react';
import {
  DESKTOP_WINDOW_SYNC_EVENT,
  hasDesktopWindowApi,
  invokeDesktopWindow,
  normalizeDesktopWindowState,
  syncDesktopWindowState,
} from '../lib/desktopWindow';

export default function DesktopWindowControls({ className = '' }) {
  const isDesktop = hasDesktopWindowApi();
  const [windowState, setWindowState] = useState(() =>
    normalizeDesktopWindowState({ state: 'unknown', maximized: false, fullscreen: false, minimized: false })
  );

  const refreshState = useCallback(async () => {
    const synced = await syncDesktopWindowState();
    if (!synced?.ok) return;
    setWindowState(normalizeDesktopWindowState(synced.state));
  }, []);

  useEffect(() => {
    if (!isDesktop) return undefined;
    refreshState();
    const interval = window.setInterval(refreshState, 1200);
    const onSync = () => {
      refreshState();
    };
    window.addEventListener(DESKTOP_WINDOW_SYNC_EVENT, onSync);
    window.addEventListener('focus', onSync);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(DESKTOP_WINDOW_SYNC_EVENT, onSync);
      window.removeEventListener('focus', onSync);
    };
  }, [isDesktop, refreshState]);

  if (!isDesktop) return null;

  const handleMinimize = async () => {
    const result = await invokeDesktopWindow('minimize');
    if (!result?.ok && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Minimize failed', result);
    }
    window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
  };

  const handleToggleMaximize = async () => {
    const result = await invokeDesktopWindow('toggle_maximize');
    if (result?.ok) {
      setWindowState(normalizeDesktopWindowState(result?.state || result));
      window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
      return;
    }
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Toggle maximize failed', result);
    }
  };

  const handleToggleFullscreen = async () => {
    const result = await invokeDesktopWindow('toggle_fullscreen');
    if (result?.ok) {
      setWindowState(normalizeDesktopWindowState(result?.state || result));
      window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_SYNC_EVENT));
      return;
    }
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[DesktopWindowControls] Toggle fullscreen failed', result);
    }
  };

  const handleClose = async () => {
    const result = await invokeDesktopWindow('close');
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
        title={windowState.maximized ? 'Restore' : 'Maximize'}
        aria-label={windowState.maximized ? 'Restore window' : 'Maximize window'}
        onClick={handleToggleMaximize}
      >
        <span aria-hidden="true">{windowState.maximized ? '[]' : '[ ]'}</span>
      </button>
      <button
        type="button"
        className={`desktop-window-btn fullscreen pywebview-no-drag ${windowState.fullscreen ? 'active' : ''}`}
        title={windowState.fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        aria-label={windowState.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        onClick={handleToggleFullscreen}
      >
        <span aria-hidden="true">{windowState.fullscreen ? 'Exit' : 'FS'}</span>
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
