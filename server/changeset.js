// ---------------------------------------------------------------------------
// Change-Engine: Validierung, Sortierung, Apply, Revert.
//
// Grundsatz: Das Frontend schreibt nie direkt. Es liefert eine Liste von
// Operationen, die hier geprueft, in eine abhaengigkeitsgerechte Reihenfolge
// gebracht und einzeln ausgefuehrt werden. Vor jedem veraendernden Zugriff wird
// das Objekt erneut gelesen – hat es sich seit dem Snapshot geaendert, wird die
// Operation als Konflikt uebersprungen statt fremde Aenderungen zu ueberschreiben.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Op
 * @property {string} id
 * @property {'create'|'modify'|'delete'|'move'} kind
 * @property {string} table            z.B. "switch-controller/vlan-policy"
 * @property {string} mkey             Schluessel des (Eltern-)Objekts
 * @property {string} [idField]        Default "name"
 * @property {{table:string, mkey:string, idField?:string}|null} [child]
 * @property {object|null} [before]
 * @property {object|null} [after]
 * @property {{position:'before'|'after', ref:string}|null} [move]
 * @property {string} [label]
 */

const MEMBER_KEY = {
  'allowed-vlans': 'vlan-name',
  'untagged-vlans': 'vlan-name',
  'interface-tags': 'tag-name',
  severity: 'severity-num',
};

/** Tabellen, in die die Suite ueberhaupt schreiben darf. */
const WRITABLE = new Set([
  'switch-controller/dynamic-port-policy',
  'switch-controller/vlan-policy',
  'switch-controller/managed-switch',
]);

/** Ausfuehrungsreihenfolge – kleinere Zahl zuerst. */
function rank(op) {
  const t = op.table;
  const child = !!op.child;
  if (op.kind === 'create') {
    if (t === 'switch-controller/vlan-policy') return 10;
    if (t === 'switch-controller/dynamic-port-policy') return child ? 30 : 20;
    return 40;
  }
  if (op.kind === 'modify') {
    if (t === 'switch-controller/dynamic-port-policy' && child) return 31;
    if (t === 'switch-controller/vlan-policy') return 35;
    if (t === 'switch-controller/dynamic-port-policy') return 36;
    if (t === 'switch-controller/managed-switch') return 55;
    return 50;
  }
  if (op.kind === 'move') return 45;
  // delete: in umgekehrter Abhaengigkeitsrichtung
  if (t === 'switch-controller/managed-switch') return 58;
  if (t === 'switch-controller/dynamic-port-policy') return child ? 60 : 70;
  if (t === 'switch-controller/vlan-policy') return 80;
  return 75;
}

/** Stabil nach rank sortieren, Eingabereihenfolge sonst beibehalten. */
export function orderOps(ops) {
  return ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => rank(a.op) - rank(b.op) || a.i - b.i)
    .map((e) => e.op);
}

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

/** Findet die Schema-Definition fuer die Felder einer Operation. */
function schemaFor(schema, op) {
  const table = schema?.tables?.[op.table];
  if (!table) return null;
  if (!op.child) return table;
  return table.children?.[op.child.table] ?? null;
}

/**
 * Prueft eine Operationsliste gegen das CMDB-Schema und den aktuellen Bestand.
 * @returns {{errors:Array, warnings:Array}}
 */
