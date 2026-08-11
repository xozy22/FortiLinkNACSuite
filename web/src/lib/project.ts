// ---------------------------------------------------------------------------
// Projektion: gelesener Zustand + anstehende Operationen = das, was die UI zeigt.
//
// Ohne das muesste der Nutzer eine gerade angelegte Regel erst nach dem Apply
// sehen. Mit der Projektion sieht er sie sofort, deutlich als "pending"
// markiert, an genau der Position, an der sie spaeter stehen wird.
// ---------------------------------------------------------------------------
import type { Dpp, DppRule, ManagedSwitch, Op, SwitchPort, VlanPolicy } from '@/api/types';
import { T } from './ops';

export type PendingKind = 'create' | 'modify' | 'delete';
export type Pending<Tv> = Tv & { __pending?: PendingKind; __opId?: string };

function mark<Tv extends object>(item: Tv, kind: PendingKind, opId: string): Pending<Tv> {
  return { ...item, __pending: kind, __opId: opId };
}

// --- VLAN Policies ---------------------------------------------------------

export function projectVlanPolicies(list: VlanPolicy[], ops: Op[]): Pending<VlanPolicy>[] {
  let out: Pending<VlanPolicy>[] = list.map((v) => ({ ...v }));
  for (const op of ops) {
    if (op.table !== T.VLAN_POLICY || op.child) continue;
    const i = out.findIndex((v) => v.name === op.mkey);
    if (op.kind === 'create' && i === -1) {
      out.push(mark({ name: op.mkey, ...(op.after ?? {}) } as VlanPolicy, 'create', op.id));
    } else if (op.kind === 'modify' && i >= 0) {
      out[i] = mark({ ...out[i], ...(op.after ?? {}) } as VlanPolicy, 'modify', op.id);
    } else if (op.kind === 'delete' && i >= 0) {
      out[i] = mark(out[i], 'delete', op.id);
    }
  }
  return out;
}

// --- Dynamic Port Policies -------------------------------------------------

export function projectDpps(list: Dpp[], ops: Op[]): Pending<Dpp>[] {
  const out: Pending<Dpp>[] = list.map((d) => ({ ...d, policy: (d.policy ?? []).map((r) => ({ ...r })) }));

  // Container zuerst, damit Regeln in neu angelegten DPPs landen koennen.
  for (const op of ops) {
    if (op.table !== T.DPP || op.child) continue;
    const i = out.findIndex((d) => d.name === op.mkey);
    if (op.kind === 'create' && i === -1) {
      out.push(mark({ name: op.mkey, policy: [], ...(op.after ?? {}) } as Dpp, 'create', op.id));
    } else if (op.kind === 'modify' && i >= 0) {
      out[i] = mark({ ...out[i], ...(op.after ?? {}) } as Dpp, 'modify', op.id);
    } else if (op.kind === 'delete' && i >= 0) {
      out[i] = mark(out[i], 'delete', op.id);
    }
  }

  // Regeln in Eingabereihenfolge – create vor move, wie das Backend es sortiert.
  const ruleOps = ops.filter((o) => o.table === T.DPP && o.child?.table === 'policy');
  for (const op of [...ruleOps].sort((a, b) => rankRuleOp(a) - rankRuleOp(b))) {
    const dpp = out.find((d) => d.name === op.mkey);
    if (!dpp) continue;
    const rules = (dpp.policy ?? []) as Pending<DppRule>[];
    const name = op.child!.mkey;
    const i = rules.findIndex((r) => r.name === name);

    if (op.kind === 'create' && i === -1) {
      rules.push(mark({ name, ...(op.after ?? {}) } as DppRule, 'create', op.id));
    } else if (op.kind === 'modify' && i >= 0) {
      rules[i] = mark({ ...rules[i], ...(op.after ?? {}) } as DppRule, 'modify', op.id);
    } else if (op.kind === 'delete' && i >= 0) {
      rules[i] = mark(rules[i], 'delete', op.id);
    } else if (op.kind === 'move' && i >= 0) {
      const [moved] = rules.splice(i, 1);
      const j = rules.findIndex((r) => r.name === op.move?.ref);
      if (j === -1) rules.push(moved);
      else rules.splice(op.move!.position === 'before' ? j : j + 1, 0, moved);
    }
    dpp.policy = rules;
  }

  return out;
}

function rankRuleOp(op: Op) {
  if (op.kind === 'create') return 0;
  if (op.kind === 'modify') return 1;
  if (op.kind === 'move') return 2;
  return 3;
}

// --- Switches / Ports ------------------------------------------------------

export function projectSwitches(list: ManagedSwitch[], ops: Op[]): ManagedSwitch[] {
  const out = list.map((s) => ({ ...s, ports: (s.ports ?? []).map((p) => ({ ...p })) }));
  for (const op of ops) {
    if (op.table !== T.SWITCH || op.child?.table !== 'ports') continue;
    const sw = out.find((s) => s['switch-id'] === op.mkey);
    if (!sw) continue;
    const ports = sw.ports as Pending<SwitchPort>[];
    const i = ports.findIndex((p) => p['port-name'] === op.child!.mkey);
    if (i >= 0) ports[i] = mark({ ...ports[i], ...(op.after ?? {}) } as SwitchPort, 'modify', op.id);
  }
  return out;
}

/** Alle Ops, die zu einem Objekt gehoeren – fuer "diese Zeile hat Aenderungen". */
export function opsFor(ops: Op[], table: string, mkey: string, childMkey?: string) {
  return ops.filter(
    (o) => o.table === table && o.mkey === mkey && (childMkey === undefined || o.child?.mkey === childMkey)
  );
}
