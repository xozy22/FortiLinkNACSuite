// ---------------------------------------------------------------------------
// Erzeugt aus einer Operationsliste den aequivalenten FortiOS-CLI-Text.
//
// Zweck ist Nachvollziehbarkeit: Wer die Aenderung freigibt, soll vor dem Apply
// in vertrauter Syntax sehen, was passiert – und den Block notfalls von Hand
// oder in einem Change-Ticket verwenden koennen.
// ---------------------------------------------------------------------------

/** Felder, die als blanke Option geschrieben werden (ohne Anfuehrungszeichen). */
const BARE_FIELDS = new Set([
  'status',
  'category',
  'match-type',
  'match-remove',
  'bounce-port-link',
  'poe-reset',
  'allowed-vlans-all',
  'discard-mode',
  'access-mode',
  'sticky-mac',
  'poe-status',
]);

/** Mengenfelder: Liste von Objekten mit genau einem Namensfeld. */
const MEMBER_FIELDS = {
  'allowed-vlans': 'vlan-name',
  'untagged-vlans': 'vlan-name',
  'interface-tags': 'tag-name',
};

/** Reihenfolge, in der Felder ausgegeben werden – Match vor Action liest sich besser. */
const FIELD_ORDER = [
  'description',
  'status',
  'fortilink',
  'category',
  'match-type',
  'match-period',
  'match-remove',
  'mac',
  'hw-vendor',
  'type',
  'family',
  'host',
  'interface-tags',
  'vlan',
  'vlan-policy',
  '802-1x',
  'qos-policy',
  'lldp-profile',
  'allowed-vlans',
  'untagged-vlans',
  'allowed-vlans-all',
  'discard-mode',
  'bounce-port-link',
  'bounce-port-duration',
  'poe-reset',
  'access-mode',
  'port-policy',
];

const IND = '    ';

/** "switch-controller.qos/qos-policy" -> "switch-controller qos qos-policy" */
function cliPath(table) {
  return String(table).replace(/[./]/g, ' ');
}

function q(v) {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

function renderValue(field, value) {
  if (MEMBER_FIELDS[field]) {
    const nameKey = MEMBER_FIELDS[field];
    const names = (Array.isArray(value) ? value : [])
      .map((e) => (typeof e === 'string' ? e : e?.[nameKey]))
      .filter(Boolean);
    return names.length ? names.map(q).join(' ') : null;
  }
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return String(value);
  if (BARE_FIELDS.has(field)) return String(value);
  return q(value);
}

function sortFields(keys) {
  return [...keys].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Gibt die "set"/"unset"-Zeilen fuer ein Objekt aus.
 * Bei modify werden nur geaenderte Felder geschrieben.
 */
function setLines(op, indent) {
  const after = op.after ?? {};
  const before = op.kind === 'modify' ? op.before ?? {} : null;
  const idFields = new Set([op.idField || 'name']);

  const keys = sortFields(Object.keys(after).filter((k) => !idFields.has(k)));
  const out = [];

  for (const k of keys) {
    const rendered = renderValue(k, after[k]);
    if (before) {
      const prev = renderValue(k, before[k]);
      if (prev === rendered) continue;
      if (rendered === null) {
        out.push(`${indent}unset ${k}`);
        continue;
      }
    } else if (rendered === null) {
      continue; // Defaults nicht unnoetig ausschreiben
    }
    out.push(`${indent}set ${k} ${rendered}`);
  }

  // Felder, die es vorher gab und jetzt fehlen, zuruecksetzen
  if (before) {
    for (const k of sortFields(Object.keys(before))) {
      if (idFields.has(k) || k in after) continue;
      if (renderValue(k, before[k]) === null) continue;
      out.push(`${indent}unset ${k}`);
    }
  }

  return out;
}

/** Gruppiert aufeinanderfolgende Ops nach Tabelle und Elternobjekt. */
function group(ops) {
  const groups = [];
  for (const op of ops) {
    const parentKey = `${op.table}|${op.child ? op.mkey : ''}`;
    const last = groups[groups.length - 1];
    if (last && last.key === parentKey) last.ops.push(op);
    else groups.push({ key: parentKey, table: op.table, parent: op.child ? op.mkey : null, ops: [op] });
  }
  return groups;
}

/**
 * @param {Array} ops Operationsliste
 * @returns {string} CLI-Text
 */
export function opsToCli(ops) {
  if (!ops?.length) return '';
  const lines = [];

  for (const g of group(ops)) {
    lines.push(`config ${cliPath(g.table)}`);

    if (g.parent) {
      // Kindtabelle – alle Ops liegen unter demselben Elternobjekt
      lines.push(`${IND}edit ${q(g.parent)}`);
      const childTable = g.ops[0].child.table;
      lines.push(`${IND}${IND}config ${childTable}`);
      for (const op of g.ops) {
        lines.push(...childBody(op, `${IND}${IND}${IND}`));
      }
      lines.push(`${IND}${IND}end`);
      lines.push(`${IND}next`);
    } else {
      for (const op of g.ops) {
        if (op.kind === 'delete') {
          lines.push(`${IND}delete ${q(op.mkey)}`);
          continue;
        }
        lines.push(`${IND}edit ${q(op.mkey)}`);
        lines.push(...setLines(op, `${IND}${IND}`));
        lines.push(`${IND}next`);
      }
    }

    lines.push('end');
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function childBody(op, indent) {
  const key = op.child.mkey;
  if (op.kind === 'delete') return [`${indent}delete ${q(key)}`];
  if (op.kind === 'move') {
    const pos = op.move?.position === 'before' ? 'before' : 'after';
    return [`${indent}move ${q(key)} ${pos} ${q(op.move?.ref ?? '')}`];
  }
  return [`${indent}edit ${q(key)}`, ...setLines(op, `${indent}${IND}`), `${indent}next`];
}

/** Einzelne Operation als CLI – fuer die Detailansicht je Op im Drawer. */
export function opToCli(op) {
  return opsToCli([op]);
}
