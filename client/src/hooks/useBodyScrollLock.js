import { useEffect, useRef } from 'react';
import {
  acquireBodyScrollLock,
  releaseBodyScrollLock,
  getBodyScrollLockSnapshot,
} from './scrollLockManager';

export { getBodyScrollLockSnapshot };

export default function useBodyScrollLock(active, reason) {
  const tokenRef = useRef(null);

  useEffect(() => {
    if (!active) {
      if (tokenRef.current) {
        releaseBodyScrollLock(tokenRef.current);
        tokenRef.current = null;
      }
      return undefined;
    }

    tokenRef.current = acquireBodyScrollLock(reason || 'ui-overlay');
    return () => {
      if (tokenRef.current) {
        releaseBodyScrollLock(tokenRef.current);
        tokenRef.current = null;
      }
    };
  }, [active, reason]);
}

