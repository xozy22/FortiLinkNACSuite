// Die Projektion zeigt anstehende Aenderungen an der Stelle, an der sie spaeter
// stehen werden. Weicht sie von der Ausfuehrungsreihenfolge des Backends ab,
// verspricht das UI etwas anderes, als der Apply liefert.
import { describe, expect, it } from 'vitest';
import { projectDpps, projectSwitches, projectVlanPolicies } from './project';
import { createRule, deleteRule, modifyRule, moveRule, setPort, createVlanPolicy, deleteVlanPolicy, T } from './ops';
import type { Dpp, ManagedSwitch, Op, VlanPolicy } from '@/api/types';

const withId = (draft: Omit<Op, 'id'>, id: string): Op => ({ ...draft, id }) as Op;

const dpps = (): Dpp[] => [
  {
    name: 'DPP-Access',
    fortilink: 'fortilink',
    policy: [
      { name: 'R10', 'hw-vendor': 'Fortinet' },
      { name: 'R99' },
    ],
  },
];

describe('projectDpps', () => {
  it('shows a staged rule immediately, marked as pending', () => {
    const out = projectDpps(dpps(), [withId(createRule('DPP-Access', { name: 'R-New', mac: 'aa:bb:cc:dd:ee:ff' }), '1')]);
    const r = out[0].policy!.find((x) => x.name === 'R-New') as { __pending?: string };
    expect(r).toBeTruthy();
    expect(r.__pending).toBe('create');
  });

  it('places the new rule where the move puts it, not at the end', () => {
    const ops = [
      withId(createRule('DPP-Access', { name: 'R-New', mac: 'aa:bb:cc:dd:ee:ff' }), '1'),
      withId(moveRule('DPP-Access', 'R-New', 'before', 'R99'), '2'),
    ];
    expect(projectDpps(dpps(), ops)[0].policy!.map((r) => r.name)).toEqual(['R10', 'R-New', 'R99']);
  });

  it('keeps a deleted rule visible but marked, so the order stays readable', () => {
    const ops = [withId(deleteRule('DPP-Access', { name: 'R10' }), '1')];
    const rules = projectDpps(dpps(), ops)[0].policy as { name: string; __pending?: string }[];
    expect(rules.map((r) => r.name)).toEqual(['R10', 'R99']);
    expect(rules[0].__pending).toBe('delete');
  });

  it('merges a modify into the existing rule', () => {
    const before = dpps()[0].policy![0];
    const ops = [withId(modifyRule('DPP-Access', before, { ...before, 'vlan-policy': 'VP-Voice' }), '1')];
    const r = projectDpps(dpps(), ops)[0].policy![0] as { 'vlan-policy'?: string; __pending?: string };
    expect(r['vlan-policy']).toBe('VP-Voice');
    expect(r.__pending).toBe('modify');
  });

  it('applies creates before moves regardless of the order they were staged in', () => {
    const ops = [
      withId(moveRule('DPP-Access', 'R-New', 'before', 'R10'), '2'),
      withId(createRule('DPP-Access', { name: 'R-New', mac: 'aa:bb:cc:dd:ee:ff' }), '1'),
    ];
    expect(projectDpps(dpps(), ops)[0].policy!.map((r) => r.name)).toEqual(['R-New', 'R10', 'R99']);
  });

  it('leaves other policies untouched', () => {
    const two = [...dpps(), { name: 'DPP-Lab', policy: [{ name: 'L1' }] }];
    const out = projectDpps(two, [withId(createRule('DPP-Access', { name: 'R-New' }), '1')]);
    expect(out.find((d) => d.name === 'DPP-Lab')!.policy!.map((r) => r.name)).toEqual(['L1']);
  });
});

describe('projectVlanPolicies', () => {
  const list = (): VlanPolicy[] => [{ name: 'VP-Printer', vlan: 'VL30' }];

  it('adds a staged policy', () => {
    const out = projectVlanPolicies(list(), [withId(createVlanPolicy({ name: 'VP-New', fortilink: 'fortilink' }), '1')]);
    expect(out.map((v) => v.name)).toContain('VP-New');
    expect(out.find((v) => v.name === 'VP-New')!.__pending).toBe('create');
  });

  it('marks a deletion without removing the row', () => {
    const out = projectVlanPolicies(list(), [withId(deleteVlanPolicy({ name: 'VP-Printer' }), '1')]);
    expect(out).toHaveLength(1);
    expect(out[0].__pending).toBe('delete');
  });
});

describe('projectSwitches', () => {
  const switches = (): ManagedSwitch[] => [
    { 'switch-id': 'SW1', ports: [{ 'port-name': 'port1', 'access-mode': 'static', 'port-policy': '' }] },
  ];

  it('shows a staged port assignment', () => {
    const before = switches()[0].ports![0];
    const ops = [withId(setPort('SW1', before, { 'access-mode': 'dynamic', 'port-policy': 'DPP-Access' }), '1')];
    const p = projectSwitches(switches(), ops)[0].ports![0] as { __pending?: string; 'access-mode'?: string };
    expect(p['access-mode']).toBe('dynamic');
    expect(p.__pending).toBe('modify');
  });

  it('ignores operations aimed at another table', () => {
    const ops = [withId(createVlanPolicy({ name: 'VP-New', fortilink: 'fortilink' }), '1')];
    expect(projectSwitches(switches(), ops)[0].ports![0]['access-mode']).toBe('static');
  });
});

describe('op builders', () => {
  it('strips the key field out of the payload – it already sits in mkey', () => {
    const op = createRule('DPP-Access', { name: 'R-New', mac: 'aa:bb:cc:dd:ee:ff' });
    expect(op.child).toMatchObject({ table: 'policy', mkey: 'R-New' });
    expect(op.after).not.toHaveProperty('name');
    expect(op.after).toMatchObject({ mac: 'aa:bb:cc:dd:ee:ff' });
  });

  it('drops q_origin_key so it never shows up in a diff', () => {
    const op = modifyRule('DPP-Access', { name: 'R', q_origin_key: 'R' } as never, { name: 'R', mac: 'aa:bb:cc:dd:ee:ff' });
    expect(op.before).not.toHaveProperty('q_origin_key');
  });

  it('addresses a switch port by its own key fields', () => {
    const op = setPort('SW1', { 'port-name': 'port1' }, { 'access-mode': 'dynamic' });
    expect(op.table).toBe(T.SWITCH);
    expect(op.idField).toBe('switch-id');
    expect(op.child).toMatchObject({ table: 'ports', mkey: 'port1', idField: 'port-name' });
  });
});
