// Feldweiser Diff einer Operation. Zeigt nur, was sich wirklich aendert –
// alles andere ist Rauschen im Review.
import type { Op } from '@/api/types';

const MEMBER_KEYS: Record<string, string> = {
  'allowed-vlans': 'vlan-name',
  'untagged-vlans': 'vlan-name',
  'interface-tags': 'tag-name',
};

function render(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) {
    const key = MEMBER_KEYS[field];
    const names = v.map((e) => (typeof e === 'string' ? e : key ? (e as Record<string, string>)?.[key] : JSON.stringify(e)));
    return names.filter(Boolean).join(', ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

interface Row {
  field: string;
  from: string;
  to: string;
}

export function diffRows(op: Op): Row[] {
  const before = op.before ?? {};
  const after = op.after ?? {};

  if (op.kind === 'move') {
    return [{ field: 'position', from: '', to: `${op.move?.position ?? 'after'} "${op.move?.ref ?? ''}"` }];
  }

  if (op.kind === 'create') {
    return Object.keys(after)
      .map((k) => ({ field: k, from: '', to: render(k, after[k]) }))
      .filter((r) => r.to !== '');
  }

  if (op.kind === 'delete') {
    return Object.keys(before)
      .map((k) => ({ field: k, from: render(k, before[k]), to: '' }))
      .filter((r) => r.from !== '');
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: Row[] = [];
  for (const k of keys) {
    const from = render(k, before[k]);
    const to = render(k, after[k]);
    if (from !== to) rows.push({ field: k, from, to });
  }
  return rows;
}

export function DiffView({ op, max = 12 }: { op: Op; max?: number }) {
  const rows = diffRows(op);
  if (!rows.length) return <div className="xs dim">No field changes.</div>;

  const shown = rows.slice(0, max);
  const rest = rows.length - shown.length;

  return (
    <>
      <dl className="diff">
        {shown.map((r) => (
          <div key={r.field} style={{ display: 'contents' }}>
            <dt>{r.field}</dt>
            <dd>
              {r.from && <span className="from">{r.from}</span>}
              {r.from && r.to && <span className="arrow">→</span>}
              {r.to && <span className="to">{r.to}</span>}
              {!r.to && !r.from && <span className="dim">—</span>}
              {r.from && !r.to && <span className="arrow">→ unset</span>}
            </dd>
          </div>
        ))}
      </dl>
      {rest > 0 && <div className="xs dim" style={{ marginTop: 3 }}>+ {rest} more field{rest === 1 ? '' : 's'}</div>}
    </>
  );
}
