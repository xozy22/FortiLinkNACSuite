// ---------------------------------------------------------------------------
// Verbindungsprofile. Liegen als JSON unter server/data/connections.json.
// Der API-Token verlaesst den Server nie – toPublic() filtert ihn heraus.
//
// Ist FLNS_SECRET gesetzt, werden Tokens mit AES-256-GCM verschluesselt
// abgelegt. Ohne Secret landen sie im Klartext (mit Warnung beim Start), damit
// die App auch ohne Zusatzkonfiguration laeuft.
// ---------------------------------------------------------------------------
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLNS_DATA_DIR || join(here, 'data');
const FILE = join(DATA_DIR, 'connections.json');

const SECRET = process.env.FLNS_SECRET || null;
const KEY = SECRET ? scryptSync(SECRET, 'fortilink-nac-suite', 32) : null;

if (!SECRET) {
  console.warn(
    '[flns] FLNS_SECRET is not set – API tokens are stored in plain text in ' +
      FILE +
      '. Set FLNS_SECRET to encrypt them at rest.'
  );
}

/** @typedef {{id:string,name:string,host:string,apiKey:string,vdom:string,verifyTls:boolean,readOnly:boolean,createdAt:string}} Connection */

/** @type {Connection[]} */
let connections = [];

function encrypt(plain) {
  if (!KEY || !plain) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('enc:v1:')) return stored;
  if (!KEY) {
    console.warn('[flns] Found an encrypted token but FLNS_SECRET is not set – this profile cannot be used.');
    return '';
  }
  try {
    const [, , ivB64, tagB64, dataB64] = stored.split(':');
    const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  } catch {
    console.warn('[flns] Could not decrypt a stored token – wrong FLNS_SECRET?');
    return '';
  }
}

function load() {
  try {
    if (!existsSync(FILE)) return [];
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw?.connections ?? [];
    return list.map(normalize).filter(Boolean);
  } catch (err) {
    console.error('[flns] Could not read connections.json:', err.message);
    return [];
  }
}

function persist() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const payload = connections.map((c) => ({ ...c, apiKey: encrypt(c.apiKey) }));
    writeFileSync(FILE, JSON.stringify(payload, null, 2), 'utf8');
    try {
      chmodSync(FILE, 0o600); // unter Windows weitgehend wirkungslos, unter Linux relevant
    } catch {
      /* ignorieren */
    }
  } catch (err) {
    console.error('[flns] Could not write connections.json:', err.message);
  }
}

function normalize(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    id: c.id || randomUUID(),
    name: String(c.name || c.host || 'Unnamed').slice(0, 80),
    host: String(c.host || '').trim(),
    apiKey: decrypt(c.apiKey ?? ''),
    vdom: String(c.vdom ?? 'root').trim(),
    verifyTls: !!c.verifyTls,
    readOnly: c.readOnly !== false, // Default: read-only, bewusst konservativ
    createdAt: c.createdAt || new Date().toISOString(),
  };
}

connections = load();

/** Profil ohne Token – alles was der Browser sehen darf. */
export function toPublic(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    host: c.host,
    vdom: c.vdom,
    verifyTls: c.verifyTls,
    readOnly: c.readOnly,
    hasToken: !!c.apiKey,
    createdAt: c.createdAt,
  };
}

export function listConnections() {
  return connections.map(toPublic);
}

export function getConnection(id) {
  return connections.find((c) => c.id === id) || null;
}

export function createConnection(input) {
  const c = normalize({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });
  if (!c.host) throw new Error('host is required');
  if (!c.apiKey && c.host.toLowerCase() !== 'demo') throw new Error('apiKey is required');
  connections.push(c);
  persist();
  return c;
}

export function updateConnection(id, patch) {
  const i = connections.findIndex((c) => c.id === id);
  if (i === -1) return null;
  const current = connections[i];
  // Leerer apiKey im Patch = Token unveraendert lassen.
  const apiKey = patch.apiKey ? patch.apiKey : current.apiKey;
  connections[i] = normalize({ ...current, ...patch, apiKey, id: current.id, createdAt: current.createdAt });
  persist();
  return connections[i];
}

export function deleteConnection(id) {
  const before = connections.length;
  connections = connections.filter((c) => c.id !== id);
  if (connections.length === before) return false;
  persist();
  return true;
}

export { FILE as CONNECTIONS_FILE };
