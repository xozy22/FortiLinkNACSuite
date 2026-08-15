// ---------------------------------------------------------------------------
// Konfigurationsbuendel: lesen, vergleichen, in Operationen uebersetzen.
//
// Dasselbe Buendel dient drei Zwecken – Export als Datei, Snapshot vor einem
// Apply und Import einer fremden Konfiguration. Der Vergleich erzeugt in allen
// Faellen einen gewoehnlichen Changeset, der durch dieselbe Pruefung und
// denselben Review-Schritt laeuft wie eine Aenderung von Hand. Nichts umgeht
// den Freigabeweg, nur weil es aus einer Datei kommt.
// ---------------------------------------------------------------------------

export const CONFIG_VERSION = 1;

const DPP = 'switch-controller/dynamic-port-policy';
const VLANPOL = 'switch-controller/vlan-policy';
const SWITCH = 'switch-controller/managed-switch';
const TAGS = 'switch-controller/switch-interface-tag';

/** Felder eines Ports, die die Suite verwaltet – nur die gehoeren ins Buendel. */
const PORT_FIELDS = ['access-mode', 'port-policy'];

const clean = (o) => {
  if (!o || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(clean);
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'q_origin_key') continue;
    out[k] = clean(v);
  }
  return out;
};

/**
 * Liest den verwalteten Teil der Konfiguration.
 * @param {(p:string, o?:object)=>Promise<{ok:boolean,data:any}>} call
 */
export async function readConfig(call, meta = {}) {
  const get = async (table, query) => {
    const r = await call(`cmdb/${table}`, query ? { query } : undefined);
    return r.ok ? (r.data?.results ?? []).map(clean) : [];
  };

  const [dpps, vlanPolicies, switches, tags] = await Promise.all([
    get(DPP),
    get(VLANPOL),
    get(SWITCH),
    get(TAGS, { format: 'name' }),
  ]);

  return {
    _format: 'fortilink-nac-suite/config',
    _version: CONFIG_VERSION,
    capturedAt: new Date().toISOString(),
    ...meta,
    dynamicPortPolicies: dpps,
    vlanPolicies,
    interfaceTags: tags.map((t) => t.name),
    // Von den Switches nur, was NAC betrifft. Der Rest ist Geraetezustand und
    // gehoert nicht in eine Konfigurationssicherung dieses Werkzeugs.
    portAssignments: switches.flatMap((sw) =>
      (sw.ports ?? []).map((p) => ({
        switchId: sw['switch-id'],
        port: p['port-name'],
        'access-mode': p['access-mode'] ?? 'static',
        'port-policy': p['port-policy'] ?? '',
      }))
    ),
  };
}

