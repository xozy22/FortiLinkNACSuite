// ---------------------------------------------------------------------------
// Sessions und App-Zugang.
//
// Die Session steckt in einem signierten Cookie statt in einer Map im Speicher.
// Damit ueberlebt sie einen Neustart des Servers – im Container also jedes
// Update – und es liegen keine Sitzungsdaten auf der Platte.
//
// Im Cookie steht nur, WELCHES Verbindungsprofil gemeint ist. Der API-Token
// wird bei jedem Request frisch aus dem Profilspeicher geholt und verlaesst den
// Server nie.
// ---------------------------------------------------------------------------
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLNS_DATA_DIR || join(here, 'data');
const KEY_FILE = join(DATA_DIR, '.session-key');

export const COOKIE = 'flns_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Signierschluessel
// ---------------------------------------------------------------------------

/**
 * Ohne stabilen Schluessel waeren nach jedem Neustart alle Cookies ungueltig –
 * genau das Problem, das dieses Modul loesen soll. Bevorzugt FLNS_SECRET,
 * sonst ein einmalig erzeugter und abgelegter Zufallsschluessel.
 */
function loadKey() {
  if (process.env.FLNS_SECRET) return Buffer.from(`sess:${process.env.FLNS_SECRET}`, 'utf8');
  try {
    if (existsSync(KEY_FILE)) return Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
    mkdirSync(DATA_DIR, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(KEY_FILE, key.toString('hex'), 'utf8');
    try {
      chmodSync(KEY_FILE, 0o600);
    } catch {
      /* unter Windows weitgehend wirkungslos */
    }
    return key;
  } catch (err) {
    console.warn('[flns] Could not persist a session key, sessions will not survive a restart:', err.message);
    return randomBytes(32);
  }
}

const KEY = loadKey();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const macOf = (data) => createHmac('sha256', KEY).update(data).digest('base64url');

/** @typedef {{cid?:string|null, adhoc?:string|null, demo?:boolean, authed?:boolean, exp:number}} SessionPayload */

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${macOf(body)}`;
}

function unsign(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);

  const expected = macOf(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie-Handling
// ---------------------------------------------------------------------------

/** @param {import('express').Response} res @param {Omit<SessionPayload,'exp'>} payload */
export function issueSession(res, payload) {
  const full = { ...payload, exp: Date.now() + MAX_AGE_MS };
  res.cookie(COOKIE, sign(full), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    // Ueber HTTP hinter einem Reverse-Proxy wuerde "secure" das Cookie
    // verschlucken – deshalb nur setzen, wenn ausdruecklich gewuenscht.
    secure: process.env.FLNS_COOKIE_SECURE === 'true',
  });
  return full;
}

/** @returns {SessionPayload|null} */
export function readSession(req) {
  return unsign(req.cookies?.[COOKIE]);
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

// ---------------------------------------------------------------------------
// App-Zugang
// ---------------------------------------------------------------------------

const APP_PASSWORD = process.env.FLNS_APP_PASSWORD || '';

/** Ist ein App-Passwort konfiguriert? */
export function passwordRequired() {
  return APP_PASSWORD.length > 0;
}

/** Zeitkonstanter Vergleich, damit die Laufzeit nichts ueber das Passwort verraet. */
export function checkPassword(given) {
  if (!passwordRequired()) return true;
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(APP_PASSWORD, 'utf8');
  // Ueber einen HMAC vergleichen, damit auch unterschiedliche Laengen
  // zeitkonstant behandelt werden.
  const ha = createHmac('sha256', KEY).update(a).digest();
  const hb = createHmac('sha256', KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Darf dieser Request die API benutzen? */
export function isAuthed(req) {
  if (!passwordRequired()) return true;
  return readSession(req)?.authed === true;
}

// ---------------------------------------------------------------------------
// Startprüfung
// ---------------------------------------------------------------------------

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Ohne App-Passwort darf der Server nicht auf einer erreichbaren Adresse
 * lauschen. Wer die API erreicht, kann sich mit einem gespeicherten Profil
 * verbinden und damit auf der FortiGate schreiben – der Token bleibt zwar
 * serverseitig, seine Wirkung aber nicht.
 *
 * @returns {{bind:string, ok:boolean, message?:string}}
 */
export function checkBindSafety(bind) {
  const loopback = LOOPBACK.has(bind);
  if (loopback || passwordRequired() || process.env.FLNS_ALLOW_ANONYMOUS === 'true') {
    return { bind, ok: true };
  }
  return {
    bind,
    ok: false,
    message:
      `Refusing to listen on ${bind} without a password.\n\n` +
      `  Anyone who can reach this port could connect with a stored profile and\n` +
      `  write to your FortiGate. Pick one:\n\n` +
      `    FLNS_APP_PASSWORD=<password>   protect the app with a password\n` +
      `    FLNS_BIND=127.0.0.1            listen on this machine only (default)\n` +
      `    FLNS_ALLOW_ANONYMOUS=true      you have your own authentication in front\n`,
  };
}
