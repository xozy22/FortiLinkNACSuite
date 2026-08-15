// ---------------------------------------------------------------------------
// Schemagetriebene Formularhilfen und Validierung.
//
// Feldlaengen, Options-Listen und Wertebereiche kommen aus dem CMDB-Schema der
// verbundenen FortiGate. Dadurch stimmt die Validierung mit der Zielversion
// ueberein, statt Annahmen aus der Dokumentation zu wiederholen.
// ---------------------------------------------------------------------------
import type { SchemaBundle, SchemaField, SchemaTable } from '@/api/types';

export const TABLE_KEYS = {
  DPP: 'switch-controller/dynamic-port-policy',
  VLAN_POLICY: 'switch-controller/vlan-policy',
  SWITCH: 'switch-controller/managed-switch',
} as const;

export function table(schema: SchemaBundle | undefined, key: string): SchemaTable | undefined {
  return schema?.tables?.[key];
}

/** Feldliste der DPP-Regel-Untertabelle. */
export function ruleFields(schema: SchemaBundle | undefined): Record<string, SchemaField> {
  return table(schema, TABLE_KEYS.DPP)?.children?.policy?.children ?? {};
}

export function vlanPolicyFields(schema: SchemaBundle | undefined): Record<string, SchemaField> {
  return table(schema, TABLE_KEYS.VLAN_POLICY)?.children ?? {};
}

export function dppFields(schema: SchemaBundle | undefined): Record<string, SchemaField> {
  return table(schema, TABLE_KEYS.DPP)?.children ?? {};
}


export function optionsOf(f: SchemaField | undefined): string[] {
  return (f?.options ?? []).map((o) => o.name);
}

export function maxLen(f: SchemaField | undefined): number | undefined {
  return f?.size;
}

export interface FieldIssue {
  level: 'error' | 'warn';
  message: string;
}

/** Prueft einen Einzelwert gegen sein Schemafeld. */
export function checkField(f: SchemaField | undefined, value: unknown, fieldName: string): FieldIssue | null {
  if (!f) return null;
  if (value === null || value === undefined || value === '') return null;

  if (f.type === 'option' && f.options?.length) {
    const allowed = optionsOf(f);
    if (!allowed.includes(String(value))) {
      return { level: 'error', message: `Must be one of: ${allowed.join(', ')}` };
    }
    return null;
  }

  if (f.type === 'integer') {
    const n = Number(value);
    if (!Number.isFinite(n)) return { level: 'error', message: 'Must be a number' };
    if (f['min-value'] !== undefined && n < f['min-value']) return { level: 'error', message: `Minimum is ${f['min-value']}` };
    if (f['max-value'] !== undefined && n > f['max-value']) return { level: 'error', message: `Maximum is ${f['max-value']}` };
    return null;
  }

  if (typeof value === 'string' && f.size && value.length > f.size) {
    return {
      level: 'error',
      message: `${value.length} of ${f.size} characters. FortiOS matches ${fieldName} by prefix, so a shorter value still works.`,
    };
  }

  return null;
}



/** Kurzhilfe eines Feldes, gekuerzt auf Tooltip-Laenge. */
export function helpOf(f: SchemaField | undefined): string {
  return f?.help ?? '';
}
