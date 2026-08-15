// Die Change-Engine ist die Stelle, an der ein Fehler teuer wird: Sie schreibt
// auf produktive Netzwerkkonfiguration. Die Faelle hier sind bewusst die, an
// denen die Entwicklung tatsaechlich gestolpert ist.
import { describe, expect, it, beforeEach } from 'vitest';
import { applyOps, invertOps, orderOps, projectRules, revertOps, validateOps, isCatchAll } from './changeset.js';
import { createDemoStore } from './demo.js';
import { getSchema } from './schema.js';

const DPP = 'switch-controller/dynamic-port-policy';
const VLANPOL = 'switch-controller/vlan-policy';

let schema;
beforeEach(async () => {
  schema ??= await getSchema({ host: 'demo' });
});

/** Bestand so lesen, wie das Backend es der Validierung uebergibt. */
async function readExisting(store) {
  const tables = [DPP, VLANPOL, 'switch-controller/managed-switch', 'switch-controller/lldp-profile'];
  const out = {};
  for (const t of tables) {
    const r = await store.call(`cmdb/${t}`);
    out[t] = r.data.results;
  }
  return out;
}

const rule = (mkey, after, kind = 'create') => ({
  id: mkey,
  kind,
  table: DPP,
  mkey: 'DPP-Access',
  child: { table: 'policy', mkey, idField: 'name' },
  after,
  before: null,
  label: `${kind} ${mkey}`,
});

// ---------------------------------------------------------------------------

