const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta?.env?.DEV);

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function normalizeEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '(unknown)';
  return raw.replace(/^https?:\/\/[^/]+/i, '');
}

export function createStartupRequestMeter(scope, options = {}) {
  const label = String(scope || 'scope').trim() || 'scope';
  const windowMs = Number.isFinite(options?.windowMs) ? Math.max(500, options.windowMs) : 10_000;
  if (!IS_DEV || typeof window === 'undefined') {
    return {
      track() {},
      stop() {},
    };
  }

  const startedAt = nowMs();
  let total = 0;
  const byEndpoint = new Map();
  let closed = false;

  const flush = (reason = 'window-ended') => {
    if (closed) return;
    closed = true;
    const elapsed = Math.round(nowMs() - startedAt);
    const top = Array.from(byEndpoint.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([endpoint, count]) => ({ endpoint, count }));
    console.info(`[perf][${label}] first ${windowMs}ms requests`, {
      total,
      elapsed_ms: elapsed,
      reason,
      top,
    });
  };

  const timer = window.setTimeout(() => flush('window-complete'), windowMs);

  return {
    track(endpoint) {
      if (closed) return;
      total += 1;
      const key = normalizeEndpoint(endpoint);
      byEndpoint.set(key, (byEndpoint.get(key) || 0) + 1);
    },
    stop(reason = 'component-unmount') {
      if (closed) return;
      window.clearTimeout(timer);
      flush(reason);
    },
  };
}
