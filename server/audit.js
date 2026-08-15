// ---------------------------------------------------------------------------
// Audit-Log.
//
// Bei einem Werkzeug, das Netzwerkkonfiguration aendert, ist "wer hat wann was
// angewendet" das Erste, wonach im Zweifel gesucht wird. Der Apply-Bericht im
// UI ist nach einem Reload weg – hier bleibt er.
//
// Append-only JSONL: eine Zeile je Ereignis, maschinenlesbar und mit
// gewoehnlichen Werkzeugen auswertbar. Bewusst keine Datenbank.
// ---------------------------------------------------------------------------
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLNS_DATA_DIR || join(here, 'data');
const FILE = join(DATA_DIR, 'audit.log');
const MAX_BYTES = 5 * 1024 * 1024;

/** Nichts protokollieren, was ein Geheimnis waere. */
const REDACT = /^(apiKey|password|token)$/i;

function safe(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => safe(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.test(k) ? '[redacted]' : safe(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function rotateIfNeeded() {
  try {
    if (existsSync(FILE) && statSync(FILE).size > MAX_BYTES) renameSync(FILE, `${FILE}.1`);
  } catch {
    /* Rotation ist Komfort, kein Grund den Vorgang scheitern zu lassen */
  }
}

/**
 * Schreibt ein Ereignis. Schlaegt das Schreiben fehl, darf das den eigentlichen
 * Vorgang nicht kippen – ein fehlendes Log ist aergerlich, ein abgebrochener
 * Apply mitten in einer Konfigurationsaenderung ist schlimmer.
 */
export function audit(event, data = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...safe(data) });
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    rotateIfNeeded();
    appendFileSync(FILE, line + '\n', 'utf8');
  } catch (err) {
    console.warn('[flns] Could not write the audit log:', err.message);
  }
}

/** Kontext einer Verbindung, so wie er in jedem Eintrag stehen soll. */
export function connContext(conn, req) {
  return {
    host: conn?.host ?? null,
    vdom: conn?.vdom ?? null,
    profile: conn?.connectionName ?? null,
    demo: !!conn?.demo,
    from: req?.ip || req?.socket?.remoteAddress || null,
  };
}

/** Fasst eine Operation auf das zusammen, was im Nachhinein interessiert. */
export function summarizeOp(op) {
  return {
    kind: op.kind,
    table: op.table,
    mkey: op.mkey,
    child: op.child ? `${op.child.table}/${op.child.mkey}` : null,
    ...(op.kind === 'move' ? { move: op.move } : {}),
    ...(op.after ? { after: safe(op.after) } : {}),
  };
}

/** Liest die letzten Eintraege, neueste zuerst. */
export function readAudit(limit = 200) {
  try {
    if (!existsSync(FILE)) return [];
    const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (err) {
    console.warn('[flns] Could not read the audit log:', err.message);
    return [];
  }
}

export { FILE as AUDIT_FILE };
