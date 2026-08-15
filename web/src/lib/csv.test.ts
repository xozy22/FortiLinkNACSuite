// CSV kommt aus Excel und aus Inventarisierungen – Semikolon, BOM, CRLF,
// Anfuehrungszeichen, deutsche Spaltennamen. Der Parser muss das aushalten,
// sonst kippt der Import an der Datei statt an der Konfiguration.
import { describe, expect, it } from 'vitest';
import { coerceMac, guessMapping, parseCsv } from './csv';

describe('parseCsv', () => {
  it('detects a semicolon file as Excel writes it', () => {
    const p = parseCsv('a;b;c\n1;2;3');
    expect(p.delimiter).toBe(';');
    expect(p.headers).toEqual(['a', 'b', 'c']);
    expect(p.rows).toEqual([{ a: '1', b: '2', c: '3' }]);
  });

  it('handles comma and tab too', () => {
    expect(parseCsv('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsv('a\tb\n1\t2').delimiter).toBe('\t');
  });

  it('strips the BOM instead of putting it in the first column name', () => {
    const p = parseCsv('﻿mac;name\naa;bb');
    expect(p.headers[0]).toBe('mac');
  });

  it('survives CRLF', () => {
    expect(parseCsv('a;b\r\n1;2\r\n').rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps a delimiter that sits inside quotes', () => {
    const p = parseCsv('name;note\nPRN;"Buero 2.14, Fensterseite"');
    expect(p.rows[0].note).toBe('Buero 2.14, Fensterseite');
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"say ""hi"""').rows[0].a).toBe('say "hi"');
  });

  it('reports rows with more cells than headers instead of mangling them', () => {
    const p = parseCsv('a;b\n1;2;3\n4;5');
    expect(p.skipped).toBe(1);
    expect(p.rows).toHaveLength(1);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('').rows).toHaveLength(0);
  });
});

describe('coerceMac', () => {
  it('accepts the notations that turn up in the wild', () => {
    for (const v of ['3c:2a:f4:11:00:01', '3C-2A-F4-11-00-01', '3c2af4110001', '3C2A.F411.0001']) {
      expect(coerceMac(v)).toBe('3c:2a:f4:11:00:01');
    }
  });
  it('rejects anything that is not twelve hex digits', () => {
    expect(coerceMac('nicht-eine-mac')).toBeNull();
    expect(coerceMac('3c:2a:f4:11:00')).toBeNull();
    expect(coerceMac('')).toBeNull();
  });
});

describe('guessMapping', () => {
  // Der Fehler, den der erste Durchlauf zeigte: die Ueberschrift war deutsch,
  // also griff kein Muster – und der Rueckfall nahm blind die erste Spalte.
  it('finds the MAC column by content even when the header is German', () => {
    const p = parseCsv(
      ['Geraet;MAC-Adresse;Hersteller', 'PRN-01;3C-2A-F4-99-00-01;Brother', 'PRN-02;3c2af4990002;Brother'].join('\n')
    );
    const m = guessMapping(p.headers, p.rows);
    expect(m.mac).toBe('MAC-Adresse');
    expect(m.hostname).toBe('Geraet');
    expect(m.vendor).toBe('Hersteller');
  });

  it('trusts the content over a misleading header', () => {
    const p = parseCsv(['mac;real', 'not-a-mac;3c:2a:f4:99:00:01'].join('\n'));
    expect(guessMapping(p.headers, p.rows).mac).toBe('real');
  });

  it('handles umlauts in headers', () => {
    const p = parseCsv(['Gerät;Typ;MAC', 'PRN;Printer;3c:2a:f4:99:00:01'].join('\n'));
    const m = guessMapping(p.headers, p.rows);
    expect(m.hostname).toBe('Gerät');
    expect(m.type).toBe('Typ');
    expect(m.mac).toBe('MAC');
  });

  it('never maps another field onto the MAC column', () => {
    const p = parseCsv(['mac;vendor', '3c:2a:f4:99:00:01;Brother'].join('\n'));
    const m = guessMapping(p.headers, p.rows);
    expect(Object.entries(m).filter(([, v]) => v === m.mac)).toHaveLength(1);
  });

  it('falls back to the first column when nothing looks like a MAC', () => {
    const p = parseCsv(['x;y', 'a;b'].join('\n'));
    expect(guessMapping(p.headers, p.rows).mac).toBe('x');
  });
});
