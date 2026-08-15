// ---------------------------------------------------------------------------
// Snapshots.
//
// Der Revert im Drawer gilt nur, solange die Seite offen ist. Ein Stand auf der
// Platte, aufgenommen unmittelbar vor jedem Apply, macht daraus ein Rollback,
// das auch Tage spaeter noch funktioniert.
//
// Wiederhergestellt wird nicht durch Zurueckschreiben, sondern durch einen
// Vergleich, der einen gewoehnlichen Changeset erzeugt – mit Diff, CLI-Vorschau
// und Konflikterkennung wie bei jeder anderen Aenderung.
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeConfig } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLNS_DATA_DIR || join(here, 'data');
const DIR = join(DATA_DIR, 'snapshots');

/** Wie viele Staende je Verbindung aufgehoben werden. */
const KEEP = Number(process.env.FLNS_SNAPSHOT_KEEP || 40);

/** Dateinamen duerfen nicht aus fremden Zeichen entstehen. */
const slug = (v) =>
  String(v ?? 'unknown')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unknown';

function ensureDir() {
  mkdirSync(DIR, { recursive: true });
}

/**
 * Legt einen Stand ab.
 * @param {object} config Buendel aus readConfig()
 * @param {{host:string, vdom:string, reason:string, note?:string}} meta
 */
export function saveSnapshot(config, meta) {
  try {
    ensureDir();
    const scope = `${slug(meta.host)}_${slug(meta.vdom)}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(DIR, `${scope}__${stamp}__${slug(meta.reason)}.json`);
    writeFileSync(file, JSON.stringify({ ...meta, config }), 'utf8');
    prune(scope);
    return file;
  } catch (err) {
    // Ein fehlender Snapshot darf den Apply nicht verhindern – aber er wird
    // gemeldet, damit niemand von einem Rollback ausgeht, das es nicht gibt.
    console.warn('[flns] Could not write a snapshot:', err.message);
    return null;
  }
}

function prune(scope) {
  const mine = readdirSync(DIR)
    .filter((f) => f.startsWith(`${scope}__`) && f.endsWith('.json'))
    .sort();
  for (const f of mine.slice(0, Math.max(0, mine.length - KEEP))) {
    try {
      rmSync(join(DIR, f));
    } catch {
      /* naechster Lauf versucht es erneut */
    }
  }
}

/** Alle Staende einer Verbindung, neueste zuerst. */
export function listSnapshots(host, vdom) {
  try {
    if (!existsSync(DIR)) return [];
    const scope = `${slug(host)}_${slug(vdom)}`;
    return readdirSync(DIR)
      .filter((f) => f.startsWith(`${scope}__`) && f.endsWith('.json'))
      .sort()
      .reverse()
      .map((f) => {
        try {
          const raw = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
          return {
            id: f.replace(/\.json$/, ''),
            at: raw.capturedAt ?? raw.config?.capturedAt ?? null,
            reason: raw.reason ?? 'manual',
            note: raw.note ?? null,
            host: raw.host,
            vdom: raw.vdom,
            summary: summarizeConfig(raw.config ?? {}),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[flns] Could not list snapshots:', err.message);
    return [];
  }
}

/** Ein einzelner Stand samt Konfiguration. */
export function readSnapshot(id) {
  // Kein Verzeichniswechsel ueber praeparierte Namen.
  if (!/^[A-Za-z0-9._-]+$/.test(String(id))) return null;
  const file = join(DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[flns] Could not read snapshot:', err.message);
    return null;
  }
}

export function deleteSnapshot(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(id))) return false;
  const file = join(DIR, `${id}.json`);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export { DIR as SNAPSHOT_DIR };