export function validateOps(ops, { schema, existing = {}, readOnly = false } = {}) {
  const errors = [];
  const warnings = [];

  if (readOnly) {
    errors.push({ opId: null, message: 'This connection is read-only. Enable write access on the connection profile to apply changes.' });
    return { errors, warnings };
  }

  const err = (op, field, message) => errors.push({ opId: op.id, field, message, label: op.label });
  const warn = (op, field, message) => warnings.push({ opId: op.id, field, message, label: op.label });

  // Namen, die im Lauf des Changesets entstehen, gelten als vorhanden.
  const created = { 'switch-controller/vlan-policy': new Set(), 'switch-controller/dynamic-port-policy': new Set() };
  const deleted = { 'switch-controller/vlan-policy': new Set(), 'switch-controller/dynamic-port-policy': new Set() };
  for (const op of ops) {
    if (op.child) continue;
    if (op.kind === 'create' && created[op.table]) created[op.table].add(op.mkey);
    if (op.kind === 'delete' && deleted[op.table]) deleted[op.table].add(op.mkey);
  }

  const nameExists = (table, name) => {
    if (!name) return false;
    if (created[table]?.has(name)) return true;
    if (deleted[table]?.has(name)) return false;
    return (existing[table] ?? []).some((e) => e.name === name);
  };

  const seen = new Set();

  for (const op of ops) {
    if (!WRITABLE.has(op.table)) {
      err(op, null, `Writing to ${op.table} is not supported by this tool.`);
      continue;
    }
    if (!op.mkey) {
      err(op, null, 'Operation has no target object.');
      continue;
    }

    // Doppelte Operationen auf dasselbe Ziel
    const sig = `${op.kind}|${op.table}|${op.mkey}|${op.child?.mkey ?? ''}`;
    if (seen.has(sig)) warn(op, null, 'Duplicate operation on the same target — the later one wins.');
    seen.add(sig);

    if (op.kind === 'move') {
      if (!op.move?.ref) err(op, null, 'Move operation has no reference entry.');
      continue;
    }
    if (op.kind === 'delete') continue;

    const def = schemaFor(schema, op);
    const after = op.after ?? {};
    if (!def) {
      warn(op, null, `No schema available for ${op.table}${op.child ? '/' + op.child.table : ''} — field validation was skipped.`);
    } else {
      validateFields(def, after, op, err, warn);
    }

    // Pflichtfeld fortilink (FortiOS quittiert das sonst mit 424)
    if (!op.child && (op.table === 'switch-controller/vlan-policy' || op.table === 'switch-controller/dynamic-port-policy')) {
      if (!after.fortilink) err(op, 'fortilink', 'A FortiLink interface is required.');
    }

    // Referenzen pruefen
    if (op.child?.table === 'policy') {
      if (after['vlan-policy'] && !nameExists('switch-controller/vlan-policy', after['vlan-policy'])) {
        err(op, 'vlan-policy', `VLAN policy "${after['vlan-policy']}" does not exist and is not created by this changeset.`);
      }
      checkRef(op, after, '802-1x', 'switch-controller.security-policy/802-1X', existing, err);
      checkRef(op, after, 'qos-policy', 'switch-controller.qos/qos-policy', existing, err);
      checkRef(op, after, 'lldp-profile', 'switch-controller/lldp-profile', existing, err);

      // Eine Regel ohne jedes Match-Kriterium greift auf alles.
      if (after.category !== 'interface-tag') {
        const hasMatch = ['mac', 'hw-vendor', 'type', 'family', 'host'].some((k) => after[k]);
        if (!hasMatch) warn(op, null, 'This rule has no match criteria and will match every device on the port.');
      } else if (!(after['interface-tags'] ?? []).length) {
        err(op, 'interface-tags', 'An interface-tag rule needs at least one tag.');
      }

      // Eine Regel ohne Action bewirkt nichts.
      const hasAction = ['vlan-policy', '802-1x', 'qos-policy', 'lldp-profile'].some((k) => after[k]);
      if (!hasAction && after['poe-reset'] !== 'enable' && after['bounce-port-link'] !== 'enable') {
        warn(op, null, 'This rule applies no action.');
      }

      if (after.mac && !isMac(after.mac)) {
        err(op, 'mac', `"${after.mac}" is not a valid MAC address (expected aa:bb:cc:dd:ee:ff).`);
      }
    }

    if (op.child?.table === 'ports') {
      if (after['access-mode'] === 'dynamic' && !after['port-policy']) {
        err(op, 'port-policy', 'A port in dynamic access mode needs a dynamic port policy assigned.');
      }
      if (after['port-policy'] && !nameExists('switch-controller/dynamic-port-policy', after['port-policy'])) {
        err(op, 'port-policy', `Dynamic port policy "${after['port-policy']}" does not exist.`);
      }
      if (after['port-policy'] && after['access-mode'] && after['access-mode'] !== 'dynamic') {
        warn(op, 'access-mode', 'A dynamic port policy only takes effect when access mode is "dynamic".');
      }
    }

    // Namenskollision beim Anlegen
    if (op.kind === 'create' && !op.child) {
      const clash = (existing[op.table] ?? []).some((e) => e.name === op.mkey);
      if (clash) err(op, 'name', `An object named "${op.mkey}" already exists.`);
    }
  }

  // Kapazitaetsgrenzen (max_table_size_vdom aus dem Schema)
  checkCapacity('switch-controller/dynamic-port-policy', ops, existing, schema, warnings);
  checkCapacity('switch-controller/vlan-policy', ops, existing, schema, warnings);

  checkReachability(ops, existing, warnings);

  return { errors, warnings };
}

