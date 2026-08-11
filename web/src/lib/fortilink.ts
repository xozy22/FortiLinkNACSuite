// ---------------------------------------------------------------------------
// Erkennung der FortiLink-Schnittstelle.
//
// Wichtig: FortiOS kennt KEINEN Interface-Typ "fortilink". Die type-Optionen
// sind physical, vlan, aggregate, redundant, tunnel, loopback, switch, …
// Ob eine Schnittstelle FortiLink traegt, steht im eigenen Feld
//   system.interface.fortilink = enable | disable
// Typischerweise ist das ein aggregate- oder physical-Interface.
//
// Damit die Auswahl auch dann brauchbar bleibt, wenn das Feld nicht gelesen
// werden kann (Berechtigung, aeltere Firmware, gefilterte Antwort), werden
// zusaetzlich die FortiLink-Namen herangezogen, die bereits in vorhandenen
// Objekten stehen.
// ---------------------------------------------------------------------------
import type { Dpp, SystemInterface, VlanPolicy } from '@/api/types';

/** Traegt diese Schnittstelle FortiLink? */
export function isFortiLink(i: SystemInterface): boolean {
  return String(i.fortilink ?? '').toLowerCase() === 'enable';
}

export interface FortiLinkOption {
  name: string;
  /** Woher der Eintrag stammt – fuer den Hinweistext im Formular. */
  source: 'interface' | 'referenced';
  type?: string;
}

/**
 * Liefert die auswaehlbaren FortiLink-Schnittstellen.
 *
 * Primaer aus system/interface. Ergaenzt um Namen, auf die bestehende Dynamic
 * Port Policies oder VLAN Policies bereits verweisen – die existieren auf der
 * FortiGate nachweislich, auch wenn wir das Interface gerade nicht sehen.
 */
export function fortiLinkOptions(
  interfaces: SystemInterface[],
  referencedBy: { dpps?: Dpp[]; vlanPolicies?: VlanPolicy[] } = {}
): FortiLinkOption[] {
  const out = new Map<string, FortiLinkOption>();

  for (const i of interfaces) {
    if (isFortiLink(i) && i.name) out.set(i.name, { name: i.name, source: 'interface', type: i.type });
  }

  const referenced = [
    ...(referencedBy.dpps ?? []).map((d) => d.fortilink),
    ...(referencedBy.vlanPolicies ?? []).map((v) => v.fortilink),
  ].filter((n): n is string => !!n);

  for (const n of referenced) {
    if (!out.has(n)) out.set(n, { name: n, source: 'referenced' });
  }

  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * VLANs, die unter einer FortiLink-Schnittstelle haengen.
 * Ist die Schnittstelle unbekannt, werden alle VLANs angeboten statt keine –
 * eine leere Liste waere hier die schlechtere Auskunft.
 */
export function vlansUnder(interfaces: SystemInterface[], fortilink: string | undefined): SystemInterface[] {
  const vlans = interfaces.filter((i) => i.type === 'vlan');
  if (!fortilink) return vlans;
  const under = vlans.filter((i) => i.interface === fortilink);
  return under.length ? under : vlans;
}

/** Anzeigename eines VLAN-Interfaces inklusive VLAN-ID. */
export function vlanLabel(i: SystemInterface): string {
  return i.vlanid ? `${i.name} (vlan ${i.vlanid})` : i.name;
}
