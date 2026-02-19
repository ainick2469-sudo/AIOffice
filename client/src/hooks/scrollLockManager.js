const GLOBAL_STATE_KEY = '__AI_OFFICE_SCROLL_LOCK_STATE__';

function getState() {
  if (typeof window === 'undefined') {
    return { locks: new Map(), changedAt: Date.now() };
  }
  if (!window[GLOBAL_STATE_KEY]) {
    window[GLOBAL_STATE_KEY] = {
      locks: new Map(),
      changedAt: Date.now(),
    };
  }
  return window[GLOBAL_STATE_KEY];
}

function emitChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ai-office:scroll-lock-changed', {
    detail: getBodyScrollLockSnapshot(),
  }));
}

function applyBodyOverflow() {
  if (typeof document === 'undefined') return;
  const state = getState();
  const hasLocks = state.locks.size > 0;
  document.body.style.overflow = hasLocks ? 'hidden' : '';
}

export function acquireBodyScrollLock(reason = 'unknown') {
  const state = getState();
  const token = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.locks.set(token, {
    reason: String(reason || 'unknown'),
    createdAt: new Date().toISOString(),
  });
  state.changedAt = Date.now();
  applyBodyOverflow();
  emitChange();
  return token;
}

export function releaseBodyScrollLock(token) {
  const state = getState();
  if (!token) return;
  if (!state.locks.has(token)) return;
  state.locks.delete(token);
  state.changedAt = Date.now();
  applyBodyOverflow();
  emitChange();
}

export function clearAllBodyScrollLocks() {
  const state = getState();
  state.locks.clear();
  state.changedAt = Date.now();
  applyBodyOverflow();
  emitChange();
}

export function getBodyScrollLockSnapshot() {
  const state = getState();
  return {
    count: state.locks.size,
    locks: Array.from(state.locks.entries()).map(([id, entry]) => ({
      id,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
    bodyOverflow:
      typeof document !== 'undefined'
        ? (document.body?.style?.overflow || '')
        : '',
    changedAt: state.changedAt,
  };
}

