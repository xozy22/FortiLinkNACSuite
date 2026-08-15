// Der CLI-Block ist das, was im Review gelesen und in Change-Tickets kopiert
// wird. Weicht er von den tatsaechlich ausgefuehrten Operationen ab, ist die
// Vorschau schlimmer als keine.
import { describe, expect, it } from 'vitest';
import { opsToCli } from './cli.js';

const DPP = 'switch-controller/dynamic-port-policy';
const VLANPOL = 'switch-controller/vlan-policy';

describe('opsToCli', () => {
  it('renders a create with quoted names and bare option values', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'create',
        table: VLANPOL,
        mkey: 'VP-OT',
        after: { description: 'OT devices', fortilink: 'fortilink', vlan: 'VL99_QUARANTINE', 'discard-mode': 'all-tagged' },
        label: 'x',
      },
    ]);
    expect(cli).toContain('config switch-controller vlan-policy');
    expect(cli).toContain('edit "VP-OT"');
    expect(cli).toContain('set vlan "VL99_QUARANTINE"');
    expect(cli).toContain('set discard-mode all-tagged'); // Option ohne Anfuehrungszeichen
    expect(cli.trimEnd().endsWith('end')).toBe(true);
  });

  it('writes only the fields a modify actually changes', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'modify',
        table: VLANPOL,
        mkey: 'VP-Printer',
        before: { description: 'old', vlan: 'VL30_PRINT', 'discard-mode': 'all-tagged' },
        after: { description: 'old', vlan: 'VL10_CLIENTS', 'discard-mode': 'all-tagged' },
        label: 'x',
      },
    ]);
    expect(cli).toContain('set vlan "VL10_CLIENTS"');
    expect(cli).not.toContain('description');
    expect(cli).not.toContain('discard-mode');
  });

  it('unsets a field that the modify removes', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'modify',
        table: VLANPOL,
        mkey: 'VP-Printer',
        before: { vlan: 'VL30_PRINT' },
        after: {},
        label: 'x',
      },
    ]);
    expect(cli).toContain('unset vlan');
  });

  it('flattens a member table into a space separated list', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'create',
        table: VLANPOL,
        mkey: 'VP-Multi',
        after: { fortilink: 'fortilink', 'allowed-vlans': [{ 'vlan-name': 'VL10' }, { 'vlan-name': 'VL20' }] },
        label: 'x',
      },
    ]);
    expect(cli).toContain('set allowed-vlans "VL10" "VL20"');
  });

  it('nests a rule inside its policy and closes both blocks', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'create',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R-New' },
        after: { mac: 'aa:bb:cc:dd:ee:ff', 'vlan-policy': 'VP-Clients' },
        label: 'x',
      },
    ]);
    expect(cli).toBe(
      [
        'config switch-controller dynamic-port-policy',
        '    edit "DPP-Access"',
        '        config policy',
        '            edit "R-New"',
        '                set mac "aa:bb:cc:dd:ee:ff"',
        '                set vlan-policy "VP-Clients"',
        '            next',
        '        end',
        '    next',
        'end',
        '',
      ].join('\n')
    );
  });

  it('renders a reorder as a move, not as a rewrite', () => {
    const cli = opsToCli([
      {
        id: '1',
        kind: 'move',
        table: DPP,
        mkey: 'DPP-Access',
        child: { table: 'policy', mkey: 'R-New' },
        move: { position: 'before', ref: 'R99-Catch-All' },
        label: 'x',
      },
    ]);
    expect(cli).toContain('move "R-New" before "R99-Catch-All"');
    expect(cli).not.toContain('set ');
  });

  it('renders a delete without an edit block', () => {
    const cli = opsToCli([{ id: '1', kind: 'delete', table: VLANPOL, mkey: 'VP-Old', before: { vlan: 'X' }, label: 'x' }]);
    expect(cli).toContain('delete "VP-Old"');
    expect(cli).not.toContain('edit "VP-Old"');
  });

  it('groups consecutive rules of the same policy into one config block', () => {
    const mk = (name) => ({
      id: name,
      kind: 'create',
      table: DPP,
      mkey: 'DPP-Access',
      child: { table: 'policy', mkey: name },
      after: { mac: 'aa:bb:cc:dd:ee:ff' },
      label: 'x',
    });
    const cli = opsToCli([mk('R1'), mk('R2')]);
    expect(cli.match(/config switch-controller dynamic-port-policy/g)).toHaveLength(1);
    expect(cli.match(/config policy/g)).toHaveLength(1);
    expect(cli).toContain('edit "R1"');
    expect(cli).toContain('edit "R2"');
  });

  it('returns nothing for an empty changeset', () => {
    expect(opsToCli([])).toBe('');
  });
});