describe('validateOps', () => {
  let existing;
  beforeEach(async () => {
    existing = await readExisting(createDemoStore());
  });

  it('rejects a value longer than the FortiOS field allows', () => {
    const { errors } = validateOps([rule('R-X', { 'hw-vendor': 'Wago Kontakttechnik', 'vlan-policy': 'VP-Clients' })], {
      schema,
      existing,
    });
    const e = errors.find((x) => x.field === 'hw-vendor');
    expect(e).toBeTruthy();
    expect(e.message).toMatch(/19 characters.*allows 15/);
  });

  it('accepts the same value once it is shortened to the prefix', () => {
    const { errors } = validateOps([rule('R-X', { 'hw-vendor': 'Wago Kontakt', 'vlan-policy': 'VP-Clients' })], {
      schema,
      existing,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown option value', () => {
    const { errors } = validateOps([rule('R-X', { status: 'maybe', mac: 'aa:bb:cc:dd:ee:ff' })], { schema, existing });
    expect(errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('rejects a malformed MAC address', () => {
    const { errors } = validateOps([rule('R-X', { mac: '3c:2a:f4:11:00' })], { schema, existing });
    expect(errors.some((e) => e.field === 'mac')).toBe(true);
  });

  it('rejects a reference to a VLAN policy that does not exist', () => {
    const { errors } = validateOps([rule('R-X', { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Ghost' })], {
      schema,
      existing,
    });
    expect(errors.some((e) => e.field === 'vlan-policy')).toBe(true);
  });

  it('accepts a reference to a VLAN policy created in the same changeset', () => {
    const ops = [
      {
        id: 'vp',
        kind: 'create',
        table: VLANPOL,
        mkey: 'VP-New',
        after: { fortilink: 'fortilink', vlan: 'VL10_CLIENTS' },
        before: null,
        label: 'create VP-New',
      },
      rule('R-X', { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-New' }),
    ];
    const { errors } = validateOps(ops, { schema, existing });
    expect(errors).toHaveLength(0);
  });

  it('requires the fortilink interface FortiOS insists on', () => {
    const ops = [
      { id: 'vp', kind: 'create', table: VLANPOL, mkey: 'VP-New', after: { vlan: 'VL10_CLIENTS' }, before: null, label: 'x' },
    ];
    const { errors } = validateOps(ops, { schema, existing });
    expect(errors.some((e) => e.field === 'fortilink')).toBe(true);
  });

  it('refuses every operation on a read-only connection', () => {
    const { errors } = validateOps([rule('R-X', { mac: 'aa:bb:cc:dd:ee:ff' })], { schema, existing, readOnly: true });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/read-only/i);
  });

  it('warns about a rule with no match criteria', () => {
    const { warnings } = validateOps([rule('R-X', { 'vlan-policy': 'VP-Clients' })], { schema, existing });
    expect(warnings.some((w) => /match every device/i.test(w.message))).toBe(true);
  });

  // Der Bug, der die Regel wirkungslos gemacht hat: FortiOS haengt neue Regeln
  // hinten an, hinter dem Catch-All greifen sie nie.
  it('warns when a new rule would land behind the catch-all', () => {
    const { warnings } = validateOps([rule('R-New', { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Clients' })], {
      schema,
      existing,
    });
    expect(warnings.some((w) => /never match/i.test(w.message))).toBe(true);
  });

  it('drops that warning once a move puts the rule in front of the catch-all', () => {
    const ops = [
      rule('R-New', { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Clients' }),
      {
        id: 'mv',
        kind: 'move',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R-New', idField: 'name' },
        move: { position: 'before', ref: 'R10-VoIP-Phones' },
        label: 'move',
      },
    ];
    const { warnings } = validateOps(ops, { schema, existing });
    expect(warnings.some((w) => /never match/i.test(w.message))).toBe(false);
  });

  it('rejects a duplicate object name', () => {
    const ops = [
      { id: 'vp', kind: 'create', table: VLANPOL, mkey: 'VP-Printer', after: { fortilink: 'fortilink' }, before: null, label: 'x' },
    ];
    const { errors } = validateOps(ops, { schema, existing });
    expect(errors.some((e) => /already exists/i.test(e.message))).toBe(true);
  });

  it('rejects a port set to dynamic without a policy', () => {
    const ops = [
      {
        id: 'p',
        kind: 'modify',
        table: 'switch-controller/managed-switch',
        mkey: 'S248EF0000001',
        idField: 'switch-id',
        child: { table: 'ports', mkey: 'port1', idField: 'port-name' },
        after: { 'access-mode': 'dynamic', 'port-policy': '' },
        before: {},
        label: 'x',
      },
    ];
    const { errors } = validateOps(ops, { schema, existing });
    expect(errors.some((e) => e.field === 'port-policy')).toBe(true);
  });
});

describe('isCatchAll', () => {
  it('treats a rule without criteria as catching everything', () => {
    expect(isCatchAll({ name: 'x', status: 'enable' })).toBe(true);
  });
  it('does not count a disabled rule', () => {
    expect(isCatchAll({ name: 'x', status: 'disable' })).toBe(false);
  });
  it('does not count a rule with a criterion', () => {
    expect(isCatchAll({ name: 'x', 'hw-vendor': 'Fortinet' })).toBe(false);
  });
});

describe('orderOps', () => {
  it('creates a VLAN policy before the rule that references it', () => {
    const ops = [
      rule('R-X', { 'vlan-policy': 'VP-New' }),
      { id: 'vp', kind: 'create', table: VLANPOL, mkey: 'VP-New', after: {}, label: 'x' },
    ];
    expect(orderOps(ops).map((o) => o.id)).toEqual(['vp', 'R-X']);
  });

  it('moves rules only after they have been created', () => {
    const ops = [
      { id: 'mv', kind: 'move', table: DPP, mkey: 'D', child: { table: 'policy', mkey: 'R' }, move: { position: 'before', ref: 'Z' }, label: 'x' },
      rule('R', { mac: 'aa:bb:cc:dd:ee:ff' }),
    ];
    expect(orderOps(ops).map((o) => o.id)).toEqual(['R', 'mv']);
  });

  it('deletes the referencing rule before the object it references', () => {
    const ops = [
      { id: 'delvp', kind: 'delete', table: VLANPOL, mkey: 'VP-Printer', before: {}, label: 'x' },
      { id: 'delrule', kind: 'delete', table: DPP, mkey: 'DPP-Access', child: { table: 'policy', mkey: 'R20-Printers' }, before: {}, label: 'x' },
    ];
    expect(orderOps(ops).map((o) => o.id)).toEqual(['delrule', 'delvp']);
  });
});

describe('projectRules', () => {
  it('places a created rule where the move puts it, not at the end', async () => {
    const existing = await readExisting(createDemoStore());
    const ops = [
      rule('R-New', { mac: 'aa:bb:cc:dd:ee:ff' }),
      {
        id: 'mv',
        kind: 'move',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R-New' },
        move: { position: 'before', ref: 'R10-VoIP-Phones' },
        label: 'x',
      },
    ];
    expect(projectRules('DPP-Access', existing, ops)[0].name).toBe('R-New');
  });
});

// ---------------------------------------------------------------------------

describe('applyOps', () => {
  let store;
  let call;
  beforeEach(() => {
    store = createDemoStore();
    call = (path, opts) => store.call(path, opts);
  });

  it('creates, reorders and reads back in the right order', async () => {
    const ops = [
      rule('R-New', { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Clients' }),
      {
        id: 'mv',
        kind: 'move',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R-New' },
        move: { position: 'before', ref: 'R10-VoIP-Phones' },
        label: 'move',
      },
    ];
    const out = await applyOps(call, ops);
    expect(out.failedCount).toBe(0);

    const dpp = (await call(`cmdb/${DPP}`)).data.results.find((d) => d.name === 'DPP-Access');
    expect(dpp.policy[0].name).toBe('R-New');
  });

  it('refuses to create an object that already exists', async () => {
    const ops = [
      { id: 'vp', kind: 'create', table: VLANPOL, mkey: 'VP-Printer', after: { fortilink: 'fortilink' }, before: null, label: 'x' },
    ];
    const out = await applyOps(call, ops);
    expect(out.results[0].status).toBe('failed');
  });

  it('reports the FortiGate refusing to delete a referenced object', async () => {
    const before = (await call(`cmdb/${VLANPOL}`)).data.results.find((v) => v.name === 'VP-Printer');
    const out = await applyOps(call, [{ id: 'd', kind: 'delete', table: VLANPOL, mkey: 'VP-Printer', before, label: 'x' }]);
    expect(out.results[0].status).toBe('failed');
    expect(out.results[0].message).toMatch(/referenced/i);
  });

  // Der zweite Bug: Ein unvollstaendiger Snapshot loeste einen Fehlalarm aus.
  it('does not cry conflict over fields the snapshot never captured', async () => {
    const op = {
      id: 'm',
      kind: 'modify',
      table: DPP,
      mkey: 'DPP-Access',
      child: { table: 'policy', mkey: 'R20-Printers' },
      before: { name: 'R20-Printers', 'hw-vendor': 'Hewlett Pack' }, // Teil-Snapshot
      after: { 'hw-vendor': 'Hewlett Pack', 'poe-reset': 'enable' },
      label: 'x',
    };
    const out = await applyOps(call, [op]);
    expect(out.results[0].status).toBe('applied');
  });

  it('skips a modify whose object changed on the FortiGate in the meantime', async () => {
    const dpp = (await call(`cmdb/${DPP}`)).data.results.find((d) => d.name === 'DPP-Access');
    const before = dpp.policy.find((r) => r.name === 'R20-Printers');

    // Jemand anderes aendert dieselbe Regel
    await call(`cmdb/${DPP}/DPP-Access/policy/R20-Printers`, { method: 'PUT', body: { description: 'touched elsewhere' } });

    const out = await applyOps(call, [
      { id: 'm', kind: 'modify', table: DPP, mkey: 'DPP-Access', child: { table: 'policy', mkey: 'R20-Printers' }, before, after: { ...before, 'poe-reset': 'enable' }, label: 'x' },
    ]);
    expect(out.results[0].status).toBe('conflict');
    expect(out.conflictCount).toBe(1);
  });

  it('treats a delete of something already gone as nothing to do', async () => {
    const out = await applyOps(call, [
      { id: 'd', kind: 'delete', table: VLANPOL, mkey: 'VP-DoesNotExist', before: { name: 'VP-DoesNotExist' }, label: 'x' },
    ]);
    expect(out.results[0].status).toBe('skipped');
  });

  // Regression: Das Duplizieren einer Regel erzeugte ein modify auf einen Namen,
  // den es noch gar nicht gab – der Apply scheiterte dann mit "no longer exists".
  it('rejects a modify aimed at a rule that does not exist', async () => {
    const out = await applyOps(call, [
      {
        id: 'm',
        kind: 'modify',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R30-Cameras-copy' },
        before: { name: 'R30-Cameras-copy' },
        after: { 'hw-vendor': 'Axis Comm' },
        label: 'x',
      },
    ]);
    expect(out.results[0].status).toBe('failed');
    expect(out.results[0].message).toMatch(/no longer exists/i);
  });

  it('creates that duplicate properly when it is staged as a create', async () => {
    const out = await applyOps(call, [rule('R30-Cameras-copy', { 'hw-vendor': 'Axis Comm', 'vlan-policy': 'VP-Camera' })]);
    expect(out.results[0].status).toBe('applied');
    const dpp = (await call(`cmdb/${DPP}`)).data.results.find((d) => d.name === 'DPP-Access');
    expect(dpp.policy.some((r) => r.name === 'R30-Cameras-copy')).toBe(true);
  });

  it('stops after a failure so later operations cannot build on it', async () => {
    const ops = [
      { id: 'bad', kind: 'create', table: VLANPOL, mkey: 'VP-Printer', after: { fortilink: 'fortilink' }, before: null, label: 'x' },
      rule('R-After', { mac: 'aa:bb:cc:dd:ee:ff' }),
    ];
    const out = await applyOps(call, ops);
    expect(out.results.map((r) => r.status)).toEqual(['failed', 'skipped']);
  });
});

describe('revert', () => {
  it('inverts a create into a delete and a modify back to its old value', () => {
    const inverse = invertOps([
      { id: 'a', kind: 'create', table: VLANPOL, mkey: 'VP-New', after: { vlan: 'X' }, label: 'x' },
      { id: 'b', kind: 'modify', table: VLANPOL, mkey: 'VP-Printer', before: { vlan: 'OLD' }, after: { vlan: 'NEW' }, label: 'x' },
    ]);
    // Letzte zuerst
    expect(inverse[0]).toMatchObject({ kind: 'modify', mkey: 'VP-Printer', after: { vlan: 'OLD' } });
    expect(inverse[1]).toMatchObject({ kind: 'delete', mkey: 'VP-New' });
  });

  it('restores the original values end to end', async () => {
    const store = createDemoStore();
    const call = (p, o) => store.call(p, o);
    const before = (await call(`cmdb/${VLANPOL}`)).data.results.find((v) => v.name === 'VP-Printer');

    const applied = await applyOps(call, [
      { id: 'm', kind: 'modify', table: VLANPOL, mkey: 'VP-Printer', before, after: { ...before, vlan: 'VL10_CLIENTS', 'discard-mode': 'none' }, label: 'x' },
    ]);
    expect(applied.appliedCount).toBe(1);

    const changed = (await call(`cmdb/${VLANPOL}`)).data.results.find((v) => v.name === 'VP-Printer');
    expect(changed.vlan).toBe('VL10_CLIENTS');

    await revertOps(call, applied.revertable);

    const restored = (await call(`cmdb/${VLANPOL}`)).data.results.find((v) => v.name === 'VP-Printer');
    expect(restored.vlan).toBe(before.vlan);
    expect(restored['discard-mode']).toBe(before['discard-mode']);
  });
});
