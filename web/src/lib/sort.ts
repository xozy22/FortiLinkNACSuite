// Sortierung fuer die Tabellen. Typgerecht: Zahlen numerisch, Text lokalisiert,
// leere Werte immer ans Ende – sonst stehen die uninteressanten Zeilen oben.
import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string | null;
  dir: SortDir;
}

export type SortValue = string | number | boolean | null | undefined;

function compare(a: SortValue, b: SortValue): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // Leeres ans Ende, unabhaengig von der Richtung
  if (bEmpty) return -1;

  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(b) - Number(a);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * @param rows       die Zeilen
 * @param accessors  Spaltenschluessel -> Wert der Zeile
 * @param initial    Startsortierung
 */
export function useSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
  initial: SortState = { key: null, dir: 'asc' }
) {
  const [sort, setSort] = useState<SortState>(initial);

  const toggle = useCallback((key: string) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' }; // dritter Klick: zurueck zur Grundordnung
    });
  }, []);

  const sorted = useMemo(() => {
    const get = sort.key ? accessors[sort.key] : null;
    if (!get) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    // Index als Stabilitaetsanker – Array.sort ist zwar stabil, aber die
    // Leer-Regel oben soll die Richtung nicht mitdrehen.
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => compare(get(x.row), get(y.row)) * factor || x.i - y.i)
      .map((e) => e.row);
  }, [rows, sort, accessors]);

  return { sorted, sort, toggle };
}

/** Klassen und Pfeil fuer einen sortierbaren Spaltenkopf. */
export function sortIndicator(sort: SortState, key: string) {
  if (sort.key !== key) return '';
  return sort.dir === 'asc' ? ' ↑' : ' ↓';
}
