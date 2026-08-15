// Der Simulator sagt voraus, welche Regel ein Geraet trifft – auf dieser
// Vorhersage beruht die Impact-Anzeige vor dem Apply. Er bildet FortiOS nach,
// ist also eine Annahme; umso wichtiger, dass die Annahme festgeschrieben ist.
import { describe, expect, it } from 'vitest';
import { computeImpact, countPerRule, isCatchAll, ruleMatches, simulateAsset, compareWithFortiGate, simulateAll } from './match';
import type { Asset, Dpp, DppRule, ManagedSwitch, SwitchPort } from '@/api/types';

const asset = (over: Partial<Asset> = {}): Asset =>
  ({
    mac: '00:09:0f:aa:10:01',
    macDisplay: '00:09:0f:aa:10:01',
    hostname: 'FON-1001',
    ipv4: '10.10.20.31',
    vendor: 'Fortinet',
    type: 'IP Phone',
    family: 'FortiFone',
    os: '',
    osVersion: '',
    hostSrc: '',
    purdueLevel: '',
    dhcpStatus: '',
    detectedInterface: '',
    online: true,
    lastSeen: 30,
    known: true,
    switchId: 'SW1',
    portName: 'port1',
    portId: 1,
    vlanId: 20,
    onSwitch: true,
    accessMode: 'dynamic',
    portPolicy: 'DPP',
    portTags: [],
    matchedDpp: '',
    matchedRule: '',
    matchedNacPolicy: '',
    macPolicy: '',
    isDynamic: false,
    isNac: false,
    coverage: 'no-rule',
    raw: {},
    ...over,
  }) as Asset;

const rule = (over: Partial<DppRule>): DppRule => ({ name: 'R', status: 'enable', category: 'device', ...over });

const port = (over: Partial<SwitchPort> = {}): SwitchPort =>
  ({ 'port-name': 'port1', 'access-mode': 'dynamic', 'port-policy': 'DPP', 'interface-tags': [], ...over }) as SwitchPort;

const ctx = (rules: DppRule[], p: SwitchPort = port()) => ({
  dpps: [{ name: 'DPP', policy: rules }] as Dpp[],
  switches: [{ 'switch-id': 'SW1', ports: [p] }] as ManagedSwitch[],
});

describe('ruleMatches', () => {
  it('matches the MAC exactly, not by prefix', () => {
    expect(ruleMatches(rule({ mac: '00:09:0f:aa:10:01' }), asset(), null)).toBe(true);
    expect(ruleMatches(rule({ mac: '00:09:0f:aa:10' }), asset(), null)).toBe(false);
  });

  it('matches vendor, type and family by prefix', () => {
    expect(ruleMatches(rule({ 'hw-vendor': 'Forti' }), asset(), null)).toBe(true);
    expect(ruleMatches(rule({ type: 'IP Ph' }), asset(), null)).toBe(true);
    expect(ruleMatches(rule({ family: 'FortiFone' }), asset(), null)).toBe(true);
    expect(ruleMatches(rule({ 'hw-vendor': 'Yealink' }), asset(), null)).toBe(false);
  });

  it('ignores case', () => {
    expect(ruleMatches(rule({ 'hw-vendor': 'fortinet' }), asset(), null)).toBe(true);
  });

  it('requires every set criterion to hold', () => {
    expect(ruleMatches(rule({ 'hw-vendor': 'Fortinet', type: 'Printer' }), asset(), null)).toBe(false);
    expect(ruleMatches(rule({ 'hw-vendor': 'Fortinet', type: 'IP Phone' }), asset(), null)).toBe(true);
  });

  it('never matches through a disabled rule', () => {
    expect(ruleMatches(rule({ 'hw-vendor': 'Fortinet', status: 'disable' }), asset(), null)).toBe(false);
  });

  it('matches an interface-tag rule only when the port carries every tag', () => {
    const r = rule({ category: 'interface-tag', 'interface-tags': [{ 'tag-name': 'lab' }] });
    expect(ruleMatches(r, asset(), port({ 'interface-tags': [{ 'tag-name': 'lab' }] }))).toBe(true);
    expect(ruleMatches(r, asset(), port({ 'interface-tags': [{ 'tag-name': 'uplink' }] }))).toBe(false);
    // Geraetedaten spielen in dieser Kategorie keine Rolle
    expect(ruleMatches(r, asset({ vendor: 'Nobody' }), port({ 'interface-tags': [{ 'tag-name': 'lab' }] }))).toBe(true);
  });

  it('treats an interface-tag rule without tags as matching nothing', () => {
    expect(ruleMatches(rule({ category: 'interface-tag', 'interface-tags': [] }), asset(), port())).toBe(false);
  });
});