/** Grobe Formpruefung eines importierten Buendels. */
export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['Not a JSON object.'];
  if (cfg._format !== 'fortilink-nac-suite/config') {
    errors.push('Missing the "fortilink-nac-suite/config" marker — is this a config export from this tool?');
  }
  if (cfg._version !== CONFIG_VERSION) {
    errors.push(`Written by format version ${cfg._version ?? 'unknown'}, this build expects ${CONFIG_VERSION}.`);
  }
  for (const key of ['dynamicPortPolicies', 'vlanPolicies', 'portAssignments']) {
    if (cfg[key] !== undefined && !Array.isArray(cfg[key])) errors.push(`"${key}" must be a list.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Vergleich
// ---------------------------------------------------------------------------

const byName = (list) => new Map((list ?? []).map((e) => [e.name, e]));
const stripName = (o) => {
  const { name: _n, ...rest } = o ?? {};
  return rest;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let seq = 0;
const id = (p) => `cfg-${p}-${seq++}`;

/**
 * Erzeugt die Operationen, die den Ist-Zustand auf das Ziel bringen.
 *
 * @param {object} target  gewuenschter Stand (Datei oder Snapshot)
 * @param {object} current Ist-Zustand von der FortiGate
 * @param {{deleteExtra?:boolean, scope?:string[]}} opts
 *        deleteExtra – auch entfernen, was im Ziel fehlt. Standard aus, weil
 *        ein Import sonst stillschweigend fremde Objekte mitnimmt.
 */
export function diffConfig(target, current, opts = {}) {
  const deleteExtra = opts.deleteExtra === true;
  const scope = new Set(opts.scope ?? ['vlanPolicies', 'dynamicPortPolicies', 'portAssignments']);
  const ops = [];
  seq = 0;

  // --- VLAN Policies ------------------------------------------------------
  if (scope.has('vlanPolicies')) {
    const cur = byName(current.vlanPolicies);
    const tgt = byName(target.vlanPolicies);

    for (const [name, want] of tgt) {
      const have = cur.get(name);
      if (!have) {
        ops.push({ id: id('vp'), kind: 'create', table: VLANPOL, mkey: name, before: null, after: stripName(want), label: `Create VLAN policy "${name}"` });
      } else if (!same(stripName(have), stripName(want))) {
        ops.push({ id: id('vp'), kind: 'modify', table: VLANPOL, mkey: name, before: stripName(have), after: stripName(want), label: `Update VLAN policy "${name}"` });
      }
    }
    if (deleteExtra) {
      for (const [name, have] of cur) {
        if (!tgt.has(name)) {
          ops.push({ id: id('vp'), kind: 'delete', table: VLANPOL, mkey: name, before: stripName(have), after: null, label: `Delete VLAN policy "${name}"` });
        }
      }
    }
  }

  // --- Dynamic Port Policies und ihre Regeln ------------------------------
  if (scope.has('dynamicPortPolicies')) {
    const cur = byName(current.dynamicPortPolicies);
    const tgt = byName(target.dynamicPortPolicies);

    for (const [name, want] of tgt) {
      const have = cur.get(name);
      const container = (o) => {
        const { policy: _p, ...rest } = stripName(o);
        return rest;
      };

      if (!have) {
        ops.push({ id: id('dpp'), kind: 'create', table: DPP, mkey: name, before: null, after: container(want), label: `Create dynamic port policy "${name}"` });
      } else if (!same(container(have), container(want))) {
        ops.push({ id: id('dpp'), kind: 'modify', table: DPP, mkey: name, before: container(have), after: container(want), label: `Update dynamic port policy "${name}"` });
      }

      ops.push(...diffRules(name, have?.policy ?? [], want.policy ?? [], deleteExtra));
    }

    if (deleteExtra) {
      for (const [name, have] of cur) {
        if (!tgt.has(name)) {
          const { policy: _p, ...rest } = stripName(have);
          ops.push({ id: id('dpp'), kind: 'delete', table: DPP, mkey: name, before: rest, after: null, label: `Delete dynamic port policy "${name}"` });
        }
      }
    }
  }

  // --- Port-Zuweisungen ---------------------------------------------------
  if (scope.has('portAssignments')) {
    const key = (p) => `${p.switchId}|${p.port}`;
    const cur = new Map((current.portAssignments ?? []).map((p) => [key(p), p]));

    for (const want of target.portAssignments ?? []) {
      const have = cur.get(key(want));
      // Ports, die es hier nicht gibt, werden uebersprungen statt erfunden –
      // eine Sicherung aus einer anderen Anlage darf keine Geraete anlegen.
      if (!have) continue;
      const pick = (p) => Object.fromEntries(PORT_FIELDS.map((f) => [f, p[f] ?? '']));
      if (!same(pick(have), pick(want))) {
        ops.push({
          id: id('port'),
          kind: 'modify',
          table: SWITCH,
          mkey: want.switchId,
          idField: 'switch-id',
          child: { table: 'ports', mkey: want.port, idField: 'port-name' },
          before: pick(have),
          after: pick(want),
          label: `Configure ${want.switchId} / ${want.port}`,
        });
      }
    }
  }

  return ops;
}

/** Regeln einer Policy angleichen, inklusive Reihenfolge. */
function diffRules(dpp, have, want, deleteExtra) {
  const ops = [];
  const child = (name) => ({ table: 'policy', mkey: name, idField: 'name' });
  const haveByName = byName(have);
  const wantByName = byName(want);

  for (const rule of want) {
    const existing = haveByName.get(rule.name);
    if (!existing) {
      ops.push({ id: id('rule'), kind: 'create', table: DPP, mkey: dpp, child: child(rule.name), before: null, after: stripName(rule), label: `Add rule "${rule.name}" to "${dpp}"` });
    } else if (!same(stripName(existing), stripName(rule))) {
      ops.push({ id: id('rule'), kind: 'modify', table: DPP, mkey: dpp, child: child(rule.name), before: stripName(existing), after: stripName(rule), label: `Update rule "${rule.name}" in "${dpp}"` });
    }
  }

  if (deleteExtra) {
    for (const rule of have) {
      if (!wantByName.has(rule.name)) {
        ops.push({ id: id('rule'), kind: 'delete', table: DPP, mkey: dpp, child: child(rule.name), before: stripName(rule), after: null, label: `Delete rule "${rule.name}" from "${dpp}"` });
      }
    }
  }

  // Reihenfolge angleichen. Sie entscheidet ueber das Ergebnis (First Match),
  // deshalb genuegt es nicht, die Regeln nur inhaltlich zu treffen.
  const projected = [
    ...have.filter((r) => (deleteExtra ? wantByName.has(r.name) : true)).map((r) => r.name),
    ...want.filter((r) => !haveByName.has(r.name)).map((r) => r.name),
  ];
  const desired = want.map((r) => r.name).filter((n) => projected.includes(n));

  for (let i = 0; i < desired.length; i++) {
    const name = desired[i];
    if (projected[i] === name) continue;
    const from = projected.indexOf(name);
    if (from === -1) continue;
    projected.splice(from, 1);
    projected.splice(i, 0, name);
    const anchor = i === 0 ? { position: 'before', ref: projected[1] } : { position: 'after', ref: projected[i - 1] };
    if (!anchor.ref) continue;
    ops.push({
      id: id('move'),
      kind: 'move',
      table: DPP,
      mkey: dpp,
      child: child(name),
      move: anchor,
      before: null,
      after: null,
      label: `Move "${name}" ${anchor.position} "${anchor.ref}"`,
    });
  }

  return ops;
}

/** Kurzfassung eines Buendels fuer Listen und Vergleiche. */
export function summarizeConfig(cfg) {
  const rules = (cfg.dynamicPortPolicies ?? []).reduce((n, d) => n + (d.policy?.length ?? 0), 0);
  return {
    policies: (cfg.dynamicPortPolicies ?? []).length,
    rules,
    vlanPolicies: (cfg.vlanPolicies ?? []).length,
    ports: (cfg.portAssignments ?? []).filter((p) => p['access-mode'] === 'dynamic').length,
  };
}
