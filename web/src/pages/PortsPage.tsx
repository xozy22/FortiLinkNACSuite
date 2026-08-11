// ---------------------------------------------------------------------------
// Port Assignment.
//
// Der Schritt, ohne den nichts von alledem wirkt: Eine Dynamic Port Policy
// greift nur auf Ports mit access-mode "dynamic" und zugewiesener Policy.
// Diese Seite zeigt den Ist-Zustand pro Port und erlaubt die Zuweisung in Serie.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Plug, RefreshCcw, Zap } from 'lucide-react';
import { useBouncePort, useInventory, useRefData } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import type { SwitchPort } from '@/api/types';
import { Empty, ErrorBox, Loading, Modal, Note } from '@/components/common';
import { applyFilter, emptyFilter, FilterBar, type FacetDef, type FilterState } from '@/components/FilterBar';
import { SelectField } from '@/components/fields';
import { projectDpps, projectSwitches, type Pending } from '@/lib/project';
import { setPort } from '@/lib/ops';
import { members, pluralize } from '@/lib/format';

interface Row {
  switchId: string;
  switchDesc: string;
  port: Pending<SwitchPort>;
  devices: number;
  matchedRules: string[];
}

const FACETS: FacetDef<Row>[] = [
  { key: 'switch', label: 'Switch', value: (r) => r.switchId },
  { key: 'mode', label: 'Access mode', value: (r) => r.port['access-mode'] ?? 'static' },
  { key: 'policy', label: 'Port policy', value: (r) => r.port['port-policy'] ?? '' },
  { key: 'tag', label: 'Tag', value: (r) => members(r.port['interface-tags'], 'tag-name')[0] ?? '' },
];

