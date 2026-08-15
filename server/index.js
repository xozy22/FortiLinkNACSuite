// ---------------------------------------------------------------------------
// FortiLink NAC Suite – Backend.
//
// Haelt Token und TLS-Entscheidung serverseitig, buendelt die Lesezugriffe zu
// wenigen Endpunkten fuer das Frontend und ist die einzige Stelle, die
// schreibend auf die FortiGate zugreift.
// ---------------------------------------------------------------------------
import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callFgt, testConnection, normalizeHost, FortiGateError } from './fortigate.js';
import { listConnections, getConnection, createConnection, updateConnection, deleteConnection, toPublic } from './store.js';
import { getSchema } from './schema.js';
import { createDemoStore } from './demo.js';
import { buildInventory } from './inventory.js';
import { validateOps, applyOps, revertOps, orderOps } from './changeset.js';
import { opsToCli } from './cli.js';
import {
  checkBindSafety,
  checkPassword,
  clearSession,
  isAuthed,
  issueSession,
  passwordRequired,
  readSession,
} from './session.js';

const here = dirname(fileURLToPath(import.meta.url));
// Bewusst FLNS_PORT und nicht PORT: Im Dev-Betrieb belegt der Vite-Server das
// generische PORT, und beide wuerden sonst um denselben Port konkurrieren.
const PORT = Number(process.env.FLNS_PORT || 4100);
const BIND = process.env.FLNS_BIND || '127.0.0.1';

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Zugangsschranke. Alles unter /api ausser Health und Login setzt eine
// angemeldete Sitzung voraus, sobald ein App-Passwort konfiguriert ist – auch
// die Verwaltung der Verbindungsprofile, denn wer die erreicht, kann sich mit
// einem gespeicherten Profil verbinden und auf der FortiGate schreiben.
// ---------------------------------------------------------------------------
const OPEN_ROUTES = new Set(['/api/health', '/api/login', '/api/auth']);

app.use('/api', (req, res, next) => {
  if (OPEN_ROUTES.has(req.path) || OPEN_ROUTES.has(`/api${req.path}`)) return next();
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Authentication required', hint: 'Sign in to the app first.', authRequired: true });
});

app.get('/api/auth', (req, res) => {
  res.json({ required: passwordRequired(), authed: isAuthed(req) });
});

app.post('/api/login', (req, res) => {
  if (!passwordRequired()) return res.json({ authed: true, required: false });
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  // Eine bestehende Verbindung bleibt erhalten, nur das Auth-Flag kommt dazu.
  const prev = readSession(req) ?? {};
  issueSession(res, { cid: prev.cid ?? null, adhoc: prev.adhoc ?? null, authed: true });
  res.json({ authed: true, required: true });
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ authed: false });
});

// ---------------------------------------------------------------------------
// Sessions.
//
// Das Cookie nennt nur das Verbindungsprofil; der Token wird pro Request aus dem
// Profilspeicher geholt. Nur Ad-hoc-Verbindungen (Host und Token direkt
// eingegeben, nicht gespeichert) und der Demo-Mock leben im Speicher – die sind
// nach einem Neustart erwartungsgemaess weg.
// ---------------------------------------------------------------------------
/** @type {Map<string, any>} conn-Objekte fuer Ad-hoc-Verbindungen und Demo */
const ephemeral = new Map();
/** @type {Map<string, any>} zwischengespeicherte Geraeteinfos je Profil */
const infoCache = new Map();
/** Aus .env vorkonfigurierte Verbindung, gilt ohne Cookie. */
let envConn = null;

/** Baut aus dem Cookie das vollstaendige Verbindungsobjekt. */
function getSession(req) {
  const payload = readSession(req);

  if (payload?.adhoc && ephemeral.has(payload.adhoc)) {
    return { ...ephemeral.get(payload.adhoc), sid: payload.adhoc };
  }

  if (payload?.cid) {
    const p = getConnection(payload.cid);
    if (p) {
      return {
        host: p.host,
        apiKey: p.apiKey,
        vdom: p.vdom,
        verifyTls: p.verifyTls,
        readOnly: p.readOnly,
        demo: p.host.toLowerCase() === 'demo',
        demoStore: p.host.toLowerCase() === 'demo' ? demoStoreFor(p.id) : undefined,
        info: infoCache.get(p.id) ?? null,
        connectionId: p.id,
        connectionName: p.name,
        sid: p.id,
      };
    }
  }

  // Vorkonfigurierte Verbindung aus .env gilt, solange der Client keine eigene hat.
  if (envConn && !payload?.cid && !payload?.adhoc) return { ...envConn, sid: 'env-default' };
  return null;
}

