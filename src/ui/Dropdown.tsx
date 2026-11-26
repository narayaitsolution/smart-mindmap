import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** Renders a menu of menuitems. Otherwise the panel is a plain group. */
  menu?: boolean;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}

/** Header dropdown. Escape or a click outside closes it and returns focus to the trigger. */
export function Dropdown({ label, icon, disabled, menu = true, align = 'right', children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => setOpen(false);

  return (
    <div className="dropdown" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        aria-haspopup={menu ? 'menu' : 'true'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ?? label}
      </button>
      {open && (
        <div
          id={panelId}
          className={`dropdown-panel ${align}`}
          role={menu ? 'menu' : 'group'}
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
