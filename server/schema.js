// ---------------------------------------------------------------------------
// CMDB-Schema-Versorgung.
//
// Die Validierung im Frontend wird aus dem FortiOS-Schema abgeleitet statt
// handgeschrieben – so stimmen Feldlaengen (z.B. hw-vendor = 15 Zeichen),
// Options-Listen und Wertebereiche immer mit der Zielversion ueberein.
//
// Bevorzugt wird das Schema live von der FortiGate geholt. Schlaegt das fehl
// (fehlende Berechtigung, alte Firmware), greift die mitgelieferte api-doku.json.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callFgt } from './fortigate.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Der mitgelieferte Fallback enthaelt nur die sieben Tabellen, die die Suite
 * anfasst (rund 33 KB statt 4 MB Rohdump). Neu erzeugen mit
 * `node scripts/trim-schema.mjs <dump>`.
 */
const LOCAL_SCHEMA = process.env.FLNS_SCHEMA_FILE || join(here, 'schema-fallback.json');

/** Tabellen, die die Suite kennt. Alles andere wird verworfen. */
export const TABLES = {
  'switch-controller/dynamic-port-policy': { path: 'switch-controller', name: 'dynamic-port-policy' },
  'switch-controller/vlan-policy': { path: 'switch-controller', name: 'vlan-policy' },
  'switch-controller/lldp-profile': { path: 'switch-controller', name: 'lldp-profile' },
  'switch-controller/switch-interface-tag': { path: 'switch-controller', name: 'switch-interface-tag' },
  'switch-controller.qos/qos-policy': { path: 'switch-controller.qos', name: 'qos-policy' },
  'switch-controller.security-policy/802-1X': { path: 'switch-controller.security-policy', name: '802-1X' },
  'switch-controller/managed-switch': { path: 'switch-controller', name: 'managed-switch', trim: 'managed-switch' },
};

// Von managed-switch braucht die Suite nur wenige Felder – der volle Baum waere
// mehrere hundert Kilobyte.
const MANAGED_SWITCH_KEEP = ['switch-id', 'sn', 'description', 'type', 'ports'];
const MANAGED_SWITCH_PORT_KEEP = [
  'port-name',
  'description',
  'status',
  'access-mode',
  'port-policy',
  'matched-dpp-policy',
  'matched-dpp-intf-tags',
  'interface-tags',
  'vlan',
  'allowed-vlans',
  'untagged-vlans',
  'allowed-vlans-all',
  'poe-status',
  'lldp-profile',
  'qos-policy',
  'port-security-policy',
  'learning-limit',
  'sticky-mac',
];

let localCache = null;
/** @type {Map<string, {at:number, schema:any}>} */
const liveCache = new Map();
const LIVE_TTL = 10 * 60 * 1000;

function readLocal() {
  if (localCache) return localCache;
  if (!existsSync(LOCAL_SCHEMA)) {
    console.warn(`[flns] Local schema file not found at ${LOCAL_SCHEMA} – validation will be limited.`);
    localCache = { results: [], version: null, build: null };
    return localCache;
  }
  try {
    localCache = JSON.parse(readFileSync(LOCAL_SCHEMA, 'utf8'));
  } catch (err) {
    console.error('[flns] Could not parse the local schema file:', err.message);
    localCache = { results: [], version: null, build: null };
  }
  return localCache;
}

/** Baut aus einem Schema-Dump die getrimmte Tabellen-Map. */
function extract(dump) {
  const out = {};
  const results = Array.isArray(dump?.results) ? dump.results : [];
  for (const [key, def] of Object.entries(TABLES)) {
    const entry = results.find((r) => r.path === def.path && r.name === def.name);
    if (!entry?.schema) continue;
    out[key] = def.trim === 'managed-switch' ? trimManagedSwitch(entry.schema) : entry.schema;
  }
  return out;
}

function trimManagedSwitch(schema) {
  const children = {};
  for (const k of MANAGED_SWITCH_KEEP) {
    const c = schema.children?.[k];
    if (!c) continue;
    if (k === 'ports') {
      const pc = {};
      for (const pk of MANAGED_SWITCH_PORT_KEEP) {
        if (c.children?.[pk]) pc[pk] = c.children[pk];
      }
      children[k] = { ...c, children: pc };
    } else {
      children[k] = c;
    }
  }
  return { ...schema, children };
}

/**
 * Liefert das Schema fuer eine Verbindung. Live bevorzugt, sonst lokal.
 * @returns {Promise<{source:'live'|'local', version:string|null, build:number|null, tables:object}>}
 */
export async function getSchema(conn) {
  const cacheKey = `${conn?.host}|${conn?.vdom}`;
  const hit = liveCache.get(cacheKey);
  if (hit && Date.now() - hit.at < LIVE_TTL) return hit.schema;

  if (conn && conn.host && conn.host.toLowerCase() !== 'demo') {
    try {
      const r = await callFgt(conn, 'cmdb/', { query: { action: 'schema' }, timeout: 40_000 });
      if (r.ok && Array.isArray(r.data?.results) && r.data.results.length) {
        const schema = {
          source: 'live',
          version: r.data.version ?? null,
          build: r.data.build ?? null,
          tables: extract(r.data),
        };
        if (Object.keys(schema.tables).length) {
          liveCache.set(cacheKey, { at: Date.now(), schema });
          return schema;
        }
      }
    } catch (err) {
      console.warn('[flns] Live schema fetch failed, falling back to the bundled dump:', err.message);
    }
  }

  const dump = readLocal();
  const schema = {
    source: 'local',
    version: dump.version ?? null,
    build: dump.build ?? null,
    tables: extract(dump),
  };
  liveCache.set(cacheKey, { at: Date.now(), schema });
  return schema;
}

/** Cache leeren, z.B. nach einem Verbindungswechsel. */
export function clearSchemaCache() {
  liveCache.clear();
}
