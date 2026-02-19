import { useEffect, useRef } from 'react';

export default function useVisibilityInterval(callback, intervalMs, options = {}) {
  const { enabled = true } = options;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return undefined;

    let intervalId = null;

    const clear = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = () => {
      if (document.visibilityState !== 'visible' || intervalId != null) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        callbackRef.current?.();
      }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        clear();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
