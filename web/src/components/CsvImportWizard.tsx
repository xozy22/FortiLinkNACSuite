// ---------------------------------------------------------------------------
// Regeln aus einer Geräteliste.
//
// Gegenstueck zum Generator aus dem Live-Inventar: Hier kommt die Liste aus
// einer Inventarisierung, einem Kabelplan oder einer Tabelle – Geraete also,
// die die FortiGate noch gar nicht gesehen hat. Genau der Fall bei einer
// Neuinstallation oder einer geplanten Umstellung.
// ---------------------------------------------------------------------------
import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardPaste, FileUp, ListPlus } from 'lucide-react';
import type { Asset, Dpp, DppRule } from '@/api/types';
import { useRefData, useSchema } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import { Modal, Note } from './common';
import { SelectField, TextField } from './fields';
import { ruleFields } from '@/lib/schema';
import { coerceMac, guessMapping, parseCsv, type ParsedCsv } from '@/lib/csv';
import { isCatchAll } from '@/lib/match';
import { createRule, moveRule } from '@/lib/ops';
import { pluralize, slug, truncate } from '@/lib/format';

const FIELDS = [
  { key: 'mac', label: 'MAC address', required: true },
  { key: 'hostname', label: 'Hostname', required: false },
  { key: 'vendor', label: 'Vendor', required: false },
  { key: 'type', label: 'Type', required: false },
  { key: 'description', label: 'Description', required: false },
] as const;

interface Candidate {
  line: number;
  mac: string | null;
  raw: Record<string, string>;
  hostname: string;
  vendor: string;
  type: string;
  description: string;
  problem: string | null;
}

