// ---------------------------------------------------------------------------
// Editor fuer eine einzelne DPP-Regel.
//
// Die Felder kommen aus dem CMDB-Schema, ebenso Laengengrenzen und Optionen.
// Der Match-Block wechselt mit der Kategorie: "device" matcht auf Geraetedaten,
// "interface-tag" auf Tags des Switch-Ports.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Crosshair, Info, Save, Sparkles, Target } from 'lucide-react';
import type { Asset, DppRule, KnownCriteria } from '@/api/types';
import { useRefData, useSchema } from '@/api/hooks';
import { ruleFields } from '@/lib/schema';
import { Modal, Note } from './common';
import { MemberField, NumberField, SelectField, TextField, ToggleField } from './fields';
import { isMac, normMac, pluralize } from '@/lib/format';
import { ruleMatches } from '@/lib/match';

const MATCH_FIELDS = ['mac', 'hw-vendor', 'type', 'family', 'host'] as const;

export function RuleEditor({
  dppName,
  rule,
  existingNames,
  assets,
  onSave,
  onClose,
}: {
  dppName: string;
  /** null = neue Regel */
  rule: DppRule | null;
  existingNames: string[];
  assets: Asset[];
  onSave: (rule: DppRule) => void;
  onClose: () => void;
}) {
  const { data: schema } = useSchema();
  const { data: ref } = useRefData();
  const fields = ruleFields(schema);
  const isNew = !rule;

  const [draft, setDraft] = useState<DppRule>(() => ({
    name: rule?.name ?? '',
    description: rule?.description ?? '',
    status: rule?.status ?? 'enable',
    category: rule?.category ?? 'device',
    'match-type': rule?.['match-type'] ?? 'dynamic',
    'match-period': rule?.['match-period'] ?? 0,
    'match-remove': rule?.['match-remove'] ?? 'default',
    'interface-tags': rule?.['interface-tags'] ?? [],
    mac: rule?.mac ?? '',
    'hw-vendor': rule?.['hw-vendor'] ?? '',
    type: rule?.type ?? '',
    family: rule?.family ?? '',
    host: rule?.host ?? '',
    'vlan-policy': rule?.['vlan-policy'] ?? '',
    '802-1x': rule?.['802-1x'] ?? '',
    'qos-policy': rule?.['qos-policy'] ?? '',
    'lldp-profile': rule?.['lldp-profile'] ?? '',
    'bounce-port-link': rule?.['bounce-port-link'] ?? 'enable',
    'bounce-port-duration': rule?.['bounce-port-duration'] ?? 5,
    'poe-reset': rule?.['poe-reset'] ?? 'disable',
  }));

  const set = <K extends keyof DppRule,>(k: K, v: DppRule[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const isTagRule = draft.category === 'interface-tag';
  const hasMatch = isTagRule
    ? (draft['interface-tags'] ?? []).length > 0
    : MATCH_FIELDS.some((k) => draft[k]);
  const hasAction = !!(draft['vlan-policy'] || draft['802-1x'] || draft['qos-policy'] || draft['lldp-profile']);

  const nameTaken = isNew && existingNames.some((n) => n.toLowerCase() === draft.name.trim().toLowerCase());
  const macInvalid = !!draft.mac && !isMac(draft.mac);
  const nameError = !draft.name.trim() ? 'A name is required' : nameTaken ? 'A rule with this name already exists' : null;

  // Live-Vorschau: welche bekannten Geraete wuerde diese Regel treffen?
  const hits = useMemo(() => {
    if (!hasMatch && !isTagRule) return [];
    return assets.filter((a) => a.portPolicy === dppName && ruleMatches(draft, a, null));
  }, [assets, draft, dppName, hasMatch, isTagRule]);

  const opt = (list: { name: string }[] | undefined) => (list ?? []).map((v) => ({ value: v.name, label: v.name }));
  const canSave = !nameError && !macInvalid;

  return (
    <Modal
      title={isNew ? 'New rule' : `Edit rule "${rule?.name}"`}
      subtitle={`in dynamic port policy "${dppName}"`}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave({ ...draft, name: draft.name.trim() })} disabled={!canSave}>
            <Save size={13} /> {isNew ? 'Stage new rule' : 'Stage changes'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Rule name"
          name="name"
          field={fields.name}
          value={draft.name}
          onChange={(v) => set('name', v)}
          error={nameError}
          disabled={!isNew}
          required
          mono
          hint={!isNew ? 'The name is the key on the FortiGate and cannot be changed here.' : undefined}
        />
        <TextField label="Description" name="description" field={fields.description} value={draft.description ?? ''} onChange={(v) => set('description', v)} />
        <SelectField label="Category" name="category" field={fields.category} value={draft.category ?? 'device'} onChange={(v) => set('category', v as DppRule['category'])} allowEmpty={false} />
        <SelectField label="Status" name="status" field={fields.status} value={draft.status ?? 'enable'} onChange={(v) => set('status', v as DppRule['status'])} allowEmpty={false} />
      </div>

      {/* Match */}
      <div className="fieldset">
        <legend>
          <Crosshair size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Match criteria
        </legend>

        {isTagRule ? (
          <MemberField
            label="Interface tags"
            field={fields['interface-tags']}
            memberKey="tag-name"
            value={(draft['interface-tags'] ?? []) as { [k: string]: string }[]}
            onChange={(v) => set('interface-tags', v as DppRule['interface-tags'])}
            available={(ref?.['switch-controller/switch-interface-tag']?.results ?? []).map((t) => t.name)}
            emptyMeaning="no tags selected"
            hint="The rule applies to ports carrying all of these tags. Device properties are ignored in this category."
          />
        ) : (
          <>
            <div className="form-grid">
              <TextField
                label="MAC address"
                name="mac"
                field={fields.mac}
                value={draft.mac ?? ''}
                onChange={(v) => set('mac', v.trim() ? normMac(v) : '')}
                placeholder="aa:bb:cc:dd:ee:ff"
                mono
                error={macInvalid ? 'Not a valid MAC address' : null}
                hint="Exact match, one address per rule."
              />
              <TextField label="Hardware vendor" name="hw-vendor" field={fields['hw-vendor']} value={draft['hw-vendor'] ?? ''} onChange={(v) => set('hw-vendor', v)} placeholder="Fortinet" hint="Prefix match." />
              <TextField label="Type" name="type" field={fields.type} value={draft.type ?? ''} onChange={(v) => set('type', v)} placeholder="IP Phone" hint="Prefix match." />
              <TextField label="Family" name="family" field={fields.family} value={draft.family ?? ''} onChange={(v) => set('family', v)} placeholder="FortiFone" hint="Prefix match." />
              <TextField label="Host" name="host" field={fields.host} value={draft.host ?? ''} onChange={(v) => set('host', v)} placeholder="printer-*" hint="Prefix match on the detected hostname." />
            </div>

            <KnownCriteriaPicker
              list={ref?._knownCriteria ?? []}
              onPick={(d) => {
                set('hw-vendor', d.hw_vendor ?? '');
                set('type', d.type ?? '');
                set('family', d.family ?? '');
                set('host', d.host ?? '');
              }}
            />
          </>
        )}

        {!hasMatch && (
          <Note kind="warn">
            No criteria set — this rule matches <strong>every</strong> device on ports using this policy. That is only useful
            as the last rule in the list.
          </Note>
        )}

        {hasMatch && (
          <div className="row">
            <Target size={12} className="dim" />
            <span className="xs muted">
              Matches {pluralize(hits.length, 'known device')} on this policy right now
              {hits.length > 0 && `: ${hits.slice(0, 5).map((a) => a.hostname || a.macDisplay).join(', ')}`}
              {hits.length > 5 ? ` and ${hits.length - 5} more` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="fieldset">
        <legend>Switch controller actions</legend>
        <div className="form-grid">
          <SelectField label="VLAN policy" name="vlan-policy" field={fields['vlan-policy']} value={draft['vlan-policy'] ?? ''} onChange={(v) => set('vlan-policy', v)} options={opt(ref?.['switch-controller/vlan-policy']?.results)} />
          <SelectField label="802.1X policy" name="802-1x" field={fields['802-1x']} value={draft['802-1x'] ?? ''} onChange={(v) => set('802-1x', v)} options={opt(ref?.['switch-controller.security-policy/802-1X']?.results)} />
          <SelectField label="QoS policy" name="qos-policy" field={fields['qos-policy']} value={draft['qos-policy'] ?? ''} onChange={(v) => set('qos-policy', v)} options={opt(ref?.['switch-controller.qos/qos-policy']?.results)} />
          <SelectField label="LLDP profile" name="lldp-profile" field={fields['lldp-profile']} value={draft['lldp-profile'] ?? ''} onChange={(v) => set('lldp-profile', v)} options={opt(ref?.['switch-controller/lldp-profile']?.results)} />
        </div>

        <ToggleField label="Bounce port link" field={fields['bounce-port-link']} value={draft['bounce-port-link']} onChange={(v) => set('bounce-port-link', v as 'enable' | 'disable')} />
        {draft['bounce-port-link'] === 'enable' && (
          <div style={{ maxWidth: 220 }}>
            <NumberField
              label="Bounce duration"
              name="bounce-port-duration"
              field={fields['bounce-port-duration']}
              value={draft['bounce-port-duration']}
              onChange={(v) => set('bounce-port-duration', v)}
              suffix="seconds"
            />
          </div>
        )}
        <ToggleField label="PoE reset" field={fields['poe-reset']} value={draft['poe-reset']} onChange={(v) => set('poe-reset', v as 'enable' | 'disable')} />

        {!hasAction && draft['poe-reset'] !== 'enable' && (
          <Note kind="warn">This rule applies no action — it would match devices without changing anything on the port.</Note>
        )}
      </div>

      {/* Retention */}
      <div className="fieldset">
        <legend>Retention</legend>
        <div className="form-grid">
          <SelectField
            label="Match type"
            name="match-type"
            field={fields['match-type']}
            value={draft['match-type'] ?? 'dynamic'}
            onChange={(v) => set('match-type', v as DppRule['match-type'])}
            allowEmpty={false}
            hint="Dynamic drops the match on link down or inactivity. Override keeps it for the match period."
          />
          {draft['match-type'] === 'override' && (
            <>
              <NumberField label="Match period" name="match-period" field={fields['match-period']} value={draft['match-period']} onChange={(v) => set('match-period', v)} suffix="days" hint="0 keeps the match forever." />
              <SelectField label="Remove on" name="match-remove" field={fields['match-remove']} value={draft['match-remove'] ?? 'default'} onChange={(v) => set('match-remove', v as DppRule['match-remove'])} allowEmpty={false} />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function KnownCriteriaPicker({ list, onPick }: { list: KnownCriteria[]; onPick: (d: KnownCriteria['device']) => void }) {
  const [open, setOpen] = useState(false);
  if (!list.length) return null;

  return (
    <div>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>
        <Sparkles size={12} /> Use a known device template
      </button>
      {open && (
        <div className="panel" style={{ marginTop: 8 }}>
          <table className="tbl">
            <tbody>
              {list.map((k) => (
                <tr
                  key={k.name}
                  className="clickable"
                  onClick={() => {
                    onPick(k.device);
                    setOpen(false);
                  }}
                >
                  <td style={{ fontWeight: 500 }}>{k.name}</td>
                  <td className="xs dim">{k.description}</td>
                  <td className="xs mono dim">
                    {Object.entries(k.device)
                      .filter(([, v]) => v)
                      .map(([kk, v]) => `${kk}=${v}`)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="xs dim row" style={{ padding: 8 }}>
            <Info size={11} /> Templates come from the FortiGate itself
            (monitor/switch-controller/known-nac-device-criteria-list).
          </div>
        </div>
      )}
    </div>
  );
}
