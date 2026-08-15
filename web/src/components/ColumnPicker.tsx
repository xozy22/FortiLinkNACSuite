// ---------------------------------------------------------------------------
// Spaltenwaehler fuer das Inventar.
//
// Welche Felder user/device/query liefert, haengt an der Firmware. Das Backend
// ermittelt sie aus der Antwort, statt eine Liste fest zu verdrahten – hier
// werden sie auswaehlbar. Die Auswahl bleibt lokal gespeichert.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { Check, Columns3, RotateCcw } from 'lucide-react';

export interface ExtraField {
  key: string;
  kind: string;
  count: number;
  sample: unknown;
}

const STORAGE_KEY = 'flns-asset-columns';

export function loadColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveColumns(keys: string[]) {
  try {
    if (keys.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nicht schlimm – die Auswahl gilt dann nur fuer diese Sitzung */
  }
}

/** Felder, die bereits als feste Spalte in der Tabelle stehen. */
const ALREADY_SHOWN = new Set([
  'mac',
  'master_mac',
  'hostname',
  'ipv4_address',
  'hardware_vendor',
  'hardware_type',
  'hardware_family',
  'os_name',
  'os_version',
  'is_online',
  'last_seen',
]);

export function ColumnPicker({
  fields,
  selected,
  onChange,
}: {
  fields: ExtraField[];
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const available = fields.filter((f) => !ALREADY_SHOWN.has(f.key) && f.kind !== 'object' && f.kind !== 'array');

  function toggle(key: string) {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    onChange(next);
    saveColumns(next);
  }

  return (
    <div className="facet" ref={wrap}>
      <button className={`facet-btn ${selected.length ? 'active' : ''}`} onClick={() => setOpen((o) => !o)}>
        <Columns3 size={12} /> Columns
        {selected.length > 0 && <span className="n">{selected.length}</span>}
      </button>

      {open && (
        <div className="facet-pop" style={{ right: 0, left: 'auto', minWidth: 280 }}>
          <div className="xs dim" style={{ padding: '2px 7px 6px' }}>
            Fields this FortiOS actually returns for your devices.
          </div>
          {available.length === 0 && <div className="xs dim" style={{ padding: 7 }}>No additional fields available.</div>}
          {available.map((f) => {
            const on = selected.includes(f.key);
            return (
              <div className="facet-opt" key={f.key} onClick={() => toggle(f.key)}>
                <span style={{ width: 13, flex: 'none' }}>{on && <Check size={12} style={{ color: 'var(--accent-bright)' }} />}</span>
                <span className="mono xs truncate" title={f.sample !== null ? `e.g. ${String(f.sample)}` : undefined}>
                  {f.key}
                </span>
                <span className="n">{f.count}</span>
              </div>
            );
          })}
          {selected.length > 0 && (
            <button
              className="btn ghost sm"
              style={{ width: '100%', marginTop: 5 }}
              onClick={() => {
                onChange([]);
                saveColumns([]);
              }}
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Wert eines Zusatzfelds anzeigbar machen. */
export function renderExtra(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