/** Demo-Stores pro Profil, damit Aenderungen nicht zwischen Profilen ueberlaufen. */
function demoStoreFor(key) {
  const k = `demo:${key}`;
  if (!ephemeral.has(k)) ephemeral.set(k, createDemoStore());
  return ephemeral.get(k);
}

function requireSession(req, res) {
  const s = getSession(req);
  if (!s) {
    res.status(401).json({ error: 'Not connected', hint: 'Connect to a FortiGate first.' });
    return null;
  }
  return s;
}

/**
 * Startet eine Session. Profile werden ueber ihre ID referenziert und
 * ueberstehen damit einen Neustart; Ad-hoc-Verbindungen bekommen einen
 * Speicherplatz, der das nicht tut.
 */
function startSession(res, conn) {
  if (conn.connectionId) {
    if (conn.info) infoCache.set(conn.connectionId, conn.info);
    issueSession(res, { cid: conn.connectionId, authed: true });
    return conn.connectionId;
  }
  const sid = randomUUID();
  ephemeral.set(sid, conn);
  issueSession(res, { adhoc: sid, authed: true });
  return sid;
}

function sessionResponse(conn) {
  return {
    connected: true,
    host: conn.host,
    vdom: conn.vdom,
    verifyTls: conn.verifyTls,
    readOnly: !!conn.readOnly,
    demo: !!conn.demo,
    info: conn.info ?? null,
    connectionId: conn.connectionId ?? null,
    connectionName: conn.connectionName ?? null,
  };
}

/** Einheitlicher API-Aufruf – im Demo-Modus gegen den Mock, sonst gegen die FortiGate. */
function apiFor(sess) {
  if (sess.demo) return (path, opts = {}) => sess.demoStore.call(path, opts);
  return (path, opts = {}) => callFgt(sess, path, opts);
}

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

async function connectWith(res, { host, apiKey, vdom, verifyTls, readOnly, connectionId = null, connectionName = null }) {
  const normalized = normalizeHost(host);

  if (normalized.toLowerCase() === 'demo') {
    const demoStore = createDemoStore();
    const conn = {
      host: 'demo',
      apiKey: 'demo',
      vdom: vdom || 'root',
      verifyTls: false,
      readOnly: !!readOnly,
      demo: true,
      demoStore,
      info: demoStore.info,
      connectionId,
      connectionName: connectionName ?? 'Demo FortiGate',
    };
    startSession(res, conn);
    return res.json(sessionResponse(conn));
  }

  if (!apiKey) return res.status(400).json({ error: 'An API token is required.' });

  const conn = {
    host: normalized,
    apiKey,
    vdom: (vdom || 'root').trim(),
    verifyTls: !!verifyTls,
    readOnly: readOnly !== false,
    demo: false,
    info: null,
    connectionId,
    connectionName,
  };

  try {
    conn.info = await testConnection(conn);
  } catch (err) {
    const e = err instanceof FortiGateError ? err : new FortiGateError(err.message);
    return res.status(e.status === 401 ? 401 : 502).json(e.toJSON());
  }

  startSession(res, conn);
  return res.json(sessionResponse(conn));
}

app.post('/api/connect', (req, res) => connectWith(res, req.body ?? {}));

app.post('/api/connections/:id/connect', (req, res) => {
  const c = getConnection(req.params.id);
  if (!c) return res.status(404).json({ error: 'Connection profile not found' });
  return connectWith(res, { ...c, connectionId: c.id, connectionName: c.name });
});

app.post('/api/disconnect', (req, res) => {
  const payload = readSession(req);
  if (payload?.adhoc) ephemeral.delete(payload.adhoc);
  envConn = null; // eine ausdrueckliche Abmeldung soll die .env-Verbindung nicht sofort ersetzen
  // Angemeldet bleiben, nur die FortiGate-Verbindung loesen.
  issueSession(res, { authed: true });
  res.json({ connected: false });
});

