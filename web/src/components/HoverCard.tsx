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

  /** Karte am Ausloeser ausrichten. */
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = cardRef.current?.offsetHeight ?? 240;

    let left = r.right + GAP;
    if (left + width > vw - MARGIN) left = r.left - width - GAP; // links daneben
    if (left < MARGIN) left = Math.min(Math.max(MARGIN, r.left), vw - width - MARGIN);

    let top = r.top - 6;
    if (top + h > vh - MARGIN) top = vh - h - MARGIN;
    if (top < MARGIN) top = MARGIN;

    setPos({ top, left });
  }, [width]);

  // Position erst nach dem Rendern bestimmen – vorher ist die Hoehe unbekannt.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Ist der Ausloeser nicht mehr sichtbar – aus dem Viewport oder von einem
  // scrollenden Container abgeschnitten – schliessen. Eine Karte ohne sichtbaren
  // Bezugspunkt zeigt auf nichts. Der Observer beruecksichtigt beide Faelle,
  // eine reine Viewport-Pruefung wuerde das Wegscrollen in der Tabelle uebersehen.
  useEffect(() => {
    const t = triggerRef.current;
    if (!open || !t) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) hide(true);
      },
      { threshold: 0 }
    );
    io.observe(t);
    return () => io.disconnect();
  }, [open, hide]);

  useEffect(() => {
    if (!open) return;

    // Scrollen INNERHALB der Karte darf sie nicht schliessen – sonst laesst sich
    // eine lange Liste nicht lesen. Nur Scrollen dahinter richtet sie neu aus.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && cardRef.current?.contains(target)) return;
      place();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide(true);
    };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, hide, place]);

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
        // Hat der Ausloeser den Tastaturfokus, darf ein abwanderndes Mauszeigern
        // die Karte nicht wegnehmen – geschlossen wird dann per Blur oder Escape.
        onMouseLeave={() => {
          if (document.activeElement !== triggerRef.current) hide();
        }}
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
