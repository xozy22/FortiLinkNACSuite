// Der Konfigurationsvergleich traegt Export, Import und Snapshot-Rollback.
// Ein Fehler hier schreibt entweder zu wenig (das Rollback bleibt unvollstaendig)
// oder zu viel (fremde Objekte verschwinden) – beides teuer.
import { describe, expect, it } from 'vitest';
import { diffConfig, readConfig, summarizeConfig, validateConfig } from './config.js';
import { applyOps } from './changeset.js';
import { createDemoStore } from './demo.js';

const callOf = (store) => (p, o) => store.call(p, o);

const cfg = (over = {}) => ({
  _format: 'fortilink-nac-suite/config',
  _version: 1,
  dynamicPortPolicies: [],
  vlanPolicies: [],
  interfaceTags: [],
  portAssignments: [],
  ...over,
});

describe('readConfig', () => {
  it('captures the managed part and nothing else', async () => {
    const c = await readConfig(callOf(createDemoStore()), { host: 'demo', vdom: 'root' });
    expect(c._format).toBe('fortilink-nac-suite/config');
    expect(c.dynamicPortPolicies.map((d) => d.name)).toContain('DPP-Access');
    expect(c.vlanPolicies.length).toBeGreaterThan(0);
    expect(c.portAssignments[0]).toHaveProperty('switchId');
    // Geraetezustand gehoert nicht in eine Konfigurationssicherung
    expect(c.portAssignments[0]).not.toHaveProperty('poe-status');
    expect(JSON.stringify(c)).not.toContain('q_origin_key');
  });
});

describe('validateConfig', () => {
  it('accepts a well-formed bundle', () => {
    expect(validateConfig(cfg())).toHaveLength(0);
  });
  it('rejects a foreign file', () => {
    expect(validateConfig({ hello: 'world' }).length).toBeGreaterThan(0);
  });
  it('rejects a future format version', () => {
    expect(validateConfig(cfg({ _version: 99 })).some((e) => /version/i.test(e))).toBe(true);
  });
});

describe('diffConfig', () => {
  it('finds nothing to do when both sides match', async () => {
    const current = await readConfig(callOf(createDemoStore()));
    expect(diffConfig(current, current, { deleteExtra: true })).toHaveLength(0);
  });

  it('creates what the target has and the FortiGate does not', () => {
    const ops = diffConfig(
      cfg({ vlanPolicies: [{ name: 'VP-New', fortilink: 'fortilink', vlan: 'VL10' }] }),
      cfg()
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'create', mkey: 'VP-New' });
    expect(ops[0].after).not.toHaveProperty('name');
  });

  it('updates only what actually differs', () => {
    const ops = diffConfig(
      cfg({ vlanPolicies: [{ name: 'VP', fortilink: 'fortilink', vlan: 'VL20' }] }),
      cfg({ vlanPolicies: [{ name: 'VP', fortilink: 'fortilink', vlan: 'VL10' }] })
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'modify', after: { vlan: 'VL20' } });
  });

  it('leaves extra objects alone unless asked to remove them', () => {
    const target = cfg();
    const current = cfg({ vlanPolicies: [{ name: 'VP-Extra', fortilink: 'fortilink' }] });
    expect(diffConfig(target, current)).toHaveLength(0);
    expect(diffConfig(target, current, { deleteExtra: true })).toHaveLength(1);
  });

  it('never invents a switch port that does not exist here', () => {
    const ops = diffConfig(
      cfg({ portAssignments: [{ switchId: 'OTHER-SWITCH', port: 'port1', 'access-mode': 'dynamic', 'port-policy': 'X' }] }),
      cfg({ portAssignments: [] })
    );
    expect(ops).toHaveLength(0);
  });

  it('reassigns a port that exists on both sides', () => {
    const ops = diffConfig(
      cfg({ portAssignments: [{ switchId: 'SW1', port: 'port1', 'access-mode': 'dynamic', 'port-policy': 'DPP' }] }),
      cfg({ portAssignments: [{ switchId: 'SW1', port: 'port1', 'access-mode': 'static', 'port-policy': '' }] })
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'modify', mkey: 'SW1', child: { mkey: 'port1' }, after: { 'access-mode': 'dynamic' } });
  });

  it('adds a missing rule to an existing policy', () => {
    const ops = diffConfig(
      cfg({ dynamicPortPolicies: [{ name: 'D', fortilink: 'fl', policy: [{ name: 'R1' }, { name: 'R2' }] }] }),
      cfg({ dynamicPortPolicies: [{ name: 'D', fortilink: 'fl', policy: [{ name: 'R1' }] }] })
    );
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(1);
    expect(ops[0]).toMatchObject({ child: { mkey: 'R2' } });
  });

  // Die Reihenfolge entscheidet ueber das Ergebnis – inhaltsgleiche Regeln in
  // falscher Reihenfolge sind eine andere Konfiguration.
  it('restores the rule order, not just the rules', () => {
    const ops = diffConfig(
      cfg({ dynamicPortPolicies: [{ name: 'D', policy: [{ name: 'B' }, { name: 'A' }] }] }),
      cfg({ dynamicPortPolicies: [{ name: 'D', policy: [{ name: 'A' }, { name: 'B' }] }] })
    );
    const moves = ops.filter((o) => o.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]).toMatchObject({ child: { mkey: 'B' }, move: { position: 'before', ref: 'A' } });
  });

  it('emits no move when the order already matches', () => {
    const same = cfg({ dynamicPortPolicies: [{ name: 'D', policy: [{ name: 'A' }, { name: 'B' }] }] });
    expect(diffConfig(same, same).filter((o) => o.kind === 'move')).toHaveLength(0);
  });
});

