// Der Join ist die Grundlage jeder Aussage im UI. Faellt eine Quelle aus oder
// wird eine Seite uebersehen, sieht ein fehlendes Geraet genauso aus wie eines,
// das es nicht gibt – deshalb hier auch die Ausfall- und Paginierungsfaelle.
import { describe, expect, it } from 'vitest';
import { buildInventory, COVERAGE } from './inventory.js';
import { createDemoStore } from './demo.js';

const callOf = (store) => (path, opts) => store.call(path, opts);

describe('buildInventory', () => {
  it('joins identity, location and the matched rule into one asset', async () => {
    const { assets } = await buildInventory(callOf(createDemoStore()));
    const phone = assets.find((a) => a.hostname === 'FON-1001');

    expect(phone).toMatchObject({
      vendor: 'Fortinet',
      type: 'IP Phone',
      switchId: 'S248EF0000001',
      portName: 'port1',
      vlanId: 20,
      accessMode: 'dynamic',
      portPolicy: 'DPP-Access',
      matchedDpp: 'DPP-Access',
      matchedRule: 'R10-VoIP-Phones',
      coverage: COVERAGE.MATCHED,
    });
  });

  it('separates "no rule matched" from "the port is not under NAC"', async () => {
    const { assets } = await buildInventory(callOf(createDemoStore()));

    // FortiAP haengt an port13, der statisch ist
    const ap = assets.find((a) => a.hostname === 'FAP-EG-01');
    expect(ap.coverage).toBe(COVERAGE.PORT_STATIC);
    expect(ap.matchedRule).toBe('');

    // Alles an einem dynamischen Port trifft im Demo mindestens den Catch-All
    const onNac = assets.filter((a) => a.accessMode === 'dynamic');
    expect(onNac.length).toBeGreaterThan(0);
    expect(onNac.every((a) => a.coverage === COVERAGE.MATCHED)).toBe(true);
  });

  it('counts the estate the way the dashboard reports it', async () => {
    const { assets, counts } = await buildInventory(callOf(createDemoStore()));
    expect(counts.total).toBe(assets.length);
    expect(counts.matched + counts.noRule + counts.portStatic + counts.offSwitch).toBe(counts.total);
    expect(counts.online).toBe(assets.filter((a) => a.online).length);
  });

  it('reads every page instead of stopping at the first', async () => {
    const store = createDemoStore();
    const seen = [];
    const call = (path, opts) => {
      if (path === 'monitor/user/device/query') seen.push(opts?.query?.start ?? 0);
      return store.call(path, opts);
    };
    const { assets } = await buildInventory(call);

    // Der Demo-Bestand passt auf eine Seite, aber start muss gesetzt sein …
    expect(seen[0]).toBe(0);
    // … und alle Geraete muessen ankommen.
    const all = (await store.call('monitor/user/device/query')).data.results;
    expect(assets.length).toBeGreaterThanOrEqual(all.length);
  });

  it('keeps paging until a short page arrives', async () => {
    // 2500 Geraete erzwingen mehrere Seiten à 1000.
    const many = Array.from({ length: 2500 }, (_, i) => ({
      mac: `02:00:00:${String(Math.floor(i / 65536) % 256).padStart(2, '0')}:${String(Math.floor(i / 256) % 256).padStart(2, '0')}:${String(i % 256).padStart(2, '0')}`,
      hostname: `dev-${i}`,
      is_online: true,
    }));
    const starts = [];
    const call = async (path, opts = {}) => {
      if (path === 'monitor/user/device/query') {
        const start = opts.query?.start ?? 0;
        const count = opts.query?.count ?? 1000;
        starts.push(start);
        return { ok: true, status: 200, data: { results: many.slice(start, start + count) } };
      }
      return { ok: true, status: 200, data: { results: [] } };
    };

    const { assets, warnings } = await buildInventory(call);
    expect(starts).toEqual([0, 1000, 2000]);
    expect(assets).toHaveLength(2500);
    expect(warnings).toHaveLength(0);
  });

  it('says so when a source fails instead of pretending the estate is empty', async () => {
    const store = createDemoStore();
    const call = (path, opts) => {
      if (path === 'monitor/switch-controller/matched-devices') {
        return Promise.resolve({ ok: false, status: 403, data: { cli_error: 'permission denied' } });
      }
      return store.call(path, opts);
    };

    const { assets, warnings } = await buildInventory(call);
    expect(warnings.some((w) => w.source.includes('matched-devices'))).toBe(true);
    // Die uebrigen Quellen tragen weiterhin
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.matchedRule === '')).toBe(true);
  });

  it('reports a partial inventory when a later page fails', async () => {
    const call = async (path, opts = {}) => {
      if (path === 'monitor/user/device/query') {
        const start = opts.query?.start ?? 0;
        if (start === 0) {
          return {
            ok: true,
            status: 200,
            data: { results: Array.from({ length: 1000 }, (_, i) => ({ mac: `02:00:00:00:00:${String(i % 256).padStart(2, '0')}` })) },
          };
        }
        return { ok: false, status: 500, data: {} };
      }
      return { ok: true, status: 200, data: { results: [] } };
    };

    const { warnings } = await buildInventory(call);
    expect(warnings.some((w) => /incomplete/i.test(w.message))).toBe(true);
  });

  it('lists the fields this firmware actually returns', async () => {
    const { fields } = await buildInventory(callOf(createDemoStore()));
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('hardware_vendor');
    expect(keys).toContain('mac');
    // Leere Werte gelten nicht als vorhandenes Feld
    expect(fields.every((f) => f.count > 0)).toBe(true);
  });
});
