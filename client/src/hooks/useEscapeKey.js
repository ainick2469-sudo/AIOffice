import { useEffect } from 'react';

export default function useEscapeKey(handler, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof handler !== 'function') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, enabled]);
}

