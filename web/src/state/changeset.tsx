// ---------------------------------------------------------------------------
// Changeset-Kontext.
//
// Jede Schreibabsicht der UI landet hier als Operation. Nichts geht direkt an
// die FortiGate. Der Drawer zeigt den Bestand, validiert ihn und wendet ihn an.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Op } from '@/api/types';

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

export function ChangesetProvider({ children }: { children: ReactNode }) {
  const [ops, setOps] = useState<Op[]>([]);
  const [lastApplied, setLastApplied] = useState<Op[] | null>(null);

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
  const clear = useCallback(() => setOps([]), []);

  const find = useCallback(
    (table: string, mkey: string, childMkey?: string | null) =>
      ops.find((o) => o.table === table && o.mkey === mkey && (o.child?.mkey ?? null) === (childMkey ?? null)),
    [ops]
  );

  const value = useMemo<ChangesetValue>(
    () => ({ ops, count: ops.length, add, addMany, remove, clear, find, lastApplied, setLastApplied }),
    [ops, add, addMany, remove, clear, find, lastApplied]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChangeset() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChangeset must be used inside ChangesetProvider');
  return v;
}
