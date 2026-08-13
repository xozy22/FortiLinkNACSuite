// ---------------------------------------------------------------------------
// Hover-Karte fuer Detailinformationen an Ort und Stelle.
//
// Bewusst ueber ein Portal an <body>: Die Tabellen liegen in Containern mit
// overflow:auto, eine absolut positionierte Karte wuerde dort abgeschnitten.
// Getriggert wird per Maus und per Tastaturfokus, damit die Information nicht
// nur mit Zeigegeraet erreichbar ist.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const OPEN_DELAY = 110;
const CLOSE_DELAY = 160;
const GAP = 10;
const MARGIN = 12;

export function HoverCard({
  children,
  content,
  width = 400,
  label,
}: {
  /** Das ausloesende Element. */
  children: ReactNode;
  content: ReactNode;
  width?: number;
  /** Beschreibung fuer Screenreader, z.B. "Show connected devices". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const id = useId();

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };

  const show = useCallback((immediate = false) => {
    clearTimers();
    if (immediate) setOpen(true);
    else openTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  }, []);

  const hide = useCallback((immediate = false) => {
    clearTimers();
    if (immediate) setOpen(false);
    else closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  }, []);

  useEffect(() => () => clearTimers(), []);

  // Position erst nach dem Rendern bestimmen – vorher ist die Hoehe unbekannt.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const h = cardRef.current?.offsetHeight ?? 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = r.right + GAP;
    if (left + width > vw - MARGIN) left = r.left - width - GAP; // links daneben
    if (left < MARGIN) left = Math.min(Math.max(MARGIN, r.left), vw - width - MARGIN);

    let top = r.top - 6;
    if (top + h > vh - MARGIN) top = vh - h - MARGIN;
    if (top < MARGIN) top = MARGIN;

    setPos({ top, left });
  }, [open, width]);

  // Beim Scrollen schliessen – eine mitwandernde Karte ist irritierender als keine.
  useEffect(() => {
    if (!open) return;
    const close = () => hide(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide(true);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="hovercard-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => show()}
        onMouseLeave={() => hide()}
        onFocus={() => show(true)}
        onBlur={() => hide(true)}
        onClick={() => (open ? hide(true) : show(true))}
      >
        {children}
      </button>

      {open &&
        createPortal(
          <div
            id={id}
            ref={cardRef}
            role="tooltip"
            className="hovercard"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
            onMouseEnter={() => show(true)}
            onMouseLeave={() => hide()}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