describe('simulateAsset', () => {
  it('takes the first matching rule and stops', () => {
    const r = simulateAsset(
      asset(),
      ctx([rule({ name: 'first', 'hw-vendor': 'Fortinet' }), rule({ name: 'second', 'hw-vendor': 'Fortinet' })])
    );
    expect(r.hit?.rule).toBe('first');
  });

  it('falls through to the catch-all', () => {
    const r = simulateAsset(asset(), ctx([rule({ name: 'printers', type: 'Printer' }), rule({ name: 'catch' })]));
    expect(r.hit?.rule).toBe('catch');
  });

  it('reports why nothing applies on a static port', () => {
    const r = simulateAsset(asset(), ctx([rule({ name: 'catch' })], port({ 'access-mode': 'static', 'port-policy': '' })));
    expect(r).toMatchObject({ hit: null, reason: 'port-static' });
  });

  it('reports a device that is not on a switch at all', () => {
    expect(simulateAsset(asset({ onSwitch: false }), ctx([rule({ name: 'catch' })])).reason).toBe('off-switch');
  });

  it('reports a port pointing at a policy that does not exist', () => {
    const c = ctx([rule({ name: 'catch' })], port({ 'port-policy': 'Ghost' }));
    expect(simulateAsset(asset(), c).reason).toBe('no-policy');
  });

  it('says no-rule when the policy has nothing that fits', () => {
    expect(simulateAsset(asset(), ctx([rule({ name: 'printers', type: 'Printer' })])).reason).toBe('no-rule');
  });

  it('ignores a rule that the changeset marks for deletion', () => {
    const rules = [{ ...rule({ name: 'gone', 'hw-vendor': 'Fortinet' }), __pending: 'delete' }, rule({ name: 'catch' })];
    expect(simulateAsset(asset(), ctx(rules as DppRule[])).hit?.rule).toBe('catch');
  });
});

describe('isCatchAll', () => {
  it('recognises a rule with no criteria', () => {
    expect(isCatchAll(rule({ name: 'x' }))).toBe(true);
    expect(isCatchAll(rule({ name: 'x', host: 'printer' }))).toBe(false);
    expect(isCatchAll(rule({ name: 'x', status: 'disable' }))).toBe(false);
  });
});

describe('countPerRule', () => {
  it('counts the devices each rule takes', () => {
    const assets = [asset(), asset({ mac: 'b', macDisplay: 'b', vendor: 'Brother', type: 'Printer', hostname: 'PRN' })];
    const counts = countPerRule(assets, ctx([rule({ name: 'phones', type: 'IP Phone' }), rule({ name: 'catch' })]));
    expect(counts.get('DPP phones')).toBe(1);
    expect(counts.get('DPP catch')).toBe(1);
  });
});

describe('computeImpact', () => {
  const assets = [asset(), asset({ mac: 'b', macDisplay: 'b', hostname: 'PRN', vendor: 'Brother', type: 'Printer' })];

  it('reports which devices change rule and which stay put', () => {
    const before = ctx([rule({ name: 'catch' })]);
    const after = ctx([rule({ name: 'phones', type: 'IP Phone' }), rule({ name: 'catch' })]);

    const impact = computeImpact(assets, before, after);
    expect(impact.changed).toBe(1);
    expect(impact.unaffected).toBe(1);
    expect(impact.rows[0]).toMatchObject({ from: 'DPP / catch', to: 'DPP / phones', change: 'changed' });
  });

  it('reports a device that gains a rule and one that loses it', () => {
    const none = ctx([rule({ name: 'printers', type: 'Printer' })]);
    const all = ctx([rule({ name: 'catch' })]);

    expect(computeImpact([asset()], none, all).gained).toBe(1);
    expect(computeImpact([asset()], all, none).lost).toBe(1);
  });

  it('flags rules that no known device would match', () => {
    const after = ctx([rule({ name: 'phones', type: 'IP Phone' }), rule({ name: 'cameras', type: 'IP Camera' })]);
    const impact = computeImpact([asset()], ctx([rule({ name: 'phones', type: 'IP Phone' })]), after);
    expect(impact.deadRules).toContainEqual({ dpp: 'DPP', rule: 'cameras' });
  });
});

describe('compareWithFortiGate', () => {
  it('surfaces a device the FortiGate has not re-evaluated yet', () => {
    const a = asset({ matchedDpp: 'DPP', matchedRule: 'old-rule' });
    const sim = simulateAll([a], ctx([rule({ name: 'new-rule', 'hw-vendor': 'Fortinet' })]));
    const diff = compareWithFortiGate([a], sim);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ fortigate: 'DPP / old-rule', simulated: 'DPP / new-rule' });
  });

  it('stays quiet when simulation and FortiGate agree', () => {
    const a = asset({ matchedDpp: 'DPP', matchedRule: 'phones' });
    const sim = simulateAll([a], ctx([rule({ name: 'phones', 'hw-vendor': 'Fortinet' })]));
    expect(compareWithFortiGate([a], sim)).toHaveLength(0);
  });
});
