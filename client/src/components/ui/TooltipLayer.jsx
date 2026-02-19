import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const TOOLTIP_ID = 'ai-office-delayed-tooltip';
const TOOLTIP_DELAY_MS = 1400;
const VIEWPORT_MARGIN = 10;
const GAP = 10;

function findTooltipTarget(node) {
  if (!node || typeof node.closest !== 'function') return null;
  return node.closest('[data-tooltip]');
}

export default function TooltipLayer({ dismissToken = '' }) {
  const [tooltip, setTooltip] = useState({
    open: false,
    text: '',
    left: 0,
    top: 0,
    placement: 'bottom',
  });
  const timerRef = useRef(null);
  const targetRef = useRef(null);
  const hoveredRef = useRef(null);
  const tooltipRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearAria = useCallback(() => {
    const currentTarget = targetRef.current;
    if (!currentTarget) return;
    if (currentTarget.getAttribute('aria-describedby') === TOOLTIP_ID) {
      currentTarget.removeAttribute('aria-describedby');
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimer();
    hoveredRef.current = null;
    clearAria();
    targetRef.current = null;
    setTooltip((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, [clearAria, clearTimer]);

  const showTooltip = useCallback((target) => {
    const text = String(target?.getAttribute('data-tooltip') || '').trim();
    if (!text) return;
    targetRef.current = target;
    target.setAttribute('aria-describedby', TOOLTIP_ID);
    const rect = target.getBoundingClientRect();
    setTooltip({
      open: true,
      text,
      left: rect.left + (rect.width / 2),
      top: rect.bottom + GAP,
      placement: 'bottom',
    });
  }, []);

  const startTooltipTimer = useCallback((target) => {
    clearTimer();
    hoveredRef.current = target;
    timerRef.current = window.setTimeout(() => {
      if (hoveredRef.current === target) {
        showTooltip(target);
      }
    }, TOOLTIP_DELAY_MS);
  }, [clearTimer, showTooltip]);

  useLayoutEffect(() => {
    if (!tooltip.open) return;
    const target = targetRef.current;
    const node = tooltipRef.current;
    if (!target || !node) return;

    const targetRect = target.getBoundingClientRect();
    const tipRect = node.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const centeredLeft = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, centeredLeft),
      viewportWidth - tipRect.width - VIEWPORT_MARGIN
    );

    let top = targetRect.bottom + GAP;
    let placement = 'bottom';
    if (top + tipRect.height + VIEWPORT_MARGIN > viewportHeight) {
      top = targetRect.top - tipRect.height - GAP;
      placement = 'top';
    }
    if (top < VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, targetRect.bottom + GAP);
      placement = 'bottom';
    }

    setTooltip((prev) => (
      prev.left === left && prev.top === top && prev.placement === placement
        ? prev
        : { ...prev, left, top, placement }
    ));
  }, [tooltip.open, tooltip.text, dismissToken]);

  useEffect(() => {
    const onMouseOver = (event) => {
      const target = findTooltipTarget(event.target);
      if (!target) return;
      if (target === hoveredRef.current) return;
      hideTooltip();
      startTooltipTimer(target);
    };

    const onMouseOut = (event) => {
      const current = hoveredRef.current;
      if (!current) return;
      const related = event.relatedTarget;
      const relatedTarget = findTooltipTarget(related);
      if (relatedTarget === current) return;
      hideTooltip();
    };

    const onFocusIn = (event) => {
      const target = findTooltipTarget(event.target);
      if (!target) return;
      hideTooltip();
      startTooltipTimer(target);
    };

    const onFocusOut = () => {
      hideTooltip();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') hideTooltip();
    };

    const dismiss = () => hideTooltip();

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', dismiss);
    window.addEventListener('workspace:view-changed', dismiss);
    window.addEventListener('workspace:mode-changed', dismiss);
    window.addEventListener('ai-office:escape', dismiss);

    return () => {
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', dismiss);
      window.removeEventListener('workspace:view-changed', dismiss);
      window.removeEventListener('workspace:mode-changed', dismiss);
      window.removeEventListener('ai-office:escape', dismiss);
    };
  }, [hideTooltip, startTooltipTimer]);

  useEffect(() => {
    hideTooltip();
  }, [dismissToken, hideTooltip]);

  return (
    <div
      ref={tooltipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      className={`app-tooltip-layer ${tooltip.open ? 'visible' : ''} ${tooltip.placement}`}
      style={{
        left: `${Math.round(tooltip.left)}px`,
        top: `${Math.round(tooltip.top)}px`,
      }}
      aria-hidden={tooltip.open ? 'false' : 'true'}
    >
      {tooltip.text}
    </div>
  );
}