// Der eigentliche Beweis: aendern, zurueckrollen, vergleichen.
describe('snapshot rollback', () => {
  it('brings the configuration back to the captured state', async () => {
    const store = createDemoStore();
    const call = callOf(store);

    const snapshot = await readConfig(call);

    // Mehrere Aenderungen: neue VLAN Policy, neue Regel, Port umgestellt
    await applyOps(call, [
      { id: '1', kind: 'create', table: 'switch-controller/vlan-policy', mkey: 'VP-Temp', after: { fortilink: 'fortilink', vlan: 'VL10_CLIENTS' }, before: null, label: 'x' },
      { id: '2', kind: 'create', table: 'switch-controller/dynamic-port-policy', mkey: 'DPP-Access', child: { table: 'policy', mkey: 'R-Temp' }, after: { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Temp' }, before: null, label: 'x' },
      { id: '3', kind: 'modify', table: 'switch-controller/managed-switch', mkey: 'S248EF0000001', idField: 'switch-id', child: { table: 'ports', mkey: 'port15', idField: 'port-name' }, before: {}, after: { 'access-mode': 'dynamic', 'port-policy': 'DPP-Access' }, label: 'x' },
    ]);

    const changed = await readConfig(call);
    expect(changed.vlanPolicies.some((v) => v.name === 'VP-Temp')).toBe(true);
    expect(diffConfig(snapshot, changed, { deleteExtra: true }).length).toBeGreaterThan(0);

    // Zurueckrollen ueber den gewoehnlichen Weg
    const plan = diffConfig(snapshot, changed, { deleteExtra: true });
    const outcome = await applyOps(call, plan, { stopOnError: false });
    expect(outcome.failedCount).toBe(0);

    const restored = await readConfig(call);
    expect(restored.vlanPolicies.some((v) => v.name === 'VP-Temp')).toBe(false);
    expect(restored.dynamicPortPolicies.find((d) => d.name === 'DPP-Access').policy.some((r) => r.name === 'R-Temp')).toBe(false);
    expect(restored.portAssignments.find((p) => p.port === 'port15' && p.switchId === 'S248EF0000001')['access-mode']).toBe('static');

    // Und nichts bleibt uebrig
    expect(diffConfig(snapshot, restored, { deleteExtra: true })).toHaveLength(0);
  });
});

describe('summarizeConfig', () => {
  it('counts what the listing shows', async () => {
    const c = await readConfig(callOf(createDemoStore()));
    const s = summarizeConfig(c);
    expect(s.policies).toBe(c.dynamicPortPolicies.length);
    expect(s.rules).toBe(c.dynamicPortPolicies.reduce((n, d) => n + d.policy.length, 0));
    expect(s.ports).toBe(c.portAssignments.filter((p) => p['access-mode'] === 'dynamic').length);
  });
});
