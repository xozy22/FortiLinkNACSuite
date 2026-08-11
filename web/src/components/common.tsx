import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Inbox, Loader2, XCircle } from 'lucide-react';
import type { Coverage } from '@/api/types';

// --- Hinweisbox ------------------------------------------------------------

export function Note({
  kind = 'info',
  children,
  className = '',
}: {
  kind?: 'info' | 'warn' | 'err' | 'ok';
  children: ReactNode;
  className?: string;
}) {
  const Icon = kind === 'warn' ? AlertTriangle : kind === 'err' ? XCircle : kind === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={`note ${kind} ${className}`}>
      <Icon size={15} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// --- Lade- und Leerzustaende -----------------------------------------------

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty">
      <Loader2 size={20} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox size={26} />
      <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{title}</div>
      {hint && <div className="xs" style={{ maxWidth: '46ch' }}>{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error as { message?: string; hint?: string | null };
  return (
    <Note kind="err">
      <strong>{e?.message ?? 'Something went wrong'}</strong>
      {e?.hint && <div className="xs" style={{ marginTop: 4 }}>{e.hint}</div>}
    </Note>
  );
}

// --- Statusdarstellungen ---------------------------------------------------

const COVERAGE_META: Record<Coverage, { label: string; cls: string; hint: string }> = {
  matched: { label: 'Matched', cls: 'green', hint: 'A dynamic port policy rule applies to this device.' },
  'no-rule': { label: 'No rule', cls: 'amber', hint: 'The port runs NAC, but no rule matches this device.' },
  'port-static': {
    label: 'Port static',
    cls: 'red',
    hint: 'The switch port is not in dynamic access mode, so no policy can apply here.',
  },
  'off-switch': { label: 'Off switch', cls: 'gray', hint: 'Not seen on a FortiLink-managed switch port.' },
};

export function CoverageBadge({ value }: { value: Coverage }) {
  const m = COVERAGE_META[value] ?? COVERAGE_META['off-switch'];
  return (
    <span className={`badge ${m.cls}`} title={m.hint}>
      {m.label}
    </span>
  );
}

export function coverageLabel(value: Coverage) {
  return COVERAGE_META[value]?.label ?? value;
}

export function OnlineDot({ online }: { online: boolean }) {
  return <span className={`dot ${online ? 'on' : 'off'}`} title={online ? 'Online' : 'Offline'} />;
}

export function Pill({ children, tone = 'gray', title }: { children: ReactNode; tone?: string; title?: string }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

/** Anzeige fuer leere Werte – ein Gedankenstrich statt einer leeren Zelle. */
export function Val({ children }: { children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return empty ? <span className="dim">—</span> : <>{children}</>;
}

// --- Modal -----------------------------------------------------------------

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'default',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'narrow' | 'default' | 'wide';
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size === 'default' ? '' : size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="xs dim">{subtitle}</div>}
          </div>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <XCircle size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// --- Kennzahl --------------------------------------------------------------

export function Stat({
  label,
  value,
  unit,
  note,
  meter,
  icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  meter?: { pct: number; tone?: 'ok' | 'warn' | 'crit' };
  icon?: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="unit"> {unit}</span>}
      </div>
      {meter && (
        <div className={`meter ${meter.tone === 'crit' ? 'crit' : meter.tone === 'warn' ? 'warn' : ''}`}>
          <i style={{ width: `${Math.min(100, Math.max(0, meter.pct))}%` }} />
        </div>
      )}
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
