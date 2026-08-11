// ---------------------------------------------------------------------------
// Low-Level-Client fuer die FortiOS REST-API.
// Haelt Bearer-Token, VDOM und die TLS-Entscheidung serverseitig.
// ---------------------------------------------------------------------------
import { Agent, fetch as undiciFetch } from 'undici';

// TLS-Agents einmalig anlegen und je nach verifyTls wiederverwenden.
const agentInsecure = new Agent({ connect: { rejectUnauthorized: false } });
const agentSecure = new Agent({ connect: { rejectUnauthorized: true } });

const DEFAULT_TIMEOUT = 25_000;

/** Fehler mit HTTP-Status und einem verstaendlichen Hinweistext. */
export class FortiGateError extends Error {
  constructor(message, { status = 502, hint = null, detail = null, cause = null } = {}) {
    super(message);
    this.name = 'FortiGateError';
    this.status = status;
    this.hint = hint;
    this.detail = detail;
    if (cause) this.cause = cause;
  }

  toJSON() {
    return { error: this.message, hint: this.hint, detail: this.detail, status: this.status };
  }
}

// Englische Klartext-Hinweise je HTTP-Status. Die Access-Group "wifi" ist der
// mit Abstand haeufigste Stolperstein bei switch-controller-Endpunkten.
const HTTP_HINTS = {
  400: 'The FortiGate rejected the request as malformed. Check field names and value types.',
  401: 'Authentication failed. Verify the API token and that the source IP is in the token\'s trusted hosts.',
  403: 'Permission denied. The API admin profile needs the "wifi" access group (read-write for changes), and the selected VDOM must be allowed for this token.',
  404: 'Endpoint or object not found. This FortiOS version may not expose it, or the object name is wrong.',
  405: 'Method not allowed on this endpoint.',
  413: 'Request too large for the FortiGate to process.',
  424: 'Failed dependency. A referenced object is missing, a required attribute is unset, or a value is invalid.',
  429: 'Too many requests. The FortiGate is rate limiting or has temporarily blocked this source.',
  500: 'The FortiGate hit an internal error while processing the request.',
};

/** Host normalisieren: Schema und Trailing-Slashes entfernen. */
export function normalizeHost(host) {
  return String(host || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

/**
 * Ruft einen FortiOS-API-Pfad auf.
 *
 * @param {{host:string, apiKey:string, verifyTls?:boolean, vdom?:string}} conn
 * @param {string} apiPath  z.B. "cmdb/switch-controller/vlan-policy" oder "monitor/user/device/query"
 * @param {{method?:string, body?:any, query?:object, vdom?:string|null, timeout?:number}} [opts]
 * @returns {Promise<{status:number, ok:boolean, data:any}>}
 */
export async function callFgt(conn, apiPath, opts = {}) {
  const { method = 'GET', body, query, timeout = DEFAULT_TIMEOUT } = opts;
  const host = normalizeHost(conn.host);
  if (!host) throw new FortiGateError('No host configured', { status: 400 });

  const url = new URL(`https://${host}/api/v2/${String(apiPath).replace(/^\/+/, '')}`);

  // vdom kann pro Aufruf ueberschrieben oder mit null unterdrueckt werden
  // (globale Endpunkte vertragen keinen vdom-Parameter).
  const vdom = opts.vdom === undefined ? conn.vdom : opts.vdom;
  if (vdom) url.searchParams.set('vdom', vdom);

  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, typeof v === 'boolean' ? String(v) : String(v));
    }
  }

  let res;
  try {
    res = await undiciFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      dispatcher: conn.verifyTls ? agentSecure : agentInsecure,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw asTransportError(err, host, conn.verifyTls);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

/**
 * Wie callFgt, wirft aber bei Fehlern statt Status zurueckzugeben und liefert
 * direkt `results`. Fuer den internen Gebrauch, wenn ein Fehler ohnehin
 * durchgereicht werden soll.
 */
export async function fgtResults(conn, apiPath, opts = {}) {
  const r = await callFgt(conn, apiPath, opts);
  if (!r.ok) throw errorFromResponse(r, apiPath);
  return r.data?.results ?? r.data ?? null;
}

/** Baut aus einer fehlgeschlagenen Antwort einen FortiGateError mit Hinweis. */
export function errorFromResponse(r, apiPath = '') {
  const d = r.data ?? {};
  // FortiOS liefert bei CLI-Fehlern gerne cli_error / error als Zusatzinfo.
  const detail = d.cli_error || d.error || d.message || d.raw || null;
  const where = apiPath ? ` (${apiPath})` : '';
  return new FortiGateError(`FortiGate returned HTTP ${r.status}${where}`, {
    status: r.status,
    hint: HTTP_HINTS[r.status] ?? 'Unexpected response from the FortiGate.',
    detail,
  });
}

/** Uebersetzt Netzwerk-/TLS-Fehler in verstaendliche Meldungen. */
function asTransportError(err, host, verifyTls) {
  const code = err?.cause?.code || err?.code || '';
  const name = err?.name || '';

  if (name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new FortiGateError(`Timed out talking to ${host}`, {
      status: 504,
      hint: 'The FortiGate did not answer in time. Check reachability, the admin port (HTTPS must be enabled on the interface) and any firewall in between.',
      cause: err,
    });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new FortiGateError(`Cannot resolve host ${host}`, {
      status: 502,
      hint: 'DNS lookup failed. Check the hostname, or use the IP address instead.',
      cause: err,
    });
  }
  if (code === 'ECONNREFUSED') {
    return new FortiGateError(`Connection refused by ${host}`, {
      status: 502,
      hint: 'Nothing is listening on port 443. Check that HTTPS admin access is enabled on the interface you are reaching.',
      cause: err,
    });
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return new FortiGateError(`Connection to ${host} was reset`, {
      status: 502,
      hint: 'The FortiGate closed the connection. A trusted-host restriction on the admin account is a common cause.',
      cause: err,
    });
  }
  if (String(code).startsWith('ERR_TLS') || String(code).includes('CERT') || String(code).includes('SELF_SIGNED')) {
    return new FortiGateError(`TLS handshake with ${host} failed`, {
      status: 502,
      hint: verifyTls
        ? 'Certificate validation failed. FortiGates usually present a self-signed certificate — turn off "Verify TLS certificate" for this connection.'
        : 'The TLS handshake failed even without certificate validation. Check that the port really speaks HTTPS.',
      cause: err,
    });
  }

  return new FortiGateError(`Could not reach ${host}`, {
    status: 502,
    hint: code ? `Network error: ${code}` : 'Network error.',
    cause: err,
  });
}

/**
 * Verbindungstest. Liefert ein Info-Objekt (hostname, version, serial, vdom-Modus)
 * oder wirft einen FortiGateError mit brauchbarem Hinweis.
 */
export async function testConnection(conn) {
  const r = await callFgt(conn, 'monitor/system/status', { vdom: null });
  if (!r.ok) throw errorFromResponse(r, 'monitor/system/status');

  const res = r.data?.results ?? {};
  return {
    hostname: res.hostname ?? r.data?.hostname ?? null,
    version: r.data?.version ?? res.version ?? null,
    build: r.data?.build ?? null,
    serial: r.data?.serial ?? res.serial ?? null,
    model: res.model ?? null,
    vdomMode: r.data?.vdom_mode ?? null,
  };
}

export { HTTP_HINTS };
