// ---------------------------------------------------------------------------
// VLAN Policies – die zentrale Switch-Controller-Action einer DPP-Regel.
// Legt fest, welches native VLAN ein Port bekommt und welche VLANs zusaetzlich
// erlaubt sind, wenn eine Regel greift.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Cable, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRefData, useSchema } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import type { SystemInterface, VlanPolicy } from '@/api/types';
import { Empty, ErrorBox, Loading, Modal, Note, Val } from '@/components/common';
import { ComboField, MemberField, SelectField, TextField } from '@/components/fields';
import { fortiLinkOptions, vlanLabel, vlansUnder, type FortiLinkOption } from '@/lib/fortilink';
import { projectDpps, projectVlanPolicies } from '@/lib/project';
import { createVlanPolicy, deleteVlanPolicy, modifyVlanPolicy } from '@/lib/ops';
import { vlanPolicyFields } from '@/lib/schema';
import { members, pluralize, slug } from '@/lib/format';

export function VlanPoliciesPage() {
  const { data: ref, isLoading, error } = useRefData();
  const { data: schema } = useSchema();
  const cs = useChangeset();
  const toast = useToast();
  const [editing, setEditing] = useState<{ policy: VlanPolicy | null } | null>(null);
  const [confirm, setConfirm] = useState<VlanPolicy | null>(null);

  const policies = useMemo(
    () => projectVlanPolicies(ref?.['switch-controller/vlan-policy']?.results ?? [], cs.ops),
    [ref, cs.ops]
  );

  const dpps = useMemo(() => projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops), [ref, cs.ops]);

  /** Welche Regeln verweisen auf diese VLAN Policy? Wichtig vor dem Loeschen. */
  const usage = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const d of dpps) {
      for (const r of d.policy ?? []) {
        const vp = r['vlan-policy'];
        if (!vp) continue;
        m.set(vp, [...(m.get(vp) ?? []), `${d.name}/${r.name}`]);
      }
    }
    return m;
  }, [dpps]);

  const interfaces = ref?.['system/interface']?.results ?? [];

  if (isLoading) return <div className="page"><Loading label="Loading VLAN policies…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">VLAN Policies</h1>
          <div className="page-sub">
            What a dynamic port policy rule actually does to the port: which native VLAN it gets and which VLANs are allowed
            or untagged on top of that.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setEditing({ policy: null })}>
            <Plus size={13} /> New VLAN policy
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <Cable size={14} className="dim" />
          <span className="panel-title">Policies</span>
          <span className="panel-sub">{policies.length}</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Native VLAN</th>
                <th>Allowed</th>
                <th>Untagged</th>
                <th>Discard</th>
                <th>Used by</th>
                <th style={{ width: 74 }} />
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty title="No VLAN policies" hint="A dynamic port policy rule needs one of these to assign a VLAN." />
                  </td>
                </tr>
              )}
              {policies.map((p) => {
                const used = usage.get(p.name) ?? [];
                return (
                  <tr key={p.name} style={{ opacity: p.__pending === 'delete' ? 0.45 : 1 }}>
                    <td>
                      <div className="row" style={{ gap: 5 }}>
                        <span style={{ fontWeight: 500, textDecoration: p.__pending === 'delete' ? 'line-through' : undefined }}>
                          {p.name}
                        </span>
                        {p.__pending && <span className={`op-kind ${p.__pending}`}>{p.__pending}</span>}
                      </div>
                      {p.description && <div className="xs dim">{p.description}</div>}
                    </td>
                    <td className="mono xs">
                      <Val>{p.vlan}</Val>
                    </td>
                    <td className="xs">
                      {p['allowed-vlans-all'] === 'enable' ? (
                        <span className="badge blue">all VLANs</span>
                      ) : (
                        <VlanList names={members(p['allowed-vlans'], 'vlan-name')} />
                      )}
                    </td>
                    <td className="xs">
                      <VlanList names={members(p['untagged-vlans'], 'vlan-name')} />
                    </td>
                    <td className="xs">
                      {p['discard-mode'] && p['discard-mode'] !== 'none' ? (
                        <span className="badge amber">{p['discard-mode']}</span>
                      ) : (
                        <span className="dim">none</span>
                      )}
                    </td>
                    <td className="xs">
                      {used.length ? (
                        <span title={used.join('\n')} className="badge gray">
                          {pluralize(used.length, 'rule')}
                        </span>
                      ) : (
                        <span className="dim">unused</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 1, justifyContent: 'flex-end' }}>
                        <button className="btn ghost icon sm" title="Edit" onClick={() => setEditing({ policy: p })}>
                          <Pencil size={12} />
                        </button>
                        <button className="btn ghost icon sm" title="Delete" onClick={() => setConfirm(p)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <VlanPolicyEditor
          policy={editing.policy}
          taken={policies.map((p) => p.name)}
          interfaces={interfaces}
          fortilinks={fortiLinkOptions(interfaces, { dpps, vlanPolicies: policies })}
          fields={vlanPolicyFields(schema)}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            const original = (ref?.['switch-controller/vlan-policy']?.results ?? []).find((v) => v.name === next.name);
            cs.add(original ? modifyVlanPolicy(original, next) : createVlanPolicy(next));
            setEditing(null);
            toast('ok', `VLAN policy "${next.name}" staged`);
          }}
        />
      )}

      {confirm && (
        <Modal
          title="Delete VLAN policy"
          onClose={() => setConfirm(null)}
          size="narrow"
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  cs.add(deleteVlanPolicy(confirm));
                  setConfirm(null);
                }}
              >
                <Trash2 size={13} /> Stage deletion
              </button>
            </>
          }
        >
          <Note kind="warn">
            Deleting <strong>{confirm.name}</strong> is staged, not executed.
          </Note>
          {(usage.get(confirm.name) ?? []).length > 0 && (
            <Note kind="err">
              Still referenced by {(usage.get(confirm.name) ?? []).join(', ')}. The FortiGate will reject the deletion until
              those rules point somewhere else.
            </Note>
          )}
        </Modal>
      )}
    </div>
  );
}