/** Hat eine Regel ueberhaupt ein Match-Kriterium? Ohne eines greift sie auf alles. */
export function isCatchAll(rule) {
  if (rule?.status === 'disable') return false;
  if (rule?.category === 'interface-tag') return false;
  return !['mac', 'hw-vendor', 'type', 'family', 'host'].some((k) => rule?.[k]);
}

/**
 * Projiziert die Regelreihenfolge einer DPP nach Anwendung des Changesets.
 * Neue Regeln haengt FortiOS hinten an – das ist der haeufigste Grund dafuer,
 * dass eine frisch angelegte Regel wirkungslos bleibt.
 */
export function projectRules(dppName, existing, ops) {
  const dpp = (existing['switch-controller/dynamic-port-policy'] ?? []).find((d) => d.name === dppName);
  const list = (dpp?.policy ?? []).map((r) => ({ ...r }));

  for (const op of orderOps(ops)) {
    if (op.table !== 'switch-controller/dynamic-port-policy' || op.child?.table !== 'policy' || op.mkey !== dppName) continue;
    const name = op.child.mkey;
    const i = list.findIndex((r) => r.name === name);

    if (op.kind === 'create' && i === -1) list.push({ name, ...(op.after ?? {}) });
    else if (op.kind === 'modify' && i >= 0) list[i] = { ...list[i], ...(op.after ?? {}) };
    else if (op.kind === 'delete' && i >= 0) list.splice(i, 1);
    else if (op.kind === 'move' && i >= 0) {
      const [moved] = list.splice(i, 1);
      const j = list.findIndex((r) => r.name === op.move?.ref);
      if (j === -1) list.push(moved);
      else list.splice(op.move.position === 'before' ? j : j + 1, 0, moved);
    }
  }
  return list;
}

/**
 * Warnt vor Regeln, die nach dem Apply hinter einem Catch-All stehen wuerden.
 * FortiOS wertet die policy-Untertabelle als First-Match aus – alles hinter
 * einer kriterienlosen Regel ist toter Code.
 */
function checkReachability(ops, existing, warnings) {
  const touched = new Set(
    ops
      .filter((o) => o.table === 'switch-controller/dynamic-port-policy' && o.child?.table === 'policy')
      .map((o) => o.mkey)
  );

  for (const dppName of touched) {
    const projected = projectRules(dppName, existing, ops);
    const firstCatchAll = projected.findIndex(isCatchAll);
    if (firstCatchAll === -1) continue;

    const shadowed = projected.slice(firstCatchAll + 1).filter((r) => r.status !== 'disable');
    if (!shadowed.length) continue;

    const changedNames = new Set(
      ops
        .filter((o) => o.mkey === dppName && o.child?.table === 'policy' && o.kind !== 'delete')
        .map((o) => o.child.mkey)
    );
    const relevant = shadowed.filter((r) => changedNames.has(r.name));
    if (!relevant.length) continue;

    warnings.push({
      opId: null,
      field: null,
      message:
        `In "${dppName}", rule "${projected[firstCatchAll].name}" has no match criteria and catches every device. ` +
        `${relevant.map((r) => `"${r.name}"`).join(', ')} sit${relevant.length === 1 ? 's' : ''} after it and will never match. ` +
        `Move ${relevant.length === 1 ? 'it' : 'them'} above the catch-all.`,
    });
  }
}

