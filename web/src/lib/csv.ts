// ---------------------------------------------------------------------------
// CSV einlesen.
//
// Bewusst ohne Bibliothek: Was hier ankommt, sind Exporte aus Inventarisierungen
// und Excel – Semikolon oder Komma, Anfuehrungszeichen, BOM, CRLF. Das deckt ein
// knapper Parser ab, und eine Abhaengigkeit fuer diesen Zweck lohnt nicht.
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  /** Zeilen, die nicht zur Kopfzeile passten. */
  skipped: number;
}

/** Häufigstes Trennzeichen der Kopfzeile gewinnt. */
function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: (firstLine.match(new RegExp(`\\${d}`, 'g')) ?? []).length,
  }));
  return counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts.sort((a, b) => b.n - a.n)[0].d : ',';
}

/** Eine Zeile zerlegen, Anfuehrungszeichen und doppelte Quotes beachtet. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): ParsedCsv {
  // BOM entfernen, sonst heisst die erste Spalte "﻿mac".
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [], delimiter: ',', skipped: 0 };

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.trim());

  let skipped = 0;
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    // Weniger Spalten sind verkraftbar, mehr deutet auf ein Trennzeichen im Text.
    if (cells.length > headers.length) {
      skipped++;
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
    rows.push(row);
  }

  return { headers, rows, delimiter, skipped };
}

/** Umlaute angleichen, damit "Gerät" und "Geraet" gleich behandelt werden. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();

/**
 * Spaltennamen, die typischerweise für ein Feld stehen.
 * Deutsch und Englisch, weil beides in der Praxis vorkommt.
 */
const GUESSES: Record<string, RegExp> = {
  mac: /^(mac|mac[\s_-]?(address|adresse)|hardware[\s_-]?(address|adresse)|physical[\s_-]?address|macaddr)$/,
  hostname: /^(host|hostname|name|device|device[\s_-]?name|computer|asset|geraet|geraetename|bezeichnung)$/,
  vendor: /^(vendor|manufacturer|hersteller|hw[\s_-]?vendor|make|marke)$/,
  type: /^(type|typ|device[\s_-]?type|geraetetyp|geraeteart|kind|category|kategorie|art)$/,
  description: /^(description|comment|note|beschreibung|bemerkung|kommentar|standort|location|raum|ort|dose)$/,
};

/**
 * Rät, welche Spalte die MAC-Adressen enthält – anhand des Inhalts, nicht des
 * Namens. Spaltenüberschriften sind unzuverlässig (Sprache, Schreibweise,
 * gar keine), MAC-Adressen dagegen sind eindeutig erkennbar.
 */
function macColumnByContent(headers: string[], rows: Record<string, string>[]): string | null {
  if (!rows.length) return null;
  const sample = rows.slice(0, 50);
  let best: { header: string; hits: number } | null = null;

  for (const h of headers) {
    const hits = sample.filter((r) => coerceMac(r[h] ?? '')).length;
    if (hits && (!best || hits > best.hits)) best = { header: h, hits };
  }
  // Mindestens die Hälfte der Zeilen muss passen, sonst ist es Zufall.
  return best && best.hits >= Math.min(2, sample.length) ? best.header : null;
}

/** Rät die Zuordnung von CSV-Spalten zu unseren Feldern. */
export function guessMapping(headers: string[], rows: Record<string, string>[] = []): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, re] of Object.entries(GUESSES)) {
    const hit = headers.find((h) => re.test(fold(h)));
    if (hit) map[field] = hit;
  }

  // Der Inhalt schlaegt den Namen: Eine Spalte voller MAC-Adressen ist ein
  // staerkeres Indiz als eine Ueberschrift, die zufaellig passt.
  const byContent = macColumnByContent(headers, rows);
  if (byContent) map.mac = byContent;
  else if (!map.mac && headers.length) map.mac = headers[0];

  // Dieselbe Spalte nicht doppelt vergeben.
  for (const field of Object.keys(map)) {
    if (field !== 'mac' && map[field] === map.mac) delete map[field];
  }
  return map;
}

/** Erkennt eine MAC in beliebiger Schreibweise und normalisiert sie. */
export function coerceMac(raw: string): string | null {
  const hex = String(raw ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) return null;
  return hex.toLowerCase().match(/.{2}/g)!.join(':');
}
