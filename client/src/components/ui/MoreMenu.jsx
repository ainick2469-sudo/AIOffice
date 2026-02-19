import { useEffect, useRef, useState } from 'react';

export default function MoreMenu({
  label = 'More actions',
  triggerTooltip = '',
  align = 'right',
  className = '',
  children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onEscape = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`more-menu ${className}`.trim()}>
      <button
        type="button"
        className={`ui-btn more-menu-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={label}
        data-tooltip={triggerTooltip || undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        ⋯
      </button>
      {open ? (
        <div className={`more-menu-popover ${align === 'left' ? 'align-left' : 'align-right'}`} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}