function VlanList({ names }: { names: string[] }) {
  if (!names.length) return <span className="dim">—</span>;
  return (
    <span className="tag-list">
      {names.slice(0, 4).map((n) => (
        <span className="tag" key={n}>
          {n}
        </span>
      ))}
      {names.length > 4 && <span className="xs dim">+{names.length - 4}</span>}
    </span>
  );
}

// --- Editor ----------------------------------------------------------------

function VlanPolicyEditor({
  policy,
  taken,
  interfaces,
  fortilinks,
  fields,
  onClose,
  onSave,
}: {
  policy: VlanPolicy | null;
  taken: string[];
  interfaces: SystemInterface[];
  fortilinks: FortiLinkOption[];
  fields: ReturnType<typeof vlanPolicyFields>;
  onClose: () => void;
  onSave: (p: VlanPolicy) => void;
}) {
  const isNew = !policy;

  const [draft, setDraft] = useState<VlanPolicy>(() => ({
    name: policy?.name ?? '',
    description: policy?.description ?? '',
    fortilink: policy?.fortilink ?? fortilinks[0]?.name ?? 'fortilink',
    vlan: policy?.vlan ?? '',
    'allowed-vlans': policy?.['allowed-vlans'] ?? [],
    'untagged-vlans': policy?.['untagged-vlans'] ?? [],
    'allowed-vlans-all': policy?.['allowed-vlans-all'] ?? 'disable',
    'discard-mode': policy?.['discard-mode'] ?? 'none',
  }));

  const set = <K extends keyof VlanPolicy,>(k: K, v: VlanPolicy[K]) => setDraft((d) => ({ ...d, [k]: v }));

  // Nur VLANs, die an dieser FortiLink-Schnittstelle haengen, sind sinnvoll.
  const vlans = useMemo(() => vlansUnder(interfaces, draft.fortilink), [interfaces, draft.fortilink]);

  const clash = isNew && taken.some((t) => t.toLowerCase() === draft.name.trim().toLowerCase());
  const ok = !!draft.name.trim() && !clash && !!String(draft.fortilink ?? '').trim();

  return (
    <Modal
      title={isNew ? 'New VLAN policy' : `Edit "${policy?.name}"`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
            {isNew ? 'Stage policy' : 'Stage changes'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <TextField
          label="Name"
          name="name"
          field={fields.name}
          value={draft.name}
          onChange={(v) => set('name', slug(v))}
          disabled={!isNew}
          error={clash ? 'A VLAN policy with this name already exists' : null}
          required
          mono
        />
        <TextField label="Description" name="description" field={fields.description} value={draft.description ?? ''} onChange={(v) => set('description', v)} />
        <ComboField
          label="FortiLink interface"
          name="fortilink"
          field={fields.fortilink}
          value={draft.fortilink ?? ''}
          onChange={(v) => set('fortilink', v)}
          options={fortilinks.map((f) => ({
            value: f.name,
            label: f.source === 'referenced' ? `${f.name} — used by an existing policy` : `${f.name} — ${f.type ?? 'interface'}`,
          }))}
          placeholder="fortilink"
          required
        />
        <SelectField
          label="Native VLAN"
          name="vlan"
          field={fields.vlan}
          value={draft.vlan ?? ''}
          onChange={(v) => set('vlan', v)}
          options={vlans.map((i) => ({ value: i.name, label: vlanLabel(i) }))}
          hint="Untagged traffic on the port lands here."
        />
      </div>

      <div className="fieldset">
        <legend>Additional VLANs</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={draft['allowed-vlans-all'] === 'enable'}
            onChange={(e) => set('allowed-vlans-all', e.target.checked ? 'enable' : 'disable')}
          />
          Allow all defined VLANs
        </label>

        {draft['allowed-vlans-all'] !== 'enable' && (
          <MemberField
            label="Allowed VLANs (tagged)"
            field={fields['allowed-vlans']}
            memberKey="vlan-name"
            value={(draft['allowed-vlans'] ?? []) as { [k: string]: string }[]}
            onChange={(v) => set('allowed-vlans', v as VlanPolicy['allowed-vlans'])}
            available={vlans.map((i) => i.name)}
            emptyMeaning="native VLAN only"
          />
        )}

        <MemberField
          label="Untagged VLANs"
          field={fields['untagged-vlans']}
          memberKey="vlan-name"
          value={(draft['untagged-vlans'] ?? []) as { [k: string]: string }[]}
          onChange={(v) => set('untagged-vlans', v as VlanPolicy['untagged-vlans'])}
          available={vlans.map((i) => i.name)}
          emptyMeaning="none"
        />

        <SelectField
          label="Discard mode"
          name="discard-mode"
          field={fields['discard-mode']}
          value={draft['discard-mode'] ?? 'none'}
          onChange={(v) => set('discard-mode', v as VlanPolicy['discard-mode'])}
          allowEmpty={false}
          hint="Drops frames of the given kind on the port. Useful to stop a printer or camera from sending tagged traffic."
        />
      </div>

      {vlans.length === 0 && (
        <Note kind="warn">
          No VLAN interfaces were returned for this VDOM. Create the VLANs on the FortiGate first — this tool does not create
          interfaces.
        </Note>
      )}
    </Modal>
  );
}
