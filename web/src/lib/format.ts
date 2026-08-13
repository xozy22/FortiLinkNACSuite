// Kleine Formathelfer. Englische Ausgaben – die App ist durchgehend englisch.

export function relTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function absTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** MAC einheitlich klein und mit Doppelpunkten. */
export function normMac(v: string): string {
  const hex = String(v ?? '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
  if (hex.length !== 12) return String(v ?? '').trim().toLowerCase();
  return hex.match(/.{2}/g)!.join(':');
}

export function isMac(v: string): boolean {
  return /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(String(v ?? '').trim());
}

/** OUI-Anteil einer MAC – nuetzlich zum Gruppieren. */
export function oui(mac: string): string {
  const n = normMac(mac);
  return n.length === 17 ? n.slice(0, 8) : '';
}

/** Aus einem Anzeigenamen einen FortiOS-tauglichen Objektnamen bauen. */
export function slug(v: string, max = 63): string {
  return String(v ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max);
}

/** Portgeschwindigkeit in Mbit/s lesbar machen (1000 -> "1 Gbps"). */
export function linkSpeed(mbps: number | null | undefined): string {
  if (!mbps || !Number.isFinite(mbps) || mbps <= 0) return '';
  if (mbps >= 1000) {
    const g = mbps / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbps`;
  }
  return `${mbps} Mbps`;
}

export function truncate(v: string, n: number): string {
  const s = String(v ?? '');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Mengenfeld -> Namensliste. */
export function members(list: { [k: string]: string }[] | undefined, key: string): string[] {
  return (list ?? []).map((e) => e[key]).filter(Boolean);
}

/** Namensliste -> Mengenfeld. */
export function toMembers(names: string[], key: string): { [k: string]: string }[] {
  return names.filter(Boolean).map((n) => ({ [key]: n }));
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}