app.get('/api/session', async (req, res) => {
  const s = getSession(req);
  if (!s) return res.json({ connected: false, authRequired: passwordRequired() });

  // Nach einem Neustart lebt die Session weiter, die Geraeteinfo aber nicht –
  // einmal nachladen, damit Host und Version im Kopf wieder stimmen.
  if (!s.info && s.connectionId) {
    try {
      s.info = s.demo ? s.demoStore.info : await testConnection(s);
      infoCache.set(s.connectionId, s.info);
    } catch {
      /* Verbindung gerade nicht erreichbar – die Seite zeigt das beim ersten Abruf */
    }
  }
  res.json(sessionResponse(s));
});

// --- Profile ---------------------------------------------------------------

app.get('/api/connections', (_req, res) => res.json(listConnections()));

app.post('/api/connections', (req, res) => {
  try {
    res.status(201).json(toPublic(createConnection(req.body ?? {})));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/connections/:id', (req, res) => {
  const c = updateConnection(req.params.id, req.body ?? {});
  if (!c) return res.status(404).json({ error: 'Connection profile not found' });
  res.json(toPublic(c));
});

app.delete('/api/connections/:id', (req, res) => {
  if (!deleteConnection(req.params.id)) return res.status(404).json({ error: 'Connection profile not found' });
  res.status(204).end();
});

/** Verbindungstest ohne Session zu starten – fuer das Profilformular. */
app.post('/api/connections/test', async (req, res) => {
  const { host, apiKey, vdom, verifyTls, id } = req.body ?? {};
  const stored = id ? getConnection(id) : null;
  const conn = {
    host: normalizeHost(host || stored?.host),
    apiKey: apiKey || stored?.apiKey,
    vdom: vdom ?? stored?.vdom ?? 'root',
    verifyTls: verifyTls ?? stored?.verifyTls ?? false,
  };
  if (conn.host?.toLowerCase() === 'demo') return res.json({ ok: true, info: createDemoStore().info });
  if (!conn.host || !conn.apiKey) return res.status(400).json({ error: 'Host and API token are required.' });
  try {
    res.json({ ok: true, info: await testConnection(conn) });
  } catch (err) {
    const e = err instanceof FortiGateError ? err : new FortiGateError(err.message);
    res.status(200).json({ ok: false, ...e.toJSON() });
  }
});

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

app.get('/api/schema', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  try {
    res.json(await getSchema(s));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  try {
    res.json(await buildInventory(apiFor(s)));
  } catch (err) {
    sendError(res, err);
  }
});

/** Tabellen, die gelesen werden duerfen, mit optionaler Feldbegrenzung. */
const READ_TABLES = {
  'switch-controller/dynamic-port-policy': {},
  'switch-controller/vlan-policy': {},
  'switch-controller/lldp-profile': { format: 'name' },
  'switch-controller/switch-interface-tag': { format: 'name' },
  'switch-controller.qos/qos-policy': { format: 'name' },
  'switch-controller.security-policy/802-1X': { format: 'name|security-mode' },
  'switch-controller/managed-switch': {},
  // "fortilink" ist ein eigenes Feld, kein type – ohne es laesst sich die
  // FortiLink-Schnittstelle nicht erkennen (type ist dort physical/aggregate).
  'system/interface': {
    format: 'name|type|vlanid|interface|ip|status|alias|description|fortilink|role|switch-controller-feature',
  },
};

/** Ein Bundle mit allem, was Dropdowns und Editoren brauchen – ein Roundtrip. */
app.get('/api/refdata', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const call = apiFor(s);

  const keys = Object.keys(READ_TABLES);
  const settled = await Promise.all(
    keys.map(async (k) => {
      const opts = READ_TABLES[k].format ? { query: { format: READ_TABLES[k].format } } : {};
      try {
        const r = await call(`cmdb/${k}`, opts);
        if (!r.ok) return [k, { error: describeHttp(r), status: r.status, results: [] }];
        return [k, { results: r.data?.results ?? [] }];
      } catch (e) {
        return [k, { error: e.message, results: [] }];
      }
    })
  );

  const out = Object.fromEntries(settled);

  // Kapazitaets-/Limit-Info fuer das Dashboard
  try {
    const stats = await call('monitor/switch-controller/nac-device/stats');
    out._nacStats = stats.ok ? stats.data?.results ?? null : null;
  } catch {
    out._nacStats = null;
  }

  try {
    const known = await call('monitor/switch-controller/known-nac-device-criteria-list');
    out._knownCriteria = known.ok ? known.data?.results ?? [] : [];
  } catch {
    out._knownCriteria = [];
  }

  // Live-Portzustand. Die CMDB kennt nur den administrativen Zustand
  // (ports.status) – ob der Link wirklich steht, sagt nur der Monitor.
  out._portStatus = await readPortStatus(call);

  res.json(out);
});

