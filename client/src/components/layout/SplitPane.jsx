import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

function deltaFromEvent(event, direction, startPoint) {
  const current = direction === 'horizontal' ? event.clientY : event.clientX;
  return current - startPoint;
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
}) {
  const panes = useMemo(() => {
    const list = Array.isArray(children) ? children : [children];
    return list.filter(Boolean).slice(0, 2);
  }, [children]);

  const containerRef = useRef(null);
  const dividerRef = useRef(null);
  const dragStateRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [internalRatio, setInternalRatio] = useState(safeRatio(ratio, defaultRatio));

  useEffect(() => {
    setInternalRatio(safeRatio(ratio, defaultRatio));
  }, [ratio, defaultRatio]);

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

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const observer = new ResizeObserver(() => {
      const clamped = resolveRatio(internalRatio);
      if (Math.abs(clamped - internalRatio) > 0.0005) {
        setInternalRatio(clamped);
        onRatioChange?.(clamped);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [internalRatio, onRatioChange, resolveRatio]);

  useEffect(() => {
    if (!isDragging) return undefined;
    document.body.classList.add('splitpane-dragging');
    document.body.classList.add(direction === 'horizontal' ? 'splitpane-dragging-horizontal' : 'splitpane-dragging-vertical');
    return () => {
      document.body.classList.remove('splitpane-dragging');
      document.body.classList.remove('splitpane-dragging-horizontal');
      document.body.classList.remove('splitpane-dragging-vertical');
    };
  }, [direction, isDragging]);

  if (panes.length <= 1) {
    return <div className={`split-pane split-pane-single ${className}`}>{panes[0] || null}</div>;
  }

  const handlePointerDown = (event) => {
    if (!containerRef.current || !dividerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const total = containerSize(rect, direction);
    if (!Number.isFinite(total) || total <= 0) return;

    const startPoint = direction === 'horizontal' ? event.clientY : event.clientX;
    dragStateRef.current = {
      total,
      startPoint,
      startRatio: internalRatio,
      pointerId: event.pointerId,
    };
    dividerRef.current.setPointerCapture(event.pointerId);
    setIsDragging(true);
    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const delta = deltaFromEvent(event, direction, drag.startPoint);
    const nextRatio = resolveRatio((drag.startRatio * drag.total + delta) / drag.total);
    setInternalRatio(nextRatio);
    onRatioChange?.(nextRatio);
  };

  const endPointerDrag = () => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handlePointerUp = () => {
    endPointerDrag();
  };

  const handlePointerCancel = () => {
    endPointerDrag();
  };

  const handleDoubleClick = () => {
    const nextRatio = resolveRatio(defaultRatio);
    setInternalRatio(nextRatio);
    onRatioChange?.(nextRatio);
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
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
      >
        <span className="split-pane-divider-grip" />
      </div>
      <div className="split-pane-region split-pane-secondary" style={styleB}>
        {panes[1]}
      </div>
    </div>
  );
}
