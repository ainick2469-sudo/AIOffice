import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

function normalizeRatios(ratios, expectedLen) {
  if (!Array.isArray(ratios) || ratios.length !== expectedLen) {
    return Array.from({ length: expectedLen }, () => 1 / expectedLen);
  }
  const parsed = ratios.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  if (parsed.length !== expectedLen) {
    return Array.from({ length: expectedLen }, () => 1 / expectedLen);
  }
  const total = parsed.reduce((acc, value) => acc + value, 0);
  if (total <= 0) {
    return Array.from({ length: expectedLen }, () => 1 / expectedLen);
  }
  return parsed.map((value) => value / total);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFinitePositive(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function PaneSplit({
  children,
  ratios,
  minRatio = 0.2,
  minSizesPx = null,
  gutterPx = 10,
  className = '',
  onCommit,
}) {
  const panes = useMemo(() => {
    const list = Array.isArray(children) ? children : [children];
    return list.filter(Boolean);
  }, [children]);
  const expectedLen = panes.length;
  const initialRatios = useMemo(() => normalizeRatios(ratios, expectedLen), [ratios, expectedLen]);

  const [liveRatios, setLiveRatios] = useState(initialRatios);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);
  const liveRef = useRef(initialRatios);
  const dragRef = useRef(null);
  const displayRatios = isDragging ? liveRatios : initialRatios;

  useEffect(() => {
    if (!dragRef.current) return undefined;

    const onPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { index, startX, startWidths, availableWidth } = drag;
      if (!availableWidth) return;

      const delta = event.clientX - startX;
      const leftBase = startWidths[index];
      const rightBase = startWidths[index + 1];
      const pairTotal = leftBase + rightBase;

      const fallbackMin = Math.max(48, availableWidth * minRatio);
      const leftMinRequest = Array.isArray(minSizesPx) ? toFinitePositive(minSizesPx[index]) : null;
      const rightMinRequest = Array.isArray(minSizesPx) ? toFinitePositive(minSizesPx[index + 1]) : null;

      let leftMin = leftMinRequest || fallbackMin;
      let rightMin = rightMinRequest || fallbackMin;

      if (leftMin + rightMin > pairTotal) {
        const scale = pairTotal / (leftMin + rightMin);
        leftMin *= scale;
        rightMin *= scale;
      }

      const nextLeft = clamp(leftBase + delta, leftMin, pairTotal - rightMin);
      const nextRight = pairTotal - nextLeft;

      const nextWidths = [...startWidths];
      nextWidths[index] = nextLeft;
      nextWidths[index + 1] = nextRight;

      const normalized = normalizeRatios(
        nextWidths.map((width) => width / availableWidth),
        nextWidths.length
      );
      liveRef.current = normalized;
      setLiveRatios(normalized);
    };

    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setIsDragging(false);
      onCommit?.(liveRef.current);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [gutterPx, minRatio, minSizesPx, onCommit]);

  const beginDrag = (index, event) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const availableWidth = rect.width - gutterPx * (expectedLen - 1);
    if (!rect.width || availableWidth <= 0) return;
    const startRatios = normalizeRatios(displayRatios, expectedLen);
    const startWidths = startRatios.map((ratio) => ratio * availableWidth);
    liveRef.current = startRatios;
    setLiveRatios(startRatios);
    dragRef.current = {
      index,
      startX: event.clientX,
      startWidths,
      availableWidth,
    };
    setIsDragging(true);
    event.preventDefault();
  };

  if (panes.length <= 1) {
    return <div className={`pane-split ${className}`}>{panes[0]}</div>;
  }

  return (
    <div ref={containerRef} className={`pane-split ${className} ${isDragging ? 'dragging' : ''}`}>
      {panes.map((pane, index) => (
        <Fragment key={`pane-${index}`}>
          <div className="pane-split-pane" style={{ flexBasis: `${(displayRatios[index] || 0) * 100}%` }}>
            {pane}
          </div>
          {index < panes.length - 1 && (
            <div
              className="pane-split-gutter"
              role="separator"
              aria-orientation="vertical"
              onPointerDown={(event) => beginDrag(index, event)}
              style={{ width: `${gutterPx}px`, flexBasis: `${gutterPx}px` }}
              title="Drag to resize panes"
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
