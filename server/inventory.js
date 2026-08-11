// ---------------------------------------------------------------------------
// Asset-Inventar.
//
// Die FortiGate verteilt das Wissen ueber ein Geraet auf drei Endpunkte:
//   user/device/query                 – was ist das Geraet (Vendor/Typ/OS/Host)
//   switch-controller/detected-device – wo haengt es (Switch/Port/VLAN)
//   switch-controller/matched-devices – welche Regel greift darauf
// Erst der Join ueber die MAC ergibt die Sicht, die man fuer NAC braucht.
//
// Zusaetzlich wird der Port-Zustand aus der CMDB gelesen: eine Dynamic Port
// Policy wirkt nur auf Ports mit access-mode "dynamic". Ohne diese Information
// sieht ein unauffaelliges Geraet ohne Regeltreffer genauso aus wie eines, das
// an einem Port haengt, an dem NAC gar nicht aktiv ist.
// ---------------------------------------------------------------------------

/** Coverage-Status eines Assets. */
export const COVERAGE = {
  MATCHED: 'matched', // Regel greift
  NO_RULE: 'no-rule', // Port ist dynamisch, aber keine Regel passt
  PORT_STATIC: 'port-static', // Port ist nicht auf access-mode dynamic
  OFF_SWITCH: 'off-switch', // nicht an einem FortiLink-Switch gesehen
};

const norm = (v) => String(v ?? '').trim();
const macKey = (v) => norm(v).toLowerCase();

/**
 * Baut das Inventar.
 * @param {(apiPath:string, opts?:object) => Promise<{ok:boolean,status:number,data:any}>} call
 */
export async function buildInventory(call) {
  const [devicesRes, detectedRes, matchedRes, switchesRes] = await Promise.all([
    call('monitor/user/device/query', { query: { start: 0, count: 2000 } }),
    call('monitor/switch-controller/detected-device'),
    call('monitor/switch-controller/matched-devices', { query: { include_dynamic: true } }),
    call('cmdb/switch-controller/managed-switch'),
  ]);

  const warnings = [];
  const devices = pick(devicesRes, 'user/device/query', warnings);
  const detected = pick(detectedRes, 'switch-controller/detected-device', warnings);
  const matched = pick(matchedRes, 'switch-controller/matched-devices', warnings);
  const switches = pick(switchesRes, 'switch-controller/managed-switch', warnings);

  // Port-Zustand indizieren: "switchId|portName" -> Port-Objekt
  const portIndex = new Map();
  for (const sw of switches) {
    for (const p of sw.ports ?? []) {
      portIndex.set(`${sw['switch-id']}|${p['port-name']}`, p);
    }
  }

  const detectedByMac = new Map();
  for (const d of detected) {
    const k = macKey(d.mac);
    if (!k) continue;
    // Bei Mehrfachtreffern gewinnt der juengste Eintrag.
    const prev = detectedByMac.get(k);
    if (!prev || (d.last_seen ?? Infinity) < (prev.last_seen ?? Infinity)) detectedByMac.set(k, d);
  }

  const matchedByMac = new Map();
  for (const m of matched) {
    const k = macKey(m.mac);
    if (k) matchedByMac.set(k, m);
  }

  // Alle bekannten MACs – auch solche, die nur einer der Quellen kennt.
  const macs = new Set();
  for (const d of devices) if (macKey(d.mac)) macs.add(macKey(d.mac));
  for (const k of detectedByMac.keys()) macs.add(k);
  for (const k of matchedByMac.keys()) macs.add(k);

  const deviceByMac = new Map();
  for (const d of devices) {
    const k = macKey(d.mac);
    if (k) deviceByMac.set(k, d);
  }

  const assets = [];
  for (const mac of macs) {
    const d = deviceByMac.get(mac) ?? {};
    const det = detectedByMac.get(mac) ?? null;
    const m = matchedByMac.get(mac) ?? null;
    const port = det ? portIndex.get(`${det.switch_id}|${det.port_name}`) ?? null : null;

    assets.push({
      mac,
      macDisplay: norm(d.mac || det?.mac || m?.mac) || mac,

      hostname: norm(d.hostname),
      ipv4: norm(d.ipv4_address),
      vendor: norm(d.hardware_vendor),
      type: norm(d.hardware_type),
      family: norm(d.hardware_family),
      os: norm(d.os_name),
      osVersion: norm(d.os_version),
      hostSrc: norm(d.host_src),
      purdueLevel: norm(d.purdue_level),
      dhcpStatus: norm(d.dhcp_lease_status),
      detectedInterface: norm(d.detected_interface),
      online: d.is_online === true,
      lastSeen: numOrNull(d.last_seen ?? det?.last_seen),
      known: deviceByMac.has(mac),

      switchId: norm(det?.switch_id ?? m?.last_known_switch),
      portName: norm(det?.port_name ?? m?.last_known_port),
      portId: numOrNull(det?.port_id),
      vlanId: numOrNull(det?.vlan_id),
      onSwitch: !!det,

      accessMode: norm(port?.['access-mode']),
      portPolicy: norm(port?.['port-policy']),
      portTags: (port?.['interface-tags'] ?? []).map((t) => t['tag-name']).filter(Boolean),

      matchedDpp: norm(m?.matched_dynamic_port_policy),
      matchedRule: norm(m?.matched_policy),
      matchedNacPolicy: norm(m?.matched_nac_policy),
      macPolicy: norm(m?.mac_policy),
      isDynamic: m?.is_dynamic === true,
      isNac: m?.is_nac === true,

      coverage: coverageOf({ det, port, matched: m }),
      raw: d,
    });
  }

  assets.sort((a, b) => (a.hostname || a.mac).localeCompare(b.hostname || b.mac, 'en'));

  return {
    assets,
    fields: describeFields(devices),
    warnings,
    counts: summarize(assets),
    fetchedAt: new Date().toISOString(),
  };
}