function checkRef(op, after, field, table, existing, err) {
  const v = after[field];
  if (!v) return;
  const list = existing[table];
  if (!Array.isArray(list) || !list.length) return; // Referenzliste unbekannt – nicht raten
  if (!list.some((e) => e.name === v)) err(op, field, `"${v}" does not exist in ${table}.`);
}

function checkCapacity(table, ops, existing, schema, warnings) {
  const limit = schema?.tables?.[table]?.max_table_size_vdom;
  if (!limit) return;
  const current = (existing[table] ?? []).length;
  const added = ops.filter((o) => o.table === table && !o.child && o.kind === 'create').length;
  const removed = ops.filter((o) => o.table === table && !o.child && o.kind === 'delete').length;
  const next = current + added - removed;
  if (next > limit) {
    warnings.push({ opId: null, message: `${table} would hold ${next} objects, over the FortiOS limit of ${limit} per VDOM.` });
  }
}

function validateFields(def, obj, op, err, warn) {
  const children = def.children ?? {};
  for (const [k, v] of Object.entries(obj)) {
    const f = children[k];
    if (!f) {
      warn(op, k, `Unknown field "${k}" for this object — the FortiGate will likely reject it.`);
      continue;
    }
    if (v === null || v === undefined || v === '') continue;

    if (f.type === 'option' && Array.isArray(f.options)) {
      const allowed = f.options.map((o) => o.name);
      if (!allowed.includes(String(v))) err(op, k, `"${v}" is not valid for ${k}. Allowed: ${allowed.join(', ')}.`);
    } else if (f.type === 'integer') {
      const n = Number(v);
      if (!Number.isFinite(n)) err(op, k, `${k} must be a number.`);
      else if (f['min-value'] !== undefined && n < f['min-value']) err(op, k, `${k} must be at least ${f['min-value']}.`);
      else if (f['max-value'] !== undefined && n > f['max-value']) err(op, k, `${k} must be at most ${f['max-value']}.`);
    } else if (f.category === 'table') {
      const nameKey = MEMBER_KEY[k] ?? f.mkey ?? 'name';
      if (!Array.isArray(v)) {
        err(op, k, `${k} must be a list.`);
      } else {
        const inner = f.children?.[nameKey];
        const size = inner?.size;
        for (const entry of v) {
          const val = typeof entry === 'string' ? entry : entry?.[nameKey];
          if (!val) err(op, k, `An entry in ${k} has no ${nameKey}.`);
          else if (size && String(val).length > size) err(op, k, `"${val}" exceeds the ${size} character limit for ${nameKey}.`);
        }
      }
    } else if (typeof v === 'string' && f.size && v.length > f.size) {
      err(
        op,
        k,
        `${k} is ${v.length} characters, but FortiOS allows ${f.size}. Shorten the value — a prefix is enough, FortiOS matches ${k} by prefix.`
      );
    }
  }
}

