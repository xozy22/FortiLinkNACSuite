// Facetten-Filter. Baut die Auswahlmoeglichkeiten aus den Daten selbst –
// so passt sich die Leiste an das an, was auf der jeweiligen Anlage vorkommt.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface FacetDef<Tv> {
  key: string;
  label: string;
  value: (row: Tv) => string;
  /** Anzeigename, falls der Rohwert leer oder technisch ist. */
  display?: (v: string) => string;
}

export interface FilterState {
  q: string;
  selected: Record<string, string[]>;
}

export const emptyFilter: FilterState = { q: '', selected: {} };

export function applyFilter<Tv>(rows: Tv[], state: FilterState, facets: FacetDef<Tv>[], search: (row: Tv) => string) {
  const q = state.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !search(r).toLowerCase().includes(q)) return false;
    for (const f of facets) {
      const sel = state.selected[f.key];
      if (!sel?.length) continue;
      if (!sel.includes(f.value(r))) return false;
    }
    return true;
  });
}

/** Zaehlt Auspraegungen – jeweils unter Beruecksichtigung der anderen Facetten. */
function counts<Tv>(rows: Tv[], state: FilterState, facets: FacetDef<Tv>[], target: FacetDef<Tv>, search: (r: Tv) => string) {
  const others = { ...state, selected: { ...state.selected, [target.key]: [] } };
  const base = applyFilter(rows, others, facets, search);
  const map = new Map<string, number>();
  for (const r of base) {
    const v = target.value(r);
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function FilterBar<Tv>({
  rows,
  facets,
  state,
  onChange,
  search,
  placeholder = 'Search…',
  right,
}: {
  rows: Tv[];
  facets: FacetDef<Tv>[];
  state: FilterState;
  onChange: (s: FilterState) => void;
  search: (row: Tv) => string;
  placeholder?: string;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = Object.values(state.selected).some((v) => v?.length);

  function toggle(facetKey: string, value: string) {
    const cur = state.selected[facetKey] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    onChange({ ...state, selected: { ...state.selected, [facetKey]: next } });
  }

  return (
    <div className="toolbar" ref={wrap}>
      <div className="search">
        <Search size={13} />
        <input
          className="input"
          value={state.q}
          onChange={(e) => onChange({ ...state, q: e.target.value })}
          placeholder={placeholder}
          spellCheck={false}
        />
      </div>

      {facets.map((f) => {
        const sel = state.selected[f.key] ?? [];
        return (
          <div className="facet" key={f.key}>
            <button className={`facet-btn ${sel.length ? 'active' : ''}`} onClick={() => setOpen(open === f.key ? null : f.key)}>
              {f.label}
              {sel.length > 0 && <span className="n">{sel.length}</span>}
              <ChevronDown size={11} />
            </button>
            {open === f.key && (
              <FacetPopup rows={rows} state={state} facets={facets} target={f} search={search} sel={sel} onToggle={(v) => toggle(f.key, v)} onClear={() => onChange({ ...state, selected: { ...state.selected, [f.key]: [] } })} />
            )}
          </div>
        );
      })}

      {active && (
        <button className="btn ghost sm" onClick={() => onChange({ ...state, selected: {} })}>
          <X size={12} /> Clear filters
        </button>
      )}

      <div className="spacer" />
      {right}
    </div>
  );
}

function FacetPopup<Tv>({
  rows,
  state,
  facets,
  target,
  search,
  sel,
  onToggle,
  onClear,
}: {
  rows: Tv[];
  state: FilterState;
  facets: FacetDef<Tv>[];
  target: FacetDef<Tv>;
  search: (r: Tv) => string;
  sel: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const list = useMemo(() => counts(rows, state, facets, target, search), [rows, state, facets, target, search]);

  return (
    <div className="facet-pop">
      {sel.length > 0 && (
        <button className="btn ghost sm" style={{ width: '100%', marginBottom: 4 }} onClick={onClear}>
          <X size={11} /> Clear
        </button>
      )}
      {list.length === 0 && <div className="xs dim" style={{ padding: 6 }}>No values</div>}
      {list.map(([v, n]) => {
        const on = sel.includes(v);
        return (
          <div className="facet-opt" key={v || '∅'} onClick={() => onToggle(v)}>
            <span style={{ width: 13, flex: 'none' }}>{on && <Check size={12} style={{ color: 'var(--accent-bright)' }} />}</span>
            <span className="truncate">{target.display ? target.display(v) : v || <span className="dim">(empty)</span>}</span>
            <span className="n">{n}</span>
          </div>
        );
      })}
    </div>
  );
}