export function CsvImportWizard({
  dpps,
  assets,
  onClose,
}: {
  dpps: Dpp[];
  assets: Asset[];
  onClose: () => void;
}) {
  const cs = useChangeset();
  const toast = useToast();
  const { data: ref } = useRefData();
  const { data: schema } = useSchema();
  const fields = ruleFields(schema);
  const fileInput = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [dppName, setDppName] = useState(dpps[0]?.name ?? '');
  const [prefix, setPrefix] = useState('CSV');
  const [placement, setPlacement] = useState<'before-catch-all' | 'top' | 'bottom'>('before-catch-all');
  const [vlanPolicy, setVlanPolicy] = useState('');
  const [dot1x, setDot1x] = useState('');

  function ingest(raw: string) {
    const p = parseCsv(raw);
    setParsed(p);
    setMapping(guessMapping(p.headers, p.rows));
  }

  const targetDpp = dpps.find((d) => d.name === dppName);
  const existingNames = new Set((targetDpp?.policy ?? []).map((r) => r.name));
  const existingMacs = new Map(
    (targetDpp?.policy ?? []).filter((r) => r.mac).map((r) => [String(r.mac).toLowerCase(), r.name])
  );
  const knownMacs = new Map(assets.map((a) => [a.mac, a]));

  // --- Kandidaten ----------------------------------------------------------
  const candidates = useMemo<Candidate[]>(() => {
    if (!parsed) return [];
    const seen = new Set<string>();
    return parsed.rows.map((row, i) => {
      const rawMac = mapping.mac ? row[mapping.mac] : '';
      const mac = coerceMac(rawMac);
      let problem: string | null = null;
      if (!mac) problem = rawMac ? `"${truncate(rawMac, 20)}" is not a MAC address` : 'No MAC address';
      else if (seen.has(mac)) problem = 'Duplicate within the file';
      else if (existingMacs.has(mac)) problem = `Already matched by rule "${existingMacs.get(mac)}"`;
      if (mac) seen.add(mac);

      return {
        line: i + 2, // Kopfzeile ist Zeile 1
        mac,
        raw: row,
        hostname: mapping.hostname ? row[mapping.hostname] ?? '' : '',
        vendor: mapping.vendor ? row[mapping.vendor] ?? '' : '',
        type: mapping.type ? row[mapping.type] ?? '' : '',
        description: mapping.description ? row[mapping.description] ?? '' : '',
        problem,
      };
    });
  }, [parsed, mapping, existingMacs]);

  const usable = candidates.filter((c) => c.mac && !c.problem);
  const skipped = candidates.filter((c) => c.problem);

  // --- Regeln --------------------------------------------------------------
  const planned = useMemo<DppRule[]>(() => {
    const used = new Set(existingNames);
    return usable.map((c) => {
      const stem = slug(`${prefix}-${c.hostname || c.mac!.replace(/:/g, '')}`, 60);
      let name = stem;
      let n = 2;
      while (used.has(name)) name = `${stem}-${n++}`;
      used.add(name);
      return {
        name,
        description: truncate(c.description || [c.vendor, c.type].filter(Boolean).join(' ') || '', 63),
        status: 'enable',
        category: 'device',
        mac: c.mac!,
        ...(vlanPolicy ? { 'vlan-policy': vlanPolicy } : {}),
        ...(dot1x ? { '802-1x': dot1x } : {}),
      } as DppRule;
    });
  }, [usable, prefix, vlanPolicy, dot1x, existingNames]);

  const rules = targetDpp?.policy ?? [];
  const catchAllIndex = rules.findIndex(isCatchAll);
  const alreadyKnown = usable.filter((c) => knownMacs.has(c.mac!)).length;

  const nameField = fields.name;
  const tooLongNames = planned.filter((p) => (nameField?.size ?? 63) < p.name.length);
  const canSubmit = !!dppName && planned.length > 0 && tooLongNames.length === 0;

  function submit() {
    if (!targetDpp) return;
    const drafts = planned.map((r) => createRule(dppName, r));

    let anchor: { position: 'before' | 'after'; ref: string } | null = null;
    if (placement === 'top' && rules[0]) anchor = { position: 'before', ref: rules[0].name };
    else if (placement === 'before-catch-all' && catchAllIndex >= 0) anchor = { position: 'before', ref: rules[catchAllIndex].name };

    const moves = anchor
      ? planned.map((r, i) =>
          i === 0
            ? moveRule(dppName, r.name, anchor!.position, anchor!.ref)
            : moveRule(dppName, r.name, 'after', planned[i - 1].name)
        )
      : [];

    cs.addMany([...drafts, ...moves]);
    toast('ok', `Staged ${pluralize(planned.length, 'rule')}`, 'Review them in the changes panel before applying.');
    onClose();
  }

  const opt = (list: { name: string }[] | undefined) => (list ?? []).map((v) => ({ value: v.name, label: v.name }));

  return (
    <Modal
      title="Import devices from a list"
      subtitle="Turn a CSV of MAC addresses into dynamic port policy rules"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canSubmit}>
            <ListPlus size={13} /> Stage {pluralize(planned.length, 'rule')}
          </button>
        </>
      }
    >
      {/* Quelle */}
      <div className="fieldset">
        <legend>Source</legend>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const raw = await f.text();
            setText(raw);
            ingest(raw);
          }}
        />
        <div className="row">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <FileUp size={13} /> Choose a CSV file
          </button>
          <span className="xs dim">or paste below</span>
        </div>
        <textarea
          className="textarea mono"
          style={{ minHeight: 90 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && ingest(text)}
          placeholder={'mac;hostname;vendor;type\n3c:2a:f4:11:00:01;PRN-LOGISTIK;Brother;Printer'}
          spellCheck={false}
        />
        {parsed && (
          <div className="xs dim">
            {pluralize(parsed.rows.length, 'row')} · {parsed.headers.length} columns · delimiter{' '}
            <code>{parsed.delimiter === '\t' ? 'tab' : parsed.delimiter}</code>
            {parsed.skipped > 0 && (
              <span style={{ color: 'var(--amber)' }}> · {parsed.skipped} malformed line(s) ignored</span>
            )}
          </div>
        )}
      </div>

      {parsed && parsed.headers.length > 0 && (
        <>
          {/* Zuordnung */}
          <div className="fieldset">
            <legend>Column mapping</legend>
            <div className="form-grid">
              {FIELDS.map((f) => (
                <SelectField
                  key={f.key}
                  label={f.label}
                  name={f.key}
                  value={mapping[f.key] ?? ''}
                  onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v }))}
                  options={parsed.headers.map((h) => ({ value: h, label: h }))}
                  required={f.required}
                  emptyLabel="— not in the file —"
                />
              ))}
            </div>
            <div className="xs dim">
              Only the MAC address is required. Hostname and description feed the rule name and comment; vendor and type
              are shown for orientation but are not written as match criteria — a rule per MAC is exact by itself.
            </div>
          </div>

          {/* Ziel */}
          <div className="fieldset">
            <legend>Target</legend>
            <div className="form-grid">
              <SelectField
                label="Dynamic port policy"
                name="dpp"
                value={dppName}
                onChange={setDppName}
                options={dpps.map((d) => ({ value: d.name, label: d.name }))}
                allowEmpty={false}
                required
              />
              <SelectField
                label="Position"
                name="placement"
                value={placement}
                onChange={(v) => setPlacement(v as typeof placement)}
                allowEmpty={false}
                options={[
                  { value: 'before-catch-all', label: catchAllIndex >= 0 ? 'Before the catch-all rule' : 'Before the catch-all (none present)' },
                  { value: 'top', label: 'At the top' },
                  { value: 'bottom', label: 'At the bottom (FortiOS default)' },
                ]}
              />
              <TextField label="Name prefix" name="prefix" value={prefix} onChange={setPrefix} mono />
              <SelectField
                label="VLAN policy"
                name="vlan-policy"
                field={fields['vlan-policy']}
                value={vlanPolicy}
                onChange={setVlanPolicy}
                options={opt(ref?.['switch-controller/vlan-policy']?.results)}
              />
              <SelectField
                label="802.1X policy"
                name="802-1x"
                field={fields['802-1x']}
                value={dot1x}
                onChange={setDot1x}
                options={opt(ref?.['switch-controller.security-policy/802-1X']?.results)}
              />
            </div>

            {placement === 'bottom' && catchAllIndex >= 0 && (
              <Note kind="err">
                Placing these after "{rules[catchAllIndex].name}" means they will never match — that rule already catches
                every device.
              </Note>
            )}
            {!vlanPolicy && !dot1x && (
              <Note kind="warn">No action selected. The rules would match devices without changing anything.</Note>
            )}
            {tooLongNames.length > 0 && (
              <Note kind="err">
                {pluralize(tooLongNames.length, 'generated name')} exceed{tooLongNames.length === 1 ? 's' : ''} the{' '}
                {nameField?.size} character limit. Shorten the prefix.
              </Note>
            )}
          </div>

          {/* Befunde */}
          <div className="fieldset">
            <legend>
              {pluralize(usable.length, 'rule')} from {pluralize(candidates.length, 'row')}
            </legend>

            <div className="row wrap">
              <span className="badge green">{usable.length} usable</span>
              {skipped.length > 0 && <span className="badge amber">{skipped.length} skipped</span>}
              {alreadyKnown > 0 && <span className="badge blue">{alreadyKnown} already seen by the FortiGate</span>}
            </div>

            {alreadyKnown < usable.length && (
              <Note kind="info">
                {pluralize(usable.length - alreadyKnown, 'device')} in this list {usable.length - alreadyKnown === 1 ? 'is' : 'are'}{' '}
                not in the inventory yet. That is expected for hardware that has not been plugged in — the rule applies
                once it appears.
              </Note>
            )}

            {skipped.length > 0 && (
              <div className="panel">
                <div className="panel-head">
                  <AlertTriangle size={12} style={{ color: 'var(--amber)' }} />
                  <span className="panel-title">Skipped rows</span>
                </div>
                <table className="tbl">
                  <tbody>
                    {skipped.slice(0, 12).map((c) => (
                      <tr key={c.line}>
                        <td className="xs dim" style={{ width: 60 }}>line {c.line}</td>
                        <td className="xs">{c.problem}</td>
                        <td className="xs dim mono truncate">{c.hostname || Object.values(c.raw)[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {skipped.length > 12 && <div className="xs dim" style={{ padding: 8 }}>and {skipped.length - 12} more.</div>}
              </div>
            )}

            {planned.length > 0 && (
              <div className="panel">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>MAC</th>
                      <th>From the file</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planned.slice(0, 20).map((r, i) => (
                      <tr key={r.name}>
                        <td className="mono xs">{r.name}</td>
                        <td className="mono xs">{String(r.mac)}</td>
                        <td className="xs dim truncate">
                          {[usable[i].hostname, usable[i].vendor, usable[i].type].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {planned.length > 20 && (
                  <div className="xs dim" style={{ padding: 8 }}>Showing the first 20 of {planned.length}.</div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {!parsed && (
        <Note kind="info">
          <ClipboardPaste size={12} style={{ verticalAlign: -2 }} /> Paste or choose a file to continue. Comma, semicolon
          and tab are all recognised, and quoted fields are handled.
        </Note>
      )}
    </Modal>
  );
}