function isMac(v) {
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(String(v).trim());
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function encodeKey(k) {
  return encodeURIComponent(String(k));
}

function pathFor(op) {
  const base = `cmdb/${op.table}`;
  if (!op.child) return op.kind === 'create' ? base : `${base}/${encodeKey(op.mkey)}`;
  const parent = `${base}/${encodeKey(op.mkey)}/${op.child.table}`;
  return op.kind === 'create' ? parent : `${parent}/${encodeKey(op.child.mkey)}`;
}

function methodFor(op) {
  if (op.kind === 'create') return 'POST';
  if (op.kind === 'delete') return 'DELETE';
  return 'PUT';
}

/** Liest das aktuelle Objekt (oder Kindobjekt) fuer Konflikt- und Revert-Zwecke. */
async function readCurrent(call, op) {
  const path = op.child
    ? `cmdb/${op.table}/${encodeKey(op.mkey)}/${op.child.table}/${encodeKey(op.child.mkey)}`
    : `cmdb/${op.table}/${encodeKey(op.mkey)}`;
  const r = await call(path, { method: 'GET' });
  if (!r.ok) return { found: false, value: null, status: r.status };
  const rows = r.data?.results;
  const value = Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
  return { found: !!value, value, status: r.status };
}

/**
 * Vergleicht den Snapshot mit dem Ist-Zustand.
 *
 * Verglichen wird nur, was im Snapshot tatsaechlich steht: Fehlt ein Feld dort,
 * gibt es keine Vergleichsbasis, und die Operation will es ohnehin setzen. Ein
 * vollstaendiger Snapshot (so wie das Frontend ihn aus dem gelesenen Objekt
 * uebernimmt) deckt damit jede fremde Aenderung ab, ein unvollstaendiger loest
 * aber keinen Fehlalarm aus.
 */
function conflictFields(before, current) {
  if (!before || !current) return [];
  const out = [];
  for (const k of Object.keys(before)) {
    if (k === 'q_origin_key') continue;
    const a = normalizeValue(before[k]);
    const b = normalizeValue(current[k]);
    if (a !== b) out.push({ field: k, snapshot: before[k] ?? null, current: current[k] ?? null });
  }
  return out;
}

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) {
    return JSON.stringify(
      v.map((e) => (typeof e === 'object' && e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'q_origin_key')) : e))
    );
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Body fuer Create/Modify aufbauen – Schluesselfeld muss mit hinein. */
function bodyFor(op) {
  const idField = op.child ? op.child.idField || 'name' : op.idField || 'name';
  const key = op.child ? op.child.mkey : op.mkey;
  return { [idField]: key, ...(op.after ?? {}) };
}

/**
 * Fuehrt eine Operationsliste aus.
 *
 * @param {(apiPath:string, opts?:object)=>Promise<{ok:boolean,status:number,data:any}>} call
 * @param {Op[]} ops
 * @param {{stopOnError?:boolean}} [options]
 */
export async function applyOps(call, ops, options = {}) {
  const { stopOnError = true } = options;
  const ordered = orderOps(ops);
  const results = [];
  /** Erfolgreich ausgefuehrte Ops mit ihrem Vorzustand – Basis fuer Revert. */
  const applied = [];
  let aborted = false;

  for (const op of ordered) {
    if (aborted) {
      results.push({ id: op.id, label: op.label, status: 'skipped', message: 'Skipped after an earlier failure.' });
      continue;
    }

    try {
      // --- Konflikt- und Existenzpruefung -------------------------------
      if (op.kind === 'modify' || op.kind === 'delete') {
        const cur = await readCurrent(call, op);
        if (!cur.found) {
          results.push({
            id: op.id,
            label: op.label,
            status: op.kind === 'delete' ? 'skipped' : 'failed',
            message:
              op.kind === 'delete'
                ? 'Object no longer exists — nothing to delete.'
                : 'Object no longer exists on the FortiGate.',
          });
          if (op.kind === 'modify' && stopOnError) aborted = true;
          continue;
        }
        const conflicts = conflictFields(op.before, cur.value);
        if (conflicts.length) {
          results.push({
            id: op.id,
            label: op.label,
            status: 'conflict',
            message: `Changed on the FortiGate since it was loaded (${conflicts.map((c) => c.field).join(', ')}). Skipped to avoid overwriting.`,
            detail: conflicts,
          });
          continue;
        }
        op._current = cur.value;
      }

      if (op.kind === 'create') {
        const cur = await readCurrent(call, { ...op, kind: 'modify' });
        if (cur.found) {
          results.push({ id: op.id, label: op.label, status: 'failed', message: 'An object with this name already exists.' });
          if (stopOnError) aborted = true;
          continue;
        }
      }

      // --- Ausfuehren ----------------------------------------------------
      const r = await execute(call, op);
      if (!r.ok) {
        results.push({
          id: op.id,
          label: op.label,
          status: 'failed',
          message: describeFailure(r),
          detail: r.data ?? null,
          httpStatus: r.status,
        });
        if (stopOnError) aborted = true;
        continue;
      }

      applied.push(op);
      results.push({ id: op.id, label: op.label, status: 'applied', message: null });
    } catch (e) {
      results.push({ id: op.id, label: op.label, status: 'failed', message: e.message, detail: e.detail ?? null });
      if (stopOnError) aborted = true;
    }
  }

  return {
    results,
    appliedCount: results.filter((r) => r.status === 'applied').length,
    failedCount: results.filter((r) => r.status === 'failed').length,
    conflictCount: results.filter((r) => r.status === 'conflict').length,
    skippedCount: results.filter((r) => r.status === 'skipped').length,
    revertable: applied.map(stripInternal),
  };
}