/**
 * Liest den operativen Portzustand und indiziert ihn als "switchId|portName".
 * Faellt der Endpunkt aus, bleibt die Karte leer – die Seite zeigt dann
 * schlicht keinen Link-Zustand an, statt zu raten.
 */
async function readPortStatus(call) {
  try {
    const r = await call('monitor/switch-controller/managed-switch/status');
    if (!r.ok) return {};
    const switches = Array.isArray(r.data?.results) ? r.data.results : [];
    const out = {};
    for (const sw of switches) {
      const id = sw['switch-id'] ?? sw.switch_id ?? sw.serial;
      if (!id) continue;
      for (const p of sw.ports ?? []) {
        if (!p.interface) continue;
        out[`${id}|${p.interface}`] = {
          link: String(p.status ?? '').toLowerCase(),
          speed: Number.isFinite(p.speed) ? p.speed : null,
          duplex: p.duplex ?? null,
          poeStatus: p.poe_status ?? null,
          poeCapable: p.poe_capable === true,
          portPower: Number.isFinite(p.port_power) ? p.port_power : null,
          powerStatus: Number.isFinite(p.power_status) ? p.power_status : null,
          stp: p.stp_status ?? null,
          isFortiLink: p.fortilink_port === true,
          islPeer: p.isl_peer_device_name || null,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Einzelne Tabelle frisch lesen (nach einem Apply). */
app.get('/api/objects/*', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const table = req.params[0];
  if (!(table in READ_TABLES)) return res.status(400).json({ error: `Reading ${table} is not allowed.` });
  try {
    const cfg = READ_TABLES[table];
    const r = await apiFor(s)(`cmdb/${table}`, cfg.format ? { query: { format: cfg.format } } : {});
    if (!r.ok) return res.status(r.status).json({ error: describeHttp(r) });
    res.json({ results: r.data?.results ?? [] });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Changeset
// ---------------------------------------------------------------------------

/** Aktuellen Bestand fuer die Validierung einsammeln. */
async function loadExisting(call) {
  const keys = Object.keys(READ_TABLES);
  const pairs = await Promise.all(
    keys.map(async (k) => {
      try {
        const cfg = READ_TABLES[k];
        const r = await call(`cmdb/${k}`, cfg.format ? { query: { format: cfg.format } } : {});
        return [k, r.ok ? r.data?.results ?? [] : []];
      } catch {
        return [k, []];
      }
    })
  );
  return Object.fromEntries(pairs);
}

function normalizeOps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((op, i) => ({
    id: op.id || `op-${i}`,
    kind: op.kind,
    table: op.table,
    mkey: op.mkey,
    idField: op.idField || (op.table === 'switch-controller/managed-switch' ? 'switch-id' : 'name'),
    child: op.child
      ? { table: op.child.table, mkey: op.child.mkey, idField: op.child.idField || (op.child.table === 'ports' ? 'port-name' : 'name') }
      : null,
    before: op.before ?? null,
    after: op.after ?? null,
    move: op.move ?? null,
    label: op.label || `${op.kind} ${op.table} ${op.mkey}`,
  }));
}

app.post('/api/changeset/validate', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const ops = normalizeOps(req.body?.ops);
  try {
    const [schema, existing] = await Promise.all([getSchema(s), loadExisting(apiFor(s))]);
    const { errors, warnings } = validateOps(ops, { schema, existing, readOnly: !!s.readOnly });
    res.json({ errors, warnings, ordered: orderOps(ops).map((o) => o.id), cli: opsToCli(orderOps(ops)) });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/changeset/cli', (req, res) => {
  const ops = normalizeOps(req.body?.ops);
  res.json({ cli: opsToCli(orderOps(ops)) });
});

app.post('/api/changeset/apply', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  if (s.readOnly) {
    return res.status(403).json({
      error: 'This connection is read-only.',
      hint: 'Turn off read-only on the connection profile and reconnect to apply changes.',
    });
  }

  const ops = normalizeOps(req.body?.ops);
  if (!ops.length) return res.status(400).json({ error: 'No operations submitted.' });

  const call = apiFor(s);
  try {
    const [schema, existing] = await Promise.all([getSchema(s), loadExisting(call)]);
    const { errors } = validateOps(ops, { schema, existing, readOnly: false });
    if (errors.length && req.body?.force !== true) {
      return res.status(400).json({ error: 'Validation failed.', errors });
    }
    const outcome = await applyOps(call, ops, { stopOnError: req.body?.stopOnError !== false });
    res.json(outcome);
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/changeset/revert', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  if (s.readOnly) return res.status(403).json({ error: 'This connection is read-only.' });
  const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
  if (!ops.length) return res.status(400).json({ error: 'Nothing to revert.' });
  try {
    res.json(await revertOps(apiFor(s), ops));
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Port-Aktionen
// ---------------------------------------------------------------------------

app.post('/api/ports/bounce', async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  if (s.readOnly) return res.status(403).json({ error: 'This connection is read-only.' });
  const { switchId, port, duration } = req.body ?? {};
  if (!switchId || !port) return res.status(400).json({ error: 'switchId and port are required.' });
  try {
    const r = await apiFor(s)('monitor/switch-controller/managed-switch/bounce-port', {
      method: 'POST',
      body: { mkey: switchId, port, duration: Math.min(Math.max(Number(duration) || 1, 1), 5) },
    });
    if (!r.ok) return res.status(r.status).json({ error: describeHttp(r) });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// ---------------------------------------------------------------------------
// Sonstiges
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

function describeHttp(r) {
  const d = r.data ?? {};
  return d.cli_error || (typeof d.error === 'string' ? d.error : null) || `FortiGate returned HTTP ${r.status}`;
}

function sendError(res, err) {
  if (err instanceof FortiGateError) return res.status(err.status >= 400 ? err.status : 502).json(err.toJSON());
  console.error('[flns]', err);
  return res.status(500).json({ error: err.message || 'Internal error' });
}

// Frontend ausliefern, sofern gebaut
const distDir = join(here, '..', 'web', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')));
}

// Optionale Vorbelegung aus der Umgebung
function bootstrapEnvSession() {
  if (!process.env.FGT_HOST) return;
  const host = normalizeHost(process.env.FGT_HOST);
  const demo = host.toLowerCase() === 'demo';
  envConn = {
    host,
    apiKey: process.env.FGT_API_KEY ?? 'demo',
    vdom: process.env.FGT_VDOM || 'root',
    verifyTls: process.env.FGT_VERIFY_TLS === 'true',
    readOnly: process.env.FGT_READ_ONLY !== 'false',
    demo,
    demoStore: demo ? createDemoStore() : undefined,
    info: null,
    connectionId: null,
    connectionName: 'Preconfigured',
  };
  console.log(`[flns] Preconfigured connection to ${host} loaded.`);
}
bootstrapEnvSession();

// Ohne Passwort nicht auf einer von aussen erreichbaren Adresse lauschen.
const safety = checkBindSafety(BIND);
if (!safety.ok) {
  console.error(`\n[flns] ${safety.message}`);
  process.exit(1);
}

app.listen(PORT, BIND, () => {
  const shown = BIND === '0.0.0.0' || BIND === '::' ? 'localhost' : BIND;
  console.log(`[flns] FortiLink NAC Suite backend listening on http://${shown}:${PORT} (bound to ${BIND})`);
  if (passwordRequired()) console.log('[flns] App password is set – the UI asks for it before anything else.');
  else console.log('[flns] No app password set (FLNS_APP_PASSWORD) – access is open to whoever reaches this port.');
  if (!existsSync(distDir)) console.log('[flns] No frontend build found – run the Vite dev server for the UI.');
});