export function PortsPage() {
  const { data: ref, isLoading, error } = useRefData();
  const { data: inventory } = useInventory();
  const cs = useChangeset();
  const toast = useToast();
  const bounce = useBouncePort();

  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);

  const switches = useMemo(() => projectSwitches(ref?.['switch-controller/managed-switch']?.results ?? [], cs.ops), [ref, cs.ops]);
  const dpps = useMemo(() => projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops), [ref, cs.ops]);

  const rows = useMemo<Row[]>(() => {
    const assets = inventory?.assets ?? [];
    const byPort = new Map<string, { n: number; rules: Set<string> }>();
    for (const a of assets) {
      if (!a.switchId || !a.portName) continue;
      const k = `${a.switchId}|${a.portName}`;
      const e = byPort.get(k) ?? { n: 0, rules: new Set<string>() };
      e.n++;
      if (a.matchedRule) e.rules.add(a.matchedRule);
      byPort.set(k, e);
    }

    return switches.flatMap((sw) =>
      (sw.ports ?? []).map((p) => {
        const e = byPort.get(`${sw['switch-id']}|${p['port-name']}`);
        return {
          switchId: sw['switch-id'],
          switchDesc: sw.description ?? '',
          port: p as Pending<SwitchPort>,
          devices: e?.n ?? 0,
          matchedRules: [...(e?.rules ?? [])],
        };
      })
    );
  }, [switches, inventory]);

  const filtered = useMemo(
    () =>
      applyFilter(rows, filter, FACETS, (r) =>
        [r.switchId, r.port['port-name'], r.port.description, r.port['port-policy'], members(r.port['interface-tags'], 'tag-name').join(' ')]
          .filter(Boolean)
          .join(' ')
      ),
    [rows, filter]
  );

  const key = (r: Row) => `${r.switchId}|${r.port['port-name']}`;
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(key(r)));

  const stats = useMemo(() => {
    const s = { dynamic: 0, nac: 0, static: 0 };
    for (const r of rows) {
      const m = r.port['access-mode'] ?? 'static';
      if (m === 'dynamic') s.dynamic++;
      else if (m === 'nac') s.nac++;
      else s.static++;
    }
    return s;
  }, [rows]);

  if (isLoading) return <div className="page"><Loading label="Loading switch ports…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const selectedRows = filtered.filter((r) => selected.has(key(r)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Port Assignment</h1>
          <div className="page-sub">
            A dynamic port policy runs only where a port is in dynamic access mode and has that policy attached. Everything
            else stays statically configured.
          </div>
        </div>
        <div className="page-actions">
          <span className="badge green">{stats.dynamic} dynamic</span>
          {stats.nac > 0 && <span className="badge violet">{stats.nac} nac</span>}
          <span className="badge gray">{stats.static} static</span>
        </div>
      </div>

      {stats.dynamic === 0 && (
        <Note kind="warn">
          <strong>No port is in dynamic access mode.</strong> Until at least one port is switched over, dynamic port policies
          have no effect anywhere.
        </Note>
      )}

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 240px)' }}>
        <FilterBar
          rows={rows}
          facets={FACETS}
          state={filter}
          onChange={setFilter}
          search={(r) => [r.switchId, r.port['port-name'], r.port['port-policy']].filter(Boolean).join(' ')}
          placeholder="Search switch, port, policy…"
          right={<span className="xs dim">{filtered.length} of {rows.length} ports</span>}
        />

        <div className="tbl-wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 150 }} />
              <col />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (allSelected) filtered.forEach((r) => n.delete(key(r)));
                        else filtered.forEach((r) => n.add(key(r)));
                        return n;
                      })
                    }
                    aria-label="Select all visible ports"
                  />
                </th>
                <th>Port</th>
                <th>Access mode</th>
                <th>Port policy</th>
                <th>Tags</th>
                <th>Devices seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <Empty title="No ports match" />
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const mode = r.port['access-mode'] ?? 'static';
                const k = key(r);
                return (
                  <tr key={k} className={selected.has(k) ? 'selected' : ''}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={() =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            if (n.has(k)) n.delete(k);
                            else n.add(k);
                            return n;
                          })
                        }
                        aria-label={`Select ${k}`}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 5 }}>
                        <span className="mono" style={{ fontWeight: 500 }}>{r.port['port-name']}</span>
                        {r.port.__pending && <span className={`op-kind ${r.port.__pending}`}>{r.port.__pending}</span>}
                      </div>
                      <div className="xs dim mono truncate">{r.switchId}</div>
                    </td>
                    <td>
                      <span className={`badge ${mode === 'dynamic' ? 'green' : mode === 'nac' ? 'violet' : 'gray'}`}>{mode}</span>
                    </td>
                    <td className="xs">
                      {r.port['port-policy'] ? (
                        <span className="mono">{r.port['port-policy']}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                      {r.port['matched-dpp-policy'] && r.port['matched-dpp-policy'] !== r.port['port-policy'] && (
                        <div className="xs dim">matched: {r.port['matched-dpp-policy']}</div>
                      )}
                    </td>
                    <td className="xs">
                      {members(r.port['interface-tags'], 'tag-name').length ? (
                        <span className="tag-list">
                          {members(r.port['interface-tags'], 'tag-name').map((t) => (
                            <span className="tag" key={t}>{t}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="xs">
                      {r.devices === 0 ? (
                        <span className="dim">none</span>
                      ) : (
                        <>
                          <span className="badge gray mono">{r.devices}</span>{' '}
                          {r.matchedRules.length > 0 && <span className="dim">{r.matchedRules.join(', ')}</span>}
                          {r.matchedRules.length === 0 && mode === 'dynamic' && (
                            <span style={{ color: 'var(--amber)' }}>no rule matched</span>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn ghost icon sm"
                        title="Bounce this port — forces connected devices to be re-evaluated"
                        disabled={bounce.isPending}
                        onClick={async () => {
                          try {
                            await bounce.mutateAsync({ switchId: r.switchId, port: r.port['port-name'], duration: 1 });
                            toast('ok', `Bounced ${r.switchId} / ${r.port['port-name']}`);
                          } catch (e) {
                            const err = e as { message?: string; hint?: string };
                            toast('err', 'Bounce failed', err.hint ?? err.message);
                          }
                        }}
                      >
                        <RefreshCcw size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selected.size > 0 && (
          <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
            <Plug size={13} className="dim" />
            <span className="sm">{pluralize(selected.size, 'port')} selected</span>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
            <div className="spacer" />
            <button className="btn primary sm" onClick={() => setAssignOpen(true)}>
              <Zap size={12} /> Assign policy
            </button>
          </div>
        )}
      </div>

      {assignOpen && (
        <AssignModal
          rows={selectedRows}
          dppNames={dpps.map((d) => d.name)}
          onClose={() => setAssignOpen(false)}
          onApply={(mode, policy) => {
            for (const r of selectedRows) {
              cs.add(setPort(r.switchId, r.port, { 'access-mode': mode, 'port-policy': mode === 'dynamic' ? policy : '' }));
            }
            setAssignOpen(false);
            setSelected(new Set());
            toast('ok', `Staged changes for ${pluralize(selectedRows.length, 'port')}`);
          }}
        />
      )}
    </div>
  );
}

function AssignModal({
  rows,
  dppNames,
  onClose,
  onApply,
}: {
  rows: Row[];
  dppNames: string[];
  onClose: () => void;
  onApply: (mode: 'dynamic' | 'static', policy: string) => void;
}) {
  const [mode, setMode] = useState<'dynamic' | 'static'>('dynamic');
  const [policy, setPolicy] = useState(dppNames[0] ?? '');

  const withDevices = rows.filter((r) => r.devices > 0);
  const ok = mode === 'static' || !!policy;

  return (
    <Modal
      title={`Assign ${pluralize(rows.length, 'port')}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok} onClick={() => onApply(mode, policy)}>
            Stage changes
          </button>
        </>
      }
    >
      <div className="form-grid">
        <SelectField
          label="Access mode"
          name="access-mode"
          value={mode}
          onChange={(v) => setMode(v as 'dynamic' | 'static')}
          allowEmpty={false}
          options={[
            { value: 'dynamic', label: 'dynamic — apply a dynamic port policy' },
            { value: 'static', label: 'static — leave the port manually configured' },
          ]}
        />
        {mode === 'dynamic' && (
          <SelectField
            label="Dynamic port policy"
            name="port-policy"
            value={policy}
            onChange={setPolicy}
            options={dppNames.map((n) => ({ value: n, label: n }))}
            allowEmpty={false}
            required
          />
        )}
      </div>

      {mode === 'static' && (
        <Note kind="warn">
          Switching these ports back to static removes them from NAC control. Devices keep whatever VLAN the port has
          statically configured.
        </Note>
      )}

      {withDevices.length > 0 && (
        <Note kind="warn">
          {pluralize(withDevices.length, 'of the selected ports has', 'of the selected ports have')} devices connected right
          now. Changing the access mode can interrupt them briefly while the port is re-evaluated.
        </Note>
      )}

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>Port</th>
              <th>Now</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={`${r.switchId}|${r.port['port-name']}`}>
                <td className="mono xs">
                  {r.switchId} / {r.port['port-name']}
                </td>
                <td className="xs dim">
                  {r.port['access-mode'] ?? 'static'}
                  {r.port['port-policy'] ? ` · ${r.port['port-policy']}` : ''}
                </td>
                <td className="xs" style={{ color: 'var(--diff-add)' }}>
                  {mode}
                  {mode === 'dynamic' && policy ? ` · ${policy}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 40 && <div className="xs dim" style={{ padding: 8 }}>Showing the first 40 of {rows.length}.</div>}
      </div>
    </Modal>
  );
}
