// ---------------------------------------------------------------------------
// Changeset-Kontext.
//
// Jede Schreibabsicht der UI landet hier als Operation. Nichts geht direkt an
// die FortiGate. Der Drawer zeigt den Bestand, validiert ihn und wendet ihn an.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Op } from '@/api/types';

// Der Changeset ist Arbeit, die noch nicht auf der FortiGate steht. Ein
// versehentliches F5 darf sie nicht wegwerfen. Gespeichert wird je Verbindung,
// damit ein Wechsel des Ziels nicht fremde Aenderungen mitschleppt.
const STORAGE_PREFIX = 'flns-changeset:';

function storageKey(scope: string) {
  return `${STORAGE_PREFIX}${scope || 'none'}`;
}

function load(scope: string): Op[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(scope: string, ops: Op[]) {
  try {
    if (ops.length) localStorage.setItem(storageKey(scope), JSON.stringify(ops));
    else localStorage.removeItem(storageKey(scope));
  } catch {
    /* Speicher voll oder gesperrt – der Changeset lebt dann nur im Arbeitsspeicher */
  }
}

interface ChangesetValue {
  ops: Op[];
  count: number;
  add: (op: Omit<Op, 'id'> & { id?: string }) => string;
  addMany: (ops: (Omit<Op, 'id'> & { id?: string })[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Findet eine anstehende Operation zu einem Ziel. */
  find: (table: string, mkey: string, childMkey?: string | null) => Op | undefined;
  /** Letztes Apply-Ergebnis, um Revert anbieten zu koennen. */
  lastApplied: Op[] | null;
  setLastApplied: (ops: Op[] | null) => void;
  /** true, wenn der Bestand aus einer frueheren Sitzung stammt. */
  restored: boolean;
  dismissRestored: () => void;
}

const Ctx = createContext<ChangesetValue | null>(null);

let seq = 0;
const nextId = () => `op-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Identitaet einer Operation: gleiche Art, gleiches Ziel = ersetzen statt anhaengen. */
function sameTarget(a: Op, b: Omit<Op, 'id'>) {
  return (
    a.kind === b.kind && a.table === b.table && a.mkey === b.mkey && (a.child?.mkey ?? null) === (b.child?.mkey ?? null)
  );
}

export function ChangesetProvider({ scope = '', children }: { scope?: string; children: ReactNode }) {
  const [ops, setOps] = useState<Op[]>(() => load(scope));
  const [lastApplied, setLastApplied] = useState<Op[] | null>(null);
  const [restored, setRestored] = useState(() => load(scope).length > 0);

  // Beim Wechsel des Ziels den Bestand der neuen Verbindung laden.
  useEffect(() => {
    const stored = load(scope);
    setOps(stored);
    setRestored(stored.length > 0);
    setLastApplied(null);
  }, [scope]);

  useEffect(() => {
    save(scope, ops);
  }, [scope, ops]);

  const add = useCallback((op: Omit<Op, 'id'> & { id?: string }) => {
    const id = op.id ?? nextId();
    setOps((prev) => {
      const i = prev.findIndex((p) => sameTarget(p, op));
      const full = { ...op, id: i >= 0 ? prev[i].id : id } as Op;
      if (i >= 0) {
        const next = [...prev];
        next[i] = full;
        return next;
      }
      return [...prev, full];
    });
    return id;
  }, []);

  const addMany = useCallback(
    (list: (Omit<Op, 'id'> & { id?: string })[]) => {
      list.forEach((op) => add(op));
    },
    [add]
  );

  const remove = useCallback((id: string) => setOps((prev) => prev.filter((o) => o.id !== id)), []);
  const clear = useCallback(() => {
    setOps([]);
    setRestored(false);
  }, []);
  const dismissRestored = useCallback(() => setRestored(false), []);

  const find = useCallback(
    (table: string, mkey: string, childMkey?: string | null) =>
      ops.find((o) => o.table === table && o.mkey === mkey && (o.child?.mkey ?? null) === (childMkey ?? null)),
    [ops]
  );

  const value = useMemo<ChangesetValue>(
    () => ({ ops, count: ops.length, add, addMany, remove, clear, find, lastApplied, setLastApplied, restored, dismissRestored }),
    [ops, add, addMany, remove, clear, find, lastApplied, restored, dismissRestored]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChangeset() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChangeset must be used inside ChangesetProvider');
  return v;
}
