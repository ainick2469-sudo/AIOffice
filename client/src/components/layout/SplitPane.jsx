import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DRAG_CLASS = 'splitpane-dragging';
const DRAG_CLASS_HORIZONTAL = 'splitpane-dragging-horizontal';
const DRAG_CLASS_VERTICAL = 'splitpane-dragging-vertical';
const LEGACY_DRAG_CLASS = 'is-resizing';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeRatio(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return fallback;
  return parsed;
}

function containerSize(rect, direction) {
  return direction === 'horizontal' ? rect.height : rect.width;
}

function pointFromPosition(position, direction) {
  return direction === 'horizontal' ? position.clientY : position.clientX;
}

function readPersistedRatio(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.ratio ?? parsed?.value ?? parsed);
    if (!Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

function persistRatio(storageKey, value) {
  if (!storageKey) return;
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        ratio: value,
        updated_at: new Date().toISOString(),
      })
    );
  } catch {
    // ignore storage errors
  }
}

function toggleIframePointerEvents(disabled) {
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach((frame) => {
    if (!(frame instanceof HTMLElement)) return;
    if (disabled) {
      if (!Object.prototype.hasOwnProperty.call(frame.dataset, 'splitpanePrevPointer')) {
        frame.dataset.splitpanePrevPointer = frame.style.pointerEvents || '';
      }
      frame.style.pointerEvents = 'none';
      return;
    }
    if (Object.prototype.hasOwnProperty.call(frame.dataset, 'splitpanePrevPointer')) {
      frame.style.pointerEvents = frame.dataset.splitpanePrevPointer || '';
      delete frame.dataset.splitpanePrevPointer;
    } else {
      frame.style.pointerEvents = '';
    }
  });
}

