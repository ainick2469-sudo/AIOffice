export const DESKTOP_WINDOW_STATE_EVENT = 'ai-office:desktop-window-state';
export const DESKTOP_WINDOW_SYNC_EVENT = 'ai-office:desktop-window-sync';

export function hasDesktopWindowApi() {
  return typeof window !== 'undefined' && Boolean(window.pywebview?.api);
}

export async function invokeDesktopWindow(method) {
  if (!hasDesktopWindowApi()) return { ok: false, error: 'desktop_api_unavailable' };
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

export function normalizeDesktopWindowState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    state: String(source.state || '').trim().toLowerCase() || 'unknown',
    maximized: Boolean(source.maximized),
    fullscreen: Boolean(source.fullscreen),
    minimized: Boolean(source.minimized),
  };
}

export function emitDesktopWindowState(rawState) {
  if (typeof window === 'undefined') return;
  const detail = normalizeDesktopWindowState(rawState);
  window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_STATE_EVENT, { detail }));
}

export async function syncDesktopWindowState() {
  const result = await invokeDesktopWindow('get_window_state');
  if (!result?.ok) return result;
  const state = normalizeDesktopWindowState(result?.state || result);
  emitDesktopWindowState(state);
  return { ok: true, state };
}

