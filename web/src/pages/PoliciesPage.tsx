// ---------------------------------------------------------------------------
// Dynamic Port Policies.
//
// Links die Policies, rechts ihre Regelliste in Auswertungsreihenfolge. Die
// Reihenfolge ist hier kein Darstellungsdetail: FortiOS nimmt die erste
// passende Regel, alles darunter ist tot.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CircleSlash,
  Copy,
  ListTree,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { useInventory, useRefData, useSchema } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import type { DppRule } from '@/api/types';
import { Empty, ErrorBox, Loading, Modal, Note } from '@/components/common';
import { RuleEditor } from '@/components/RuleEditor';
import { ComboField, TextField } from '@/components/fields';
import { fortiLinkOptions, type FortiLinkOption } from '@/lib/fortilink';
import { projectDpps, type Pending } from '@/lib/project';
import { countPerRule, isCatchAll, ruleKey } from '@/lib/match';
import { createDpp, createRule, deleteDpp, deleteRule, modifyRule, moveRule } from '@/lib/ops';
import { dppFields } from '@/lib/schema';
import { pluralize, slug } from '@/lib/format';

export function PoliciesPage() {
  const { dpp: routeDpp } = useParams();
  const nav = useNavigate();
  const { data: ref, isLoading, error } = useRefData();
  const { data: inventory } = useInventory();
  const { data: schema } = useSchema();
  const cs = useChangeset();
  const toast = useToast();

  const [editing, setEditing] = useState<{ rule: DppRule | null } | null>(null);
  const [newDpp, setNewDpp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'dpp' | 'rule'; name: string } | null>(null);

  const dpps = useMemo(
    () => projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops),
    [ref, cs.ops]
  );

  const selectedName = routeDpp ?? dpps[0]?.name ?? '';
  const selected = dpps.find((d) => d.name === selectedName);

  useEffect(() => {
    if (!routeDpp && dpps[0]) nav(`/policies/${encodeURIComponent(dpps[0].name)}`, { replace: true });
  }, [routeDpp, dpps, nav]);

  const switches = ref?.['switch-controller/managed-switch']?.results ?? [];
  const assets = inventory?.assets ?? [];

  const hitCounts = useMemo(() => countPerRule(assets, { dpps, switches }), [assets, dpps, switches]);

  /** Auf wie vielen Ports ist diese Policy aktiv? Ohne Port wirkt sie gar nicht. */
  const portUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const sw of switches) {
      for (const p of sw.ports ?? []) {
        if (p['access-mode'] === 'dynamic' && p['port-policy']) {
          m.set(p['port-policy'], (m.get(p['port-policy']) ?? 0) + 1);
        }
      }
    }
    return m;
  }, [switches]);

  if (isLoading) return <div className="page"><Loading label="Loading policies…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const rules = (selected?.policy ?? []) as Pending<DppRule>[];
  const catchAllIndex = rules.findIndex((r) => r.__pending !== 'delete' && isCatchAll(r));

  function saveRule(rule: DppRule) {
    if (!selected) return;
    const original = (ref?.['switch-controller/dynamic-port-policy']?.results ?? [])
      .find((d) => d.name === selected.name)
      ?.policy?.find((r) => r.name === rule.name);

    if (editing?.rule && original) cs.add(modifyRule(selected.name, original, rule));
    else if (editing?.rule) cs.add(modifyRule(selected.name, editing.rule, rule));
    else {
      cs.add(createRule(selected.name, rule));
      // Neue Regeln landen bei FortiOS hinten – vor einem Catch-All einsortieren.
      if (catchAllIndex >= 0) cs.add(moveRule(selected.name, rule.name, 'before', rules[catchAllIndex].name));
    }
    setEditing(null);
    toast('ok', 'Rule staged', 'Review it in the changes panel.');
  }

  function move(index: number, dir: -1 | 1) {
    if (!selected) return;
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    cs.add(moveRule(selected.name, rules[index].name, dir === -1 ? 'before' : 'after', rules[target].name));
  }

  function duplicate(rule: DppRule) {
    if (!selected) return;
    const taken = new Set(rules.map((r) => r.name));
    let name = `${rule.name}-copy`;
    let n = 2;
    while (taken.has(name)) name = `${rule.name}-copy${n++}`;
    setEditing({ rule: { ...rule, name } });
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dynamic Port Policies</h1>
          <div className="page-sub">
            Rules are evaluated top to bottom and the first match wins. A policy only takes effect on switch ports set to
            dynamic access mode.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setNewDpp(true)}>
            <Plus size={13} /> New policy
          </button>
          <button className="btn primary" onClick={() => setEditing({ rule: null })} disabled={!selected}>
            <Plus size={13} /> New rule
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 14, alignItems: 'start' }}>
        {/* Policy-Liste */}
        <div className="panel">
          <div className="panel-head">
            <ListTree size={14} className="dim" />
            <span className="panel-title">Policies</span>
            <span className="panel-sub">{dpps.length}</span>
          </div>
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {dpps.length === 0 && <div className="xs dim" style={{ padding: 10 }}>No dynamic port policies yet.</div>}
            {dpps.map((d) => {
              const ports = portUsage.get(d.name) ?? 0;
              return (
                <button
                  key={d.name}
                  className={`nav-item ${d.name === selectedName ? 'active' : ''}`}
                  style={{ border: 'none', background: d.name === selectedName ? 'var(--accent-soft)' : 'transparent', textAlign: 'left' }}
                  onClick={() => nav(`/policies/${encodeURIComponent(d.name)}`)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 5 }}>
                      <span className="truncate" style={{ fontWeight: 500 }}>{d.name}</span>
                      {d.__pending && <span className={`op-kind ${d.__pending}`}>{d.__pending}</span>}
                    </div>
                    <div className="xs dim">
                      {pluralize((d.policy ?? []).length, 'rule')} ·{' '}
                      {ports === 0 ? <span style={{ color: 'var(--amber)' }}>no ports</span> : `${ports} ports`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Regelliste */}
        {!selected ? (
          <div className="panel">
            <Empty title="No policy selected" hint="Create a dynamic port policy to start defining rules." />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">{selected.name}</span>
                {selected.description && <span className="panel-sub">{selected.description}</span>}
                <div className="panel-actions">
                  <span className="badge gray mono" title="FortiLink interface">
                    {selected.fortilink ?? '—'}
                  </span>
                  <button
                    className="btn ghost icon sm"
                    title="Delete this policy"
                    onClick={() => setConfirmDelete({ kind: 'dpp', name: selected.name })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {(portUsage.get(selected.name) ?? 0) === 0 && (
                <div style={{ padding: 12, paddingBottom: 0 }}>
                  <Note kind="warn">
                    <strong>This policy is not assigned to any switch port.</strong> Its rules will never run. Assign it on the{' '}
                    <a href="/ports" style={{ textDecoration: 'underline' }}>Port Assignment</a> page and set those ports to
                    dynamic access mode.
                  </Note>
                </div>
              )}

              <div className="tbl-wrap">
                <table className="tbl">
                  <colgroup>
                    <col style={{ width: 40 }} />
                    <col style={{ width: 190 }} />
                    <col />
                    <col style={{ width: 210 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 108 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Rule</th>
                      <th>Match</th>
                      <th>Actions</th>
                      <th className="num">Devices</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.length === 0 && (
                      <tr>
                        <td colSpan={6}>
                          <Empty title="No rules yet" hint="Add a rule, or generate rules from the Assets page." />
                        </td>
                      </tr>
                    )}
                    {rules.map((r, i) => {
                      const shadowed = catchAllIndex >= 0 && i > catchAllIndex && r.__pending !== 'delete';
                      const n = hitCounts.get(ruleKey(selected.name, r.name)) ?? 0;
                      const disabled = r.status === 'disable';
                      return (
                        <tr key={r.name} style={{ opacity: r.__pending === 'delete' ? 0.45 : 1 }}>
                          <td className="num dim">{i + 1}</td>
                          <td>
                            <div className="row" style={{ gap: 5 }}>
                              {disabled && <Ban size={11} style={{ color: 'var(--text-dim)' }} />}
                              <span
                                className="truncate"
                                style={{ fontWeight: 500, textDecoration: r.__pending === 'delete' ? 'line-through' : undefined }}
                              >
                                {r.name}
                              </span>
                              {r.__pending && <span className={`op-kind ${r.__pending}`}>{r.__pending}</span>}
                            </div>
                            {r.description && <div className="xs dim truncate">{r.description}</div>}
                            {shadowed && (
                              <div className="xs" style={{ color: 'var(--amber)' }}>
                                <AlertTriangle size={9} /> unreachable
                              </div>
                            )}
                          </td>
                          <td className="xs">
                            <MatchSummary rule={r} />
                          </td>
                          <td className="xs">
                            <ActionSummary rule={r} />
                          </td>
                          <td className="num">
                            {n > 0 ? (
                              <span className="badge green mono" title="Devices the simulator expects to match this rule">
                                <Users size={9} /> {n}
                              </span>
                            ) : (
                              <span className="dim">0</span>
                            )}
                          </td>
                          <td>
                            <div className="row" style={{ gap: 1, justifyContent: 'flex-end' }}>
                              <button className="btn ghost icon sm" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                                <ArrowUp size={12} />
                              </button>
                              <button className="btn ghost icon sm" title="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                                <ArrowDown size={12} />
                              </button>
                              <button className="btn ghost icon sm" title="Duplicate" onClick={() => duplicate(r)}>
                                <Copy size={12} />
                              </button>
                              <button className="btn ghost icon sm" title="Edit" onClick={() => setEditing({ rule: r })}>
                                <Pencil size={12} />
                              </button>
                              <button
                                className="btn ghost icon sm"
                                title="Delete"
                                onClick={() => setConfirmDelete({ kind: 'rule', name: r.name })}
                              >
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

            {catchAllIndex >= 0 && catchAllIndex < rules.length - 1 && (
              <Note kind="warn">
                <strong>"{rules[catchAllIndex].name}" has no match criteria</strong> and catches every device.{' '}
                {pluralize(rules.length - catchAllIndex - 1, 'rule')} below it can never match. Move the catch-all to the
                bottom.
              </Note>
            )}
          </div>
        )}
      </div>

      {editing && selected && (
        <RuleEditor
          dppName={selected.name}
          rule={editing.rule}
          existingNames={rules.map((r) => r.name)}
          assets={assets}
          onSave={saveRule}
          onClose={() => setEditing(null)}
        />
      )}

      {newDpp && (
        <NewDppModal
          taken={dpps.map((d) => d.name)}
          fortilinks={fortiLinkOptions(ref?.['system/interface']?.results ?? [], {
            dpps,
            vlanPolicies: ref?.['switch-controller/vlan-policy']?.results ?? [],
          })}
          onClose={() => setNewDpp(false)}
          onCreate={(d) => {
            cs.add(createDpp(d));
            setNewDpp(false);
            nav(`/policies/${encodeURIComponent(d.name)}`);
            toast('ok', `Policy "${d.name}" staged`);
          }}
          fields={dppFields(schema)}
        />
      )}

      {confirmDelete && selected && (
        <Modal
          title={confirmDelete.kind === 'dpp' ? 'Delete dynamic port policy' : 'Delete rule'}
          onClose={() => setConfirmDelete(null)}
          size="narrow"
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirmDelete.kind === 'dpp') {
                    cs.add(deleteDpp(selected));
                  } else {
                    const r = rules.find((x) => x.name === confirmDelete.name);
                    if (r) cs.add(deleteRule(selected.name, r));
                  }
                  setConfirmDelete(null);
                }}
              >
                <Trash2 size={13} /> Stage deletion
              </button>
            </>
          }
        >
          <Note kind="warn">
            <CircleSlash size={12} style={{ verticalAlign: -2 }} /> Deleting <strong>{confirmDelete.name}</strong> is staged,
            not executed. It runs when you apply the changeset.
          </Note>
          {confirmDelete.kind === 'dpp' && (portUsage.get(selected.name) ?? 0) > 0 && (
            <Note kind="err">
              This policy is assigned to {pluralize(portUsage.get(selected.name) ?? 0, 'port')}. The FortiGate will refuse the
              deletion until those ports are changed.
            </Note>
          )}
        </Modal>
      )}
    </div>
  );
}

// --- Zusammenfassungen -----------------------------------------------------

function MatchSummary({ rule }: { rule: DppRule }) {
  if (rule.category === 'interface-tag') {
    const tags = (rule['interface-tags'] ?? []).map((t) => t['tag-name']);
    return tags.length ? (
      <span className="tag-list">
        {tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </span>
    ) : (
      <span className="dim">no tags</span>
    );
  }

  const parts = (['mac', 'hw-vendor', 'type', 'family', 'host'] as const)
    .filter((k) => rule[k])
    .map((k) => (
      <span className="tag" key={k}>
        <span className="dim">{k}</span> {String(rule[k])}
      </span>
    ));

  return parts.length ? <span className="tag-list">{parts}</span> : <span className="badge amber">catch-all</span>;
}

function ActionSummary({ rule }: { rule: DppRule }) {
  const items: { label: string; tone: string }[] = [];
  if (rule['vlan-policy']) items.push({ label: rule['vlan-policy'], tone: 'blue' });
  if (rule['802-1x']) items.push({ label: rule['802-1x'], tone: 'violet' });
  if (rule['qos-policy']) items.push({ label: rule['qos-policy'], tone: 'teal' });
  if (rule['lldp-profile']) items.push({ label: rule['lldp-profile'], tone: 'gray' });
  if (rule['poe-reset'] === 'enable') items.push({ label: 'PoE reset', tone: 'amber' });

  if (!items.length) return <span className="dim">none</span>;
  return (
    <span className="tag-list">
      {items.map((i) => (
        <span className={`badge ${i.tone}`} key={i.label}>
          {i.label}
        </span>
      ))}
    </span>
  );
}

// --- Neue Policy -----------------------------------------------------------

function NewDppModal({
  taken,
  fortilinks,
  fields,
  onClose,
  onCreate,
}: {
  taken: string[];
  fortilinks: FortiLinkOption[];
  fields: ReturnType<typeof dppFields>;
  onClose: () => void;
  onCreate: (d: { name: string; description?: string; fortilink: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fortilink, setFortilink] = useState(fortilinks[0]?.name ?? 'fortilink');

  const clash = taken.some((t) => t.toLowerCase() === name.trim().toLowerCase());
  const ok = !!name.trim() && !clash && !!fortilink.trim();

  return (
    <Modal
      title="New dynamic port policy"
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={() => onCreate({ name: name.trim(), description, fortilink })}>
            <Plus size={13} /> Stage policy
          </button>
        </>
      }
    >
      <TextField
        label="Name"
        name="name"
        field={fields.name}
        value={name}
        onChange={(v) => setName(slug(v))}
        error={clash ? 'A policy with this name already exists' : null}
        required
        mono
      />
      <TextField label="Description" name="description" field={fields.description} value={description} onChange={setDescription} />
      <ComboField
        label="FortiLink interface"
        name="fortilink"
        field={fields.fortilink}
        value={fortilink}
        onChange={setFortilink}
        options={fortilinks.map((f) => ({
          value: f.name,
          label: f.source === 'referenced' ? `${f.name} — used by an existing policy` : `${f.name} — ${f.type ?? 'interface'}`,
        }))}
        placeholder="fortilink"
        required
        hint="Required by FortiOS. Identifies which FortiLink fabric this policy belongs to. Pick a suggestion or type the name."
      />
      {fortilinks.length === 0 && (
        <Note kind="warn">
          No interface with <code>fortilink: enable</code> was returned for this VDOM. You can still type the name — check the
          spelling against <code>show system interface</code> on the FortiGate.
        </Note>
      )}
    </Modal>
  );
}