export default function SplitPane({
  direction = 'vertical',
  ratio = 0.5,
  defaultRatio = 0.5,
  minPrimary = 280,
  minSecondary = 280,
  maxPrimary = null,
  maxSecondary = null,
  className = '',
  onRatioChange,
  children,
  persistKey = '',
  primaryLabel = 'Primary',
  secondaryLabel = 'Secondary',
}) {
  const panes = useMemo(() => {
    const list = Array.isArray(children) ? children : [children];
    return list.filter(Boolean).slice(0, 2);
  }, [children]);

  const containerRef = useRef(null);
  const dividerRef = useRef(null);
  const dragStateRef = useRef(null);
  const rafRef = useRef(0);
  const pendingPointRef = useRef(null);
  const ratioRef = useRef(safeRatio(ratio, defaultRatio));
  const persistedKeyRef = useRef('');
  const [isDragging, setIsDragging] = useState(false);
  const [internalRatio, setInternalRatio] = useState(safeRatio(ratio, defaultRatio));
  const [dragSummary, setDragSummary] = useState('');

  const resolveRatio = useCallback((proposedRatio) => {
    if (!containerRef.current) return safeRatio(proposedRatio, defaultRatio);
    const rect = containerRef.current.getBoundingClientRect();
    const total = containerSize(rect, direction);
    if (!Number.isFinite(total) || total <= 0) return safeRatio(proposedRatio, defaultRatio);

    let minA = Number(minPrimary);
    let minB = Number(minSecondary);
    minA = Number.isFinite(minA) && minA >= 0 ? minA : 0;
    minB = Number.isFinite(minB) && minB >= 0 ? minB : 0;

    let lowerPx = minA;
    let upperPx = total - minB;

    if (Number.isFinite(Number(maxPrimary)) && Number(maxPrimary) >= 0) {
      upperPx = Math.min(upperPx, Number(maxPrimary));
    }
    if (Number.isFinite(Number(maxSecondary)) && Number(maxSecondary) >= 0) {
      lowerPx = Math.max(lowerPx, total - Number(maxSecondary));
    }

    if (upperPx < lowerPx) {
      const mid = total / 2;
      lowerPx = Math.min(lowerPx, mid);
      upperPx = Math.max(upperPx, mid);
    }

    const proposedPx = safeRatio(proposedRatio, defaultRatio) * total;
    const nextPx = clamp(proposedPx, lowerPx, upperPx);
    return clamp(nextPx / total, 0.05, 0.95);
  }, [defaultRatio, direction, maxPrimary, maxSecondary, minPrimary, minSecondary]);

  const formatSummary = useCallback((nextRatio) => {
    const first = Math.round(clamp(nextRatio, 0, 1) * 100);
    const second = clamp(100 - first, 0, 100);
    return `${primaryLabel}: ${first}% | ${secondaryLabel}: ${second}%`;
  }, [primaryLabel, secondaryLabel]);

  useEffect(() => {
    ratioRef.current = internalRatio;
  }, [internalRatio]);

  useEffect(() => {
    if (isDragging) return;
    const next = resolveRatio(safeRatio(ratio, defaultRatio));
    if (Math.abs(next - ratioRef.current) > 0.0005) {
      ratioRef.current = next;
      setInternalRatio(next);
    }
  }, [defaultRatio, isDragging, ratio, resolveRatio]);

  useEffect(() => {
    if (!persistKey) return;
    if (persistedKeyRef.current === persistKey) return;
    persistedKeyRef.current = persistKey;
    const persistedRatio = readPersistedRatio(persistKey);
    if (persistedRatio == null) return;
    const next = resolveRatio(persistedRatio);
    if (!Number.isFinite(next)) return;
    ratioRef.current = next;
    setInternalRatio(next);
    onRatioChange?.(next);
  }, [onRatioChange, persistKey, resolveRatio]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      const clamped = resolveRatio(ratioRef.current);
      if (Math.abs(clamped - ratioRef.current) > 0.0005) {
        ratioRef.current = clamped;
        setInternalRatio(clamped);
        onRatioChange?.(clamped);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [onRatioChange, resolveRatio]);

  useEffect(() => {
    if (!isDragging) return undefined;
    document.body.classList.add(DRAG_CLASS);
    document.body.classList.add(direction === 'horizontal' ? DRAG_CLASS_HORIZONTAL : DRAG_CLASS_VERTICAL);
    document.body.classList.add(LEGACY_DRAG_CLASS);
    toggleIframePointerEvents(true);
    return () => {
      document.body.classList.remove(DRAG_CLASS);
      document.body.classList.remove(DRAG_CLASS_HORIZONTAL);
      document.body.classList.remove(DRAG_CLASS_VERTICAL);
      document.body.classList.remove(LEGACY_DRAG_CLASS);
      toggleIframePointerEvents(false);
    };
  }, [direction, isDragging]);

  const removeWindowListeners = useCallback((dragState = null) => {
    const listeners = dragState || dragStateRef.current;
    if (!listeners) return;
    window.removeEventListener('pointermove', listeners.moveHandler);
    window.removeEventListener('pointerup', listeners.upHandler);
    window.removeEventListener('pointercancel', listeners.cancelHandler);
  }, []);

  const finalizeDrag = useCallback((pointerId = null) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    if (pointerId != null && dragState.pointerId !== pointerId) return;

    if (dividerRef.current && dragState.pointerCaptured) {
      try {
        dividerRef.current.releasePointerCapture(dragState.pointerId);
      } catch {
        // ignore release failures
      }
    }

    pendingPointRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    removeWindowListeners(dragState);
    dragStateRef.current = null;
    setIsDragging(false);
    setDragSummary('');
    persistRatio(persistKey, ratioRef.current);
  }, [persistKey, removeWindowListeners]);

  const applyDragUpdate = useCallback(() => {
    rafRef.current = 0;
    const dragState = dragStateRef.current;
    const pointer = pendingPointRef.current;
    if (!dragState || !pointer) return;

    const delta = pointFromPosition(pointer, direction) - dragState.startPoint;
    const nextRatio = resolveRatio((dragState.startRatio * dragState.total + delta) / dragState.total);

    if (!Number.isFinite(nextRatio)) {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[SplitPane] Invalid ratio computed during drag update', {
          persistKey,
          direction,
          nextRatio,
        });
      }
      return;
    }

    ratioRef.current = nextRatio;
    setInternalRatio(nextRatio);
    setDragSummary(formatSummary(nextRatio));
    onRatioChange?.(nextRatio);
  }, [direction, formatSummary, onRatioChange, persistKey, resolveRatio]);

  const scheduleDragUpdate = useCallback((event) => {
    pendingPointRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(applyDragUpdate);
  }, [applyDragUpdate]);

  useEffect(() => {
    return () => {
      removeWindowListeners();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingPointRef.current = null;
      dragStateRef.current = null;
      toggleIframePointerEvents(false);
      document.body.classList.remove(DRAG_CLASS);
      document.body.classList.remove(DRAG_CLASS_HORIZONTAL);
      document.body.classList.remove(DRAG_CLASS_VERTICAL);
      document.body.classList.remove(LEGACY_DRAG_CLASS);
    };
  }, [removeWindowListeners]);

  if (panes.length <= 1) {
    return <div className={`split-pane split-pane-single ${className}`}>{panes[0] || null}</div>;
  }

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    if (!containerRef.current || !dividerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const total = containerSize(rect, direction);
    if (!Number.isFinite(total) || total <= 0) return;

    const startPoint = direction === 'horizontal' ? event.clientY : event.clientX;
    const startRatio = resolveRatio(ratioRef.current);
    ratioRef.current = startRatio;
    const moveHandler = (moveEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== moveEvent.pointerId) return;
      moveEvent.preventDefault();
      scheduleDragUpdate(moveEvent);
    };
    const upHandler = (upEvent) => {
      finalizeDrag(upEvent.pointerId);
    };
    const cancelHandler = (cancelEvent) => {
      finalizeDrag(cancelEvent.pointerId);
    };

    dragStateRef.current = {
      total,
      startPoint,
      startRatio,
      pointerId: event.pointerId,
      pointerCaptured: false,
      moveHandler,
      upHandler,
      cancelHandler,
    };
    setDragSummary(formatSummary(startRatio));

    try {
      dividerRef.current.setPointerCapture(event.pointerId);
      dragStateRef.current.pointerCaptured = true;
    } catch (error) {
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[SplitPane] setPointerCapture failed, using window listeners only.', {
          persistKey,
          direction,
          message: error?.message || String(error),
        });
      }
    }

    setIsDragging(true);
    window.addEventListener('pointermove', moveHandler);
    window.addEventListener('pointerup', upHandler);
    window.addEventListener('pointercancel', cancelHandler);
    event.preventDefault();
  };

  const handleDoubleClick = () => {
    const nextRatio = resolveRatio(defaultRatio);
    ratioRef.current = nextRatio;
    setInternalRatio(nextRatio);
    onRatioChange?.(nextRatio);
    persistRatio(persistKey, nextRatio);
  };

  const styleA =
    direction === 'horizontal'
      ? { flexBasis: `${internalRatio * 100}%`, minHeight: 0 }
      : { flexBasis: `${internalRatio * 100}%`, minWidth: 0 };
  const styleB = direction === 'horizontal' ? { minHeight: 0 } : { minWidth: 0 };

  return (
    <div
      ref={containerRef}
      className={`split-pane split-pane-${direction} ${isDragging ? 'dragging' : ''} ${className}`}
    >
      <div className="split-pane-region split-pane-primary" style={styleA}>
        {panes[0]}
      </div>
      <div
        ref={dividerRef}
        className="split-pane-divider"
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'horizontal' : 'vertical'}
        title="Drag to resize. Double-click to reset."
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
      >
        <span className="split-pane-divider-grip" />
        {isDragging && dragSummary ? (
          <span className="split-pane-divider-tooltip">{dragSummary}</span>
        ) : null}
      </div>
      <div className="split-pane-region split-pane-secondary" style={styleB}>
        {panes[1]}
      </div>
    </div>
  );
}