async function execute(call, op) {
  if (op.kind === 'move') {
    const pos = op.move?.position === 'before' ? 'before' : 'after';
    return call(pathFor(op), { method: 'PUT', query: { action: 'move', [pos]: op.move.ref } });
  }

  const method = methodFor(op);
  const body = method === 'DELETE' ? undefined : bodyFor(op);
  const r = await call(pathFor(op), { method, body });

  // Manche FortiOS-Builds bieten fuer managed-switch keine Kindtabellen-Route.
  // In dem Fall den Port ueber das Elternobjekt schreiben.
  if (!r.ok && op.table === 'switch-controller/managed-switch' && op.child && (r.status === 404 || r.status === 405)) {
    return writePortViaParent(call, op);
  }
  return r;
}

async function writePortViaParent(call, op) {
  const parent = await call(`cmdb/${op.table}/${encodeKey(op.mkey)}`, { method: 'GET' });
  if (!parent.ok) return parent;
  const sw = parent.data?.results?.[0];
  if (!sw) return { ok: false, status: 404, data: { cli_error: `Switch ${op.mkey} not found` } };

  const ports = Array.isArray(sw.ports) ? [...sw.ports] : [];
  const i = ports.findIndex((p) => p['port-name'] === op.child.mkey);
  if (i === -1) return { ok: false, status: 404, data: { cli_error: `Port ${op.child.mkey} not found on ${op.mkey}` } };
  ports[i] = { ...ports[i], ...(op.after ?? {}) };

  return call(`cmdb/${op.table}/${encodeKey(op.mkey)}`, { method: 'PUT', body: { ports } });
}

function describeFailure(r) {
  const d = r.data ?? {};
  const detail = d.cli_error || (typeof d.error === 'string' ? d.error : null);
  if (detail) return `HTTP ${r.status}: ${detail}`;
  if (r.status === 424) return 'HTTP 424: a referenced object is missing or a value was rejected.';
  if (r.status === 403) return 'HTTP 403: the API token lacks write permission for the "wifi" access group.';
  if (r.status === 500 && d.error === -5) return 'HTTP 500: the FortiGate rejected the object (duplicate name or invalid value).';
  return `HTTP ${r.status}: the FortiGate rejected the request.`;
}

function stripInternal(op) {
  const { _current, ...rest } = op;
  return { ...rest, _currentBefore: _current ?? null };
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

/** Baut die Umkehroperationen zu bereits angewandten Ops (letzte zuerst). */
export function invertOps(appliedOps) {
  const out = [];
  for (let i = appliedOps.length - 1; i >= 0; i--) {
    const op = appliedOps[i];
    const base = { table: op.table, mkey: op.mkey, idField: op.idField, child: op.child, label: `Revert: ${op.label ?? op.mkey}` };

    if (op.kind === 'create') {
      out.push({ ...base, id: `${op.id}-rev`, kind: 'delete', before: op.after ?? null, after: null });
    } else if (op.kind === 'modify') {
      const before = op._currentBefore ?? op.before;
      if (!before) continue;
      out.push({ ...base, id: `${op.id}-rev`, kind: 'modify', before: op.after ?? null, after: before });
    } else if (op.kind === 'delete') {
      const before = op._currentBefore ?? op.before;
      if (!before) continue;
      out.push({ ...base, id: `${op.id}-rev`, kind: 'create', before: null, after: before });
    }
    // move wird bewusst nicht zurueckgedreht – die Ausgangsposition ist nach
    // weiteren Verschiebungen nicht mehr eindeutig rekonstruierbar.
  }
  return out;
}

/** Fuehrt einen Revert aus. Konfliktpruefung ist hier aus – wir wollen zurueck. */
export async function revertOps(call, appliedOps) {
  const inverse = invertOps(appliedOps).map((op) => ({ ...op, before: null }));
  return applyOps(call, inverse, { stopOnError: false });
}