function coverageOf({ det, port, matched }) {
  if (matched?.matched_policy) return COVERAGE.MATCHED;
  if (!det) return COVERAGE.OFF_SWITCH;
  if (!port) return COVERAGE.OFF_SWITCH;
  if (port['access-mode'] !== 'dynamic' || !port['port-policy']) return COVERAGE.PORT_STATIC;
  return COVERAGE.NO_RULE;
}

function summarize(assets) {
  const c = {
    total: assets.length,
    online: 0,
    onSwitch: 0,
    matched: 0,
    noRule: 0,
    portStatic: 0,
    offSwitch: 0,
    unidentified: 0,
  };
  for (const a of assets) {
    if (a.online) c.online++;
    if (a.onSwitch) c.onSwitch++;
    if (!a.vendor && !a.type && !a.hostname) c.unidentified++;
    if (a.coverage === COVERAGE.MATCHED) c.matched++;
    else if (a.coverage === COVERAGE.NO_RULE) c.noRule++;
    else if (a.coverage === COVERAGE.PORT_STATIC) c.portStatic++;
    else c.offSwitch++;
  }
  return c;
}

/**
 * Welche Felder liefert diese FortiOS-Version in user/device/query wirklich?
 * Wird dynamisch ermittelt, damit der Spaltenwaehler nicht an eine
 * Firmware-Version gebunden ist.
 */
function describeFields(devices) {
  const seen = new Map();
  for (const d of devices.slice(0, 200)) {
    for (const [k, v] of Object.entries(d ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      const kind = Array.isArray(v) ? 'array' : typeof v;
      const e = seen.get(k);
      if (e) e.count++;
      else seen.set(k, { key: k, kind, count: 1, sample: kind === 'object' || kind === 'array' ? null : v });
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function pick(res, what, warnings) {
  if (!res?.ok) {
    warnings.push({
      source: what,
      status: res?.status ?? 0,
      message: res?.data?.cli_error || res?.data?.error || `Could not read ${what} (HTTP ${res?.status ?? '?'})`,
    });
    return [];
  }
  const r = res.data?.results;
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') return Object.values(r);
  return [];
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
