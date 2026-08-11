// ---------------------------------------------------------------------------
// "Create rules from selection".
//
// Der Weg, den es im FortiOS-GUI nicht gibt: Geraete im Inventar auswaehlen und
// daraus direkt Regeln erzeugen – entweder eine je MAC-Adresse, oder eine
// gemeinsame Regel ueber Vendor/Typ/Family/Host.
//
// Die Platzierung ist Teil des Dialogs, weil FortiOS neue Regeln hinten anhaengt
// und sie damit hinter einer Catch-All-Regel wirkungslos waeren.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Fingerprint, Layers, ListPlus, Wand2 } from 'lucide-react';
import type { Asset, DppRule } from '@/api/types';
import { useRefData, useSchema } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import { Modal, Note } from './common';
import { SelectField, TextField } from './fields';
import { ruleFields } from '@/lib/schema';
import { isCatchAll, ruleMatches } from '@/lib/match';
import { pluralize, slug, truncate } from '@/lib/format';
import { createRule, moveRule } from '@/lib/ops';
import { projectDpps } from '@/lib/project';

type Strategy = 'per-mac' | 'shared';
type Placement = 'top' | 'before-catch-all' | 'bottom';

const SHARED_FIELDS = [
  { key: 'hw-vendor' as const, label: 'Vendor', from: (a: Asset) => a.vendor },
  { key: 'type' as const, label: 'Type', from: (a: Asset) => a.type },
  { key: 'family' as const, label: 'Family', from: (a: Asset) => a.family },
  { key: 'host' as const, label: 'Host', from: (a: Asset) => a.hostname },
];

