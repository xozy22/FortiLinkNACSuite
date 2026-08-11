// Baut die Operationen fuer den Changeset. Eine Stelle, damit Tabellenpfade,
// Schluesselfelder und Labels ueberall gleich aussehen.
import type { DppRule, Op, SwitchPort, VlanPolicy } from '@/api/types';

export const T = {
  DPP: 'switch-controller/dynamic-port-policy',
  VLAN_POLICY: 'switch-controller/vlan-policy',
  SWITCH: 'switch-controller/managed-switch',
} as const;

type Draft = Omit<Op, 'id'>;

/** FortiOS haengt an jedes Objekt q_origin_key – das gehoert nicht in einen Diff. */
export function clean<Tv extends Record<string, unknown>>(obj: Tv | null | undefined): Record<string, unknown> {
  if (!obj) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'q_origin_key') continue;
    if (Array.isArray(v)) {
      out[k] = v.map((e) => (e && typeof e === 'object' ? clean(e as Record<string, unknown>) : e));
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Entfernt das Schluesselfeld – es steckt schon im mkey. */
function withoutKey(obj: Record<string, unknown>, keyField: string) {
  const { [keyField]: _drop, ...rest } = obj;
  return rest;
}

// --- VLAN Policy -----------------------------------------------------------

export function createVlanPolicy(after: VlanPolicy): Draft {
  return {
    kind: 'create',
    table: T.VLAN_POLICY,
    mkey: after.name,
    after: withoutKey(clean(after), 'name'),
    before: null,
    label: `Create VLAN policy "${after.name}"`,
  };
}

export function modifyVlanPolicy(before: VlanPolicy, after: VlanPolicy): Draft {
  return {
    kind: 'modify',
    table: T.VLAN_POLICY,
    mkey: before.name,
    before: withoutKey(clean(before), 'name'),
    after: withoutKey(clean(after), 'name'),
    label: `Edit VLAN policy "${before.name}"`,
  };
}

export function deleteVlanPolicy(before: VlanPolicy): Draft {
  return {
    kind: 'delete',
    table: T.VLAN_POLICY,
    mkey: before.name,
    before: withoutKey(clean(before), 'name'),
    after: null,
    label: `Delete VLAN policy "${before.name}"`,
  };
}

// --- Dynamic Port Policy (Container) ---------------------------------------

export function createDpp(after: { name: string; description?: string; fortilink?: string }): Draft {
  return {
    kind: 'create',
    table: T.DPP,
    mkey: after.name,
    after: withoutKey(clean(after), 'name'),
    before: null,
    label: `Create dynamic port policy "${after.name}"`,
  };
}

export function modifyDpp(
  before: { name: string; [k: string]: unknown },
  after: { name: string; [k: string]: unknown }
): Draft {
  // policy gehoert nicht in ein Container-Update – Regeln laufen ueber eigene Ops.
  const strip = (o: Record<string, unknown>) => {
    const { policy: _p, ...rest } = withoutKey(clean(o), 'name');
    return rest;
  };
  return {
    kind: 'modify',
    table: T.DPP,
    mkey: before.name,
    before: strip(before),
    after: strip(after),
    label: `Edit dynamic port policy "${before.name}"`,
  };
}

export function deleteDpp(before: { name: string; [k: string]: unknown }): Draft {
  return {
    kind: 'delete',
    table: T.DPP,
    mkey: before.name,
    before: withoutKey(clean(before), 'name'),
    after: null,
    label: `Delete dynamic port policy "${before.name}"`,
  };
}

// --- Regeln (Kindtabelle policy) -------------------------------------------

const ruleChild = (name: string) => ({ table: 'policy', mkey: name, idField: 'name' });

export function createRule(dpp: string, after: DppRule): Draft {
  return {
    kind: 'create',
    table: T.DPP,
    mkey: dpp,
    child: ruleChild(after.name),
    after: withoutKey(clean(after), 'name'),
    before: null,
    label: `Add rule "${after.name}" to "${dpp}"`,
  };
}

export function modifyRule(dpp: string, before: DppRule, after: DppRule): Draft {
  return {
    kind: 'modify',
    table: T.DPP,
    mkey: dpp,
    child: ruleChild(before.name),
    before: withoutKey(clean(before), 'name'),
    after: withoutKey(clean(after), 'name'),
    label: `Edit rule "${before.name}" in "${dpp}"`,
  };
}

export function deleteRule(dpp: string, before: DppRule): Draft {
  return {
    kind: 'delete',
    table: T.DPP,
    mkey: dpp,
    child: ruleChild(before.name),
    before: withoutKey(clean(before), 'name'),
    after: null,
    label: `Delete rule "${before.name}" from "${dpp}"`,
  };
}

export function moveRule(dpp: string, name: string, position: 'before' | 'after', ref: string): Draft {
  return {
    kind: 'move',
    table: T.DPP,
    mkey: dpp,
    child: ruleChild(name),
    move: { position, ref },
    before: null,
    after: null,
    label: `Move "${name}" ${position} "${ref}"`,
  };
}

// --- Switch-Ports ----------------------------------------------------------

export function setPort(switchId: string, before: SwitchPort, after: Partial<SwitchPort>): Draft {
  const name = before['port-name'];
  const merged = { ...clean(before), ...after };
  return {
    kind: 'modify',
    table: T.SWITCH,
    mkey: switchId,
    idField: 'switch-id',
    child: { table: 'ports', mkey: name, idField: 'port-name' },
    before: withoutKey(clean(before), 'port-name'),
    after: withoutKey(merged, 'port-name'),
    label: `Configure ${switchId} / ${name}`,
  };
}