export function BulkRuleWizard({
  assets,
  allAssets,
  onClose,
  onDone,
}: {
  /** Die ausgewaehlten Geraete, aus denen Regeln entstehen. */
  assets: Asset[];
  /** Der gesamte Bestand – noetig, um zu zeigen, wen eine gemeinsame Regel sonst noch trifft. */
  allAssets: Asset[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: ref } = useRefData();
  const { data: schema } = useSchema();
  const cs = useChangeset();
  const toast = useToast();
  const fields = ruleFields(schema);

  const dpps = ref?.['switch-controller/dynamic-port-policy']?.results ?? [];
  const projected = useMemo(() => projectDpps(dpps, cs.ops), [dpps, cs.ops]);

  // Die DPP, an der die meisten ausgewaehlten Geraete haengen, ist die beste Vorgabe.
  const suggestedDpp = useMemo(() => {
    const tally = new Map<string, number>();
    for (const a of assets) if (a.portPolicy) tally.set(a.portPolicy, (tally.get(a.portPolicy) ?? 0) + 1);
    return [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? dpps[0]?.name ?? '';
  }, [assets, dpps]);

  const [strategy, setStrategy] = useState<Strategy>(assets.length > 8 ? 'shared' : 'per-mac');
  const [dppName, setDppName] = useState(suggestedDpp);
  const [placement, setPlacement] = useState<Placement>('before-catch-all');
  const [prefix, setPrefix] = useState('NAC');
  const [useField, setUseField] = useState<Record<string, boolean>>({ 'hw-vendor': true, type: true, family: false, host: false });
  const [sharedName, setSharedName] = useState('');

  // Actions
  const [vlanPolicy, setVlanPolicy] = useState('');
  const [dot1x, setDot1x] = useState('');
  const [qos, setQos] = useState('');
  const [lldp, setLldp] = useState('');
  const [poeReset, setPoeReset] = useState('disable');
  const [bounce, setBounce] = useState('enable');

  const targetDpp = projected.find((d) => d.name === dppName);
  const existingNames = (targetDpp?.policy ?? []).map((r) => r.name);

  // --- gemeinsame Kriterien ------------------------------------------------
  const shared = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of SHARED_FIELDS) {
      if (!useField[f.key]) continue;
      const values = new Set(assets.map((a) => f.from(a)).filter(Boolean));
      if (values.size === 1) out[f.key] = [...values][0];
    }
    return out;
  }, [assets, useField]);

  const sharedConflicts = useMemo(
    () =>
      SHARED_FIELDS.filter((f) => {
        if (!useField[f.key]) return false;
        const values = new Set(assets.map((a) => f.from(a)).filter(Boolean));
        return values.size !== 1;
      }),
    [assets, useField]
  );

  const overLength = useMemo(
    () => Object.entries(shared).filter(([k, v]) => (fields[k]?.size ?? 999) < v.length),
    [shared, fields]
  );

  // --- geplante Regeln -----------------------------------------------------
  const planned = useMemo<DppRule[]>(() => {
    const actions: Partial<DppRule> = {
      status: 'enable',
      category: 'device',
      ...(vlanPolicy ? { 'vlan-policy': vlanPolicy } : {}),
      ...(dot1x ? { '802-1x': dot1x } : {}),
      ...(qos ? { 'qos-policy': qos } : {}),
      ...(lldp ? { 'lldp-profile': lldp } : {}),
      'poe-reset': poeReset as 'enable' | 'disable',
      'bounce-port-link': bounce as 'enable' | 'disable',
    };

    if (strategy === 'shared') {
      const base = sharedName || slug(`${prefix}-${Object.values(shared).join('-') || 'group'}`);
      return [{ name: truncate(base, 63), description: `${assets.length} device${assets.length === 1 ? '' : 's'} from inventory`, ...shared, ...actions } as DppRule];
    }

    const used = new Set(existingNames);
    return assets.map((a) => {
      const stem = slug(`${prefix}-${a.hostname || a.macDisplay.replace(/:/g, '')}`, 60);
      let name = stem;
      let n = 2;
      while (used.has(name)) name = `${stem}-${n++}`;
      used.add(name);
      return {
        name,
        description: truncate([a.vendor, a.type].filter(Boolean).join(' ') || a.macDisplay, 63),
        mac: a.macDisplay,
        ...actions,
      } as DppRule;
    });
  }, [strategy, assets, shared, sharedName, prefix, existingNames, vlanPolicy, dot1x, qos, lldp, poeReset, bounce]);

  // Wen faengt eine gemeinsame Regel sonst noch ein? Das ist der wichtigste Check:
  // Vendor-/Typ-Matching wirkt auf alles am selben Port-Policy-Bereich, nicht nur
  // auf die markierten Geraete.
  const collateral = useMemo(() => {
    if (strategy !== 'shared' || !planned[0]) return [];
    const rule = planned[0];
    const selectedMacs = new Set(assets.map((a) => a.mac));
    return allAssets.filter((a) => !selectedMacs.has(a.mac) && a.portPolicy === dppName && ruleMatches(rule, a, null));
  }, [strategy, planned, assets, allAssets, dppName]);

  const nameClashes = planned.filter((p) => existingNames.includes(p.name));
  const catchAllIndex = (targetDpp?.policy ?? []).findIndex(isCatchAll);
  const canSubmit = !!dppName && planned.length > 0 && !nameClashes.length && !overLength.length;

  function submit() {
    if (!targetDpp) return;

    const drafts = planned.map((r) => createRule(dppName, r));

    // Platzierung: neue Regeln haengt FortiOS hinten an – deshalb ggf. verschieben.
    const rules = targetDpp.policy ?? [];
    let anchor: { position: 'before' | 'after'; ref: string } | null = null;
    if (placement === 'top' && rules[0]) anchor = { position: 'before', ref: rules[0].name };
    else if (placement === 'before-catch-all' && catchAllIndex >= 0) {
      anchor = { position: 'before', ref: rules[catchAllIndex].name };
    }

    const moves = anchor
      ? planned.map((r, i) =>
          i === 0
            ? moveRule(dppName, r.name, anchor!.position, anchor!.ref)
            : moveRule(dppName, r.name, 'after', planned[i - 1].name)
        )
      : [];

    cs.addMany([...drafts, ...moves]);
    toast('ok', `Staged ${pluralize(planned.length, 'rule')}`, 'Review them in the changes panel before applying.');
    onDone();
  }

  const vlanPolicies = ref?.['switch-controller/vlan-policy']?.results ?? [];
  const opt = (list: { name: string }[]) => list.map((v) => ({ value: v.name, label: v.name }));

  return (
    <Modal
      title="Create dynamic port policy rules"
      subtitle={`From ${pluralize(assets.length, 'selected device')}`}
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
      {!dpps.length && <Note kind="warn">There is no dynamic port policy yet. Create one on the Port Policies page first.</Note>}

      {/* Strategie */}
      <div className="fieldset">
        <legend>Match strategy</legend>
        <div className="grid grid-2">
          <button
            className={`btn ${strategy === 'per-mac' ? 'primary' : ''}`}
            style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', textAlign: 'left' }}
            onClick={() => setStrategy('per-mac')}
          >
            <Fingerprint size={15} />
            <div>
              <div style={{ fontWeight: 600 }}>One rule per MAC address</div>
              <div className="xs" style={{ opacity: 0.8 }}>
                Exactly these {assets.length} devices, nothing else. FortiOS has no MAC list field, so this means{' '}
                {assets.length} rules.
              </div>
            </div>
          </button>
          <button
            className={`btn ${strategy === 'shared' ? 'primary' : ''}`}
            style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px', textAlign: 'left' }}
            onClick={() => setStrategy('shared')}
          >
            <Layers size={15} />
            <div>
              <div style={{ fontWeight: 600 }}>One shared rule</div>
              <div className="xs" style={{ opacity: 0.8 }}>
                Matches on vendor / type / family instead. Covers future devices of the same kind automatically.
              </div>
            </div>
          </button>
        </div>

        {strategy === 'shared' && (
          <>
            <div className="row wrap">
              {SHARED_FIELDS.map((f) => {
                const values = new Set(assets.map((a) => f.from(a)).filter(Boolean));
                const single = values.size === 1;
                return (
                  <label className="check" key={f.key} title={single ? [...values][0] : `${values.size} different values in the selection`}>
                    <input
                      type="checkbox"
                      checked={!!useField[f.key]}
                      onChange={(e) => setUseField((p) => ({ ...p, [f.key]: e.target.checked }))}
                    />
                    {f.label}
                    <span className={`badge ${single ? 'green' : 'amber'} mono`}>{single ? truncate([...values][0], 18) : `${values.size} values`}</span>
                  </label>
                );
              })}
            </div>

            {sharedConflicts.length > 0 && (
              <Note kind="warn">
                {sharedConflicts.map((f) => f.label).join(', ')} {sharedConflicts.length === 1 ? 'has' : 'have'} more than one
                value across the selection, so {sharedConflicts.length === 1 ? 'it is' : 'they are'} left out of the rule.
                Either narrow the selection or switch to one rule per MAC.
              </Note>
            )}

            {Object.keys(shared).length === 0 && (
              <Note kind="err">
                No usable common criteria. A rule without criteria matches every device on the port — pick different fields or
                switch to one rule per MAC.
              </Note>
            )}

            {overLength.length > 0 && (
              <Note kind="err">
                {overLength.map(([k, v]) => `${k} is ${v.length} characters, FortiOS allows ${fields[k]?.size}`).join('; ')}.
                Shorten it — FortiOS matches these fields by prefix, so a truncated value still works.
              </Note>
            )}

            {collateral.length > 0 && (
              <Note kind="warn">
                <strong>This rule also matches {pluralize(collateral.length, 'device')} you did not select</strong> on the same
                policy: {collateral.slice(0, 6).map((a: Asset) => a.hostname || a.macDisplay).join(', ')}
                {collateral.length > 6 ? ` and ${collateral.length - 6} more` : ''}.
              </Note>
            )}
          </>
        )}
      </div>

      {/* Ziel und Benennung */}
      <div className="fieldset">
        <legend>Target and naming</legend>
        <div className="form-grid">
          <SelectField
            label="Dynamic port policy"
            name="dpp"
            value={dppName}
            onChange={setDppName}
            options={opt(projected)}
            allowEmpty={false}
            required
            hint="Rules are added to this policy's rule list."
          />
          <SelectField
            label="Position"
            name="placement"
            value={placement}
            onChange={(v) => setPlacement(v as Placement)}
            allowEmpty={false}
            options={[
              { value: 'before-catch-all', label: catchAllIndex >= 0 ? `Before the catch-all rule` : 'Before the catch-all (none present)' },
              { value: 'top', label: 'At the top' },
              { value: 'bottom', label: 'At the bottom (FortiOS default)' },
            ]}
            hint={
              catchAllIndex >= 0
                ? `"${(targetDpp?.policy ?? [])[catchAllIndex]?.name}" has no criteria and catches everything after it.`
                : 'Rules are evaluated top to bottom, first match wins.'
            }
          />
          {strategy === 'shared' ? (
            <TextField
              label="Rule name"
              name="name"
              field={fields.name}
              value={sharedName || slug(`${prefix}-${Object.values(shared).join('-') || 'group'}`)}
              onChange={setSharedName}
              mono
              required
            />
          ) : (
            <TextField
              label="Name prefix"
              name="prefix"
              value={prefix}
              onChange={setPrefix}
              mono
              hint="Each rule is named prefix-hostname, falling back to the MAC."
            />
          )}
        </div>

        {placement === 'bottom' && catchAllIndex >= 0 && (
          <Note kind="err">
            Placing rules after "{(targetDpp?.policy ?? [])[catchAllIndex]?.name}" means they will never match — that rule
            already catches every device.
          </Note>
        )}
        {nameClashes.length > 0 && (
          <Note kind="err">
            {nameClashes.length === 1
              ? `A rule named "${nameClashes[0].name}" already exists in this policy.`
              : `${nameClashes.length} of the generated names already exist in this policy.`}{' '}
            Change the prefix.
          </Note>
        )}
      </div>

      {/* Actions */}
      <div className="fieldset">
        <legend>Switch controller actions</legend>
        <div className="form-grid">
          <SelectField
            label="VLAN policy"
            name="vlan-policy"
            field={fields['vlan-policy']}
            value={vlanPolicy}
            onChange={setVlanPolicy}
            options={opt(vlanPolicies)}
            hint="The VLAN assignment applied to the port when the rule matches."
          />
          <SelectField label="802.1X policy" name="802-1x" field={fields['802-1x']} value={dot1x} onChange={setDot1x} options={opt(ref?.['switch-controller.security-policy/802-1X']?.results ?? [])} />
          <SelectField label="QoS policy" name="qos-policy" field={fields['qos-policy']} value={qos} onChange={setQos} options={opt(ref?.['switch-controller.qos/qos-policy']?.results ?? [])} />
          <SelectField label="LLDP profile" name="lldp-profile" field={fields['lldp-profile']} value={lldp} onChange={setLldp} options={opt(ref?.['switch-controller/lldp-profile']?.results ?? [])} />
          <SelectField label="Bounce port link" name="bounce-port-link" field={fields['bounce-port-link']} value={bounce} onChange={setBounce} allowEmpty={false} />
          <SelectField label="PoE reset" name="poe-reset" field={fields['poe-reset']} value={poeReset} onChange={setPoeReset} allowEmpty={false} />
        </div>
        {!vlanPolicy && !dot1x && !qos && !lldp && (
          <Note kind="warn">No action selected. The rules would match devices but change nothing on the port.</Note>
        )}
      </div>

      {/* Vorschau */}
      <div className="fieldset">
        <legend>
          <Wand2 size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Preview — {pluralize(planned.length, 'rule')}
        </legend>
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Match</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {planned.slice(0, 25).map((r) => (
                <tr key={r.name}>
                  <td className="mono xs">{r.name}</td>
                  <td className="xs">
                    {['mac', 'hw-vendor', 'type', 'family', 'host']
                      .filter((k) => r[k])
                      .map((k) => `${k}=${r[k]}`)
                      .join(' AND ') || <span className="dim">everything</span>}
                  </td>
                  <td className="xs">
                    {[r['vlan-policy'] && `vlan:${r['vlan-policy']}`, r['802-1x'] && `802.1x:${r['802-1x']}`, r['qos-policy'] && `qos:${r['qos-policy']}`, r['lldp-profile'] && `lldp:${r['lldp-profile']}`]
                      .filter(Boolean)
                      .join(' · ') || <span className="dim">none</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {planned.length > 25 && <div className="xs dim" style={{ padding: 8 }}>Showing the first 25 of {planned.length}.</div>}
        </div>
        {strategy === 'per-mac' && (
          <div className="xs dim">
            Members of this set share the name prefix <code>{prefix}-</code>, so they can be filtered and removed together
            later.
          </div>
        )}
      </div>
    </Modal>
  );
}
