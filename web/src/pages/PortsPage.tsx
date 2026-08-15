// ---------------------------------------------------------------------------
// Port Assignment.
//
// Der Schritt, ohne den nichts von alledem wirkt: Eine Dynamic Port Policy
// greift nur auf Ports mit access-mode "dynamic" und zugewiesener Policy.
// Diese Seite zeigt den Ist-Zustand pro Port und erlaubt die Zuweisung in Serie.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { LayoutGrid, Plug, RefreshCcw, Rows3, Users, Zap } from 'lucide-react';
import { useBouncePort, useInventory, useRefData } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import type { Asset, PortStatus, SwitchPort } from '@/api/types';
import { Empty, ErrorBox, Loading, Modal, Note } from '@/components/common';
import { applyFilter, emptyFilter, FilterBar, type FacetDef, type FilterState } from '@/components/FilterBar';
import { SelectField } from '@/components/fields';
import { HoverCard } from '@/components/HoverCard';
import { Faceplate, FaceplateLegend, portTone, type ColorMode } from '@/components/Faceplate';
import { projectDpps, projectSwitches, type Pending } from '@/lib/project';
import { setPort } from '@/lib/ops';
import { useSort, sortIndicator } from '@/lib/sort';
import { linkSpeed, members, pluralize, relTime } from '@/lib/format';

interface Row {
  switchId: string;
  switchDesc: string;
  port: Pending<SwitchPort>;
  /** Operativer Zustand aus dem Monitor, sofern lesbar. */
  status: PortStatus | null;
  /** Administrativ abgeschaltet (CMDB ports.status = down). */
  adminDown: boolean;
  /** Die Geraete an diesem Port – nicht nur ihre Anzahl. */
  devices: Asset[];
  matchedRules: string[];
}

/** Ein Wert, der Admin- und Link-Zustand zusammenfasst – so filtert man danach sinnvoll. */
function linkState(r: Row): 'admin-down' | 'up' | 'down' | 'unknown' {
  if (r.adminDown) return 'admin-down';
  if (!r.status) return 'unknown';
  return r.status.link === 'up' ? 'up' : 'down';
}

const LINK_LABEL: Record<string, string> = {
  up: 'Link up',
  down: 'Link down',
  'admin-down': 'Administratively down',
  unknown: 'Unknown',
};

/** Eine Suchfunktion fuer Tabelle und Facettenzaehlung – sonst laufen beide auseinander. */
const searchText = (r: Row) =>
  [
    r.switchId,
    r.switchDesc,
    r.port['port-name'],
    r.port.description,
    r.port['port-policy'],
    members(r.port['interface-tags'], 'tag-name').join(' '),
  ]
    .filter(Boolean)
    .join(' ');

const FACETS: FacetDef<Row>[] = [
  { key: 'switch', label: 'Switch', value: (r) => r.switchId },
  { key: 'link', label: 'Link', value: linkState, display: (v) => LINK_LABEL[v] ?? v },
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
  const [view, setView] = useState<'table' | 'faceplate'>('table');
  const [colorMode, setColorMode] = useState<ColorMode>('access-mode');

  const switches = useMemo(() => projectSwitches(ref?.['switch-controller/managed-switch']?.results ?? [], cs.ops), [ref, cs.ops]);
  const dpps = useMemo(() => projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops), [ref, cs.ops]);

  const rows = useMemo<Row[]>(() => {
    const assets = inventory?.assets ?? [];
    const byPort = new Map<string, Asset[]>();
    for (const a of assets) {
      if (!a.switchId || !a.portName) continue;
      const k = `${a.switchId}|${a.portName}`;
      const list = byPort.get(k);
      if (list) list.push(a);
      else byPort.set(k, [a]);
    }
    // Online zuerst, dann nach Name – so steht oben, was gerade zaehlt.
    for (const list of byPort.values()) {
      list.sort(
        (x, y) => Number(y.online) - Number(x.online) || (x.hostname || x.macDisplay).localeCompare(y.hostname || y.macDisplay)
      );
    }

    const statusMap = ref?._portStatus ?? {};

    return switches.flatMap((sw) =>
      (sw.ports ?? []).map((p) => {
        const k = `${sw['switch-id']}|${p['port-name']}`;
        const devices = byPort.get(k) ?? [];
        return {
          switchId: sw['switch-id'],
          switchDesc: sw.description ?? '',
          port: p as Pending<SwitchPort>,
          status: statusMap[k] ?? null,
          adminDown: p.status === 'down',
          devices,
          matchedRules: [...new Set(devices.map((d) => d.matchedRule).filter(Boolean))],
        };
      })
    );
  }, [switches, inventory, ref]);

  const filtered = useMemo(() => applyFilter(rows, filter, FACETS, searchText), [rows, filter]);

  const accessors = useMemo(
    () => ({
      // Portnamen numerisch sortieren, sonst steht port10 vor port2.
      port: (r: Row) => `${r.switchId} ${r.port['port-name']}`,
      link: (r: Row) => (r.adminDown ? -1 : r.status?.link === 'up' ? (r.status.speed ?? 1) : 0),
      description: (r: Row) => r.port.description ?? '',
      mode: (r: Row) => r.port['access-mode'] ?? 'static',
      policy: (r: Row) => r.port['port-policy'] ?? '',
      tags: (r: Row) => members(r.port['interface-tags'], 'tag-name').join(' '),
      devices: (r: Row) => r.devices.length,
    }),
    []
  );
  const { sorted, sort, toggle: toggleSort } = useSort(filtered, accessors);

  const key = (r: Row) => `${r.switchId}|${r.port['port-name']}`;
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(key(r)));

  const stats = useMemo(() => {
    const s = { dynamic: 0, nac: 0, static: 0, up: 0, adminDown: 0, haveStatus: false };
    for (const r of rows) {
      const m = r.port['access-mode'] ?? 'static';
      if (m === 'dynamic') s.dynamic++;
      else if (m === 'nac') s.nac++;
      else s.static++;
      if (r.adminDown) s.adminDown++;
      if (r.status) {
        s.haveStatus = true;
        if (r.status.link === 'up') s.up++;
      }
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
          {stats.haveStatus && (
            <>
              <span className="badge blue" title="Ports with an active link">
                {stats.up} up
              </span>
              {stats.adminDown > 0 && (
                <span className="badge red" title="Ports administratively disabled in the configuration">
                  {stats.adminDown} admin down
                </span>
              )}
              <div className="sep" />
            </>
          )}
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

      {/* Filter gilt fuer beide Ansichten, steht deshalb ausserhalb. */}
      <div className="panel">
        <FilterBar
          rows={rows}
          facets={FACETS}
          state={filter}
          onChange={setFilter}
          search={searchText}
          placeholder="Search switch, port, description, policy…"
          right={
            <div className="row">
              <span className="xs dim">
                {filtered.length} of {rows.length} ports
              </span>
              <div className="sep" />
              <div className="btn-group">
                <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
                  <Rows3 size={11} /> Table
                </button>
                <button className={view === 'faceplate' ? 'active' : ''} onClick={() => setView('faceplate')}>
                  <LayoutGrid size={11} /> Faceplate
                </button>
              </div>
            </div>
          }
        />
      </div>

      {view === 'faceplate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row wrap">
            <span className="xs dim">Colour by</span>
            <div className="btn-group">
              {(['access-mode', 'coverage', 'link'] as ColorMode[]).map((m) => (
                <button key={m} className={colorMode === m ? 'active' : ''} onClick={() => setColorMode(m)}>
                  {m === 'access-mode' ? 'Access mode' : m === 'coverage' ? 'Coverage' : 'Link'}
                </button>
              ))}
            </div>
            <div className="sep" />
            <FaceplateLegend mode={colorMode} />
          </div>

          {[...new Set(filtered.map((r) => r.switchId))].map((swId) => {
            const swPorts = filtered.filter((r) => r.switchId === swId);
            return (
              <Faceplate
                key={swId}
                switchId={swId}
                description={swPorts[0]?.switchDesc}
                ports={swPorts}
                colorMode={colorMode}
                selected={new Set(swPorts.filter((r) => selected.has(key(r))).map((r) => r.port['port-name']))}
                onToggle={(portName, additive) => {
                  const row = swPorts.find((r) => r.port['port-name'] === portName);
                  if (!row) return;
                  const k = key(row);
                  setSelected((prev) => {
                    const n = additive ? new Set(prev) : new Set(prev);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  });
                }}
                renderTooltip={(p) =>
                  [
                    p.port['port-name'],
                    p.port.description,
                    portTone(p, colorMode).label,
                    p.port['port-policy'] ? `policy ${p.port['port-policy']}` : null,
                    p.devices.length
                      ? p.devices.map((d) => `${d.hostname || d.macDisplay}${d.matchedRule ? ` → ${d.matchedRule}` : ' → no rule'}`).join('\n')
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n')
                }
              />
            );
          })}

          {filtered.length === 0 && (
            <div className="panel">
              <Empty title="No ports match" hint="Adjust the search or clear the filters." />
            </div>
          )}
        </div>
      )}

      <div
        className="panel"
        style={{ display: view === 'table' ? 'flex' : 'none', flexDirection: 'column', maxHeight: 'calc(100vh - 240px)' }}
      >
        <div className="tbl-wrap">
          <table className="tbl">
            <colgroup>
              <col style={{ width: 34 }} />
              <col style={{ width: 158 }} />
              <col style={{ width: 122 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 62 }} />
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
                <SortTh label="Port" col="port" sort={sort} onSort={toggleSort} />
                <SortTh label="Link" col="link" sort={sort} onSort={toggleSort} />
                <SortTh label="Description" col="description" sort={sort} onSort={toggleSort} />
                <SortTh label="Access mode" col="mode" sort={sort} onSort={toggleSort} />
                <SortTh label="Port policy" col="policy" sort={sort} onSort={toggleSort} />
                <SortTh label="Tags" col="tags" sort={sort} onSort={toggleSort} />
                <SortTh label="Devices seen" col="devices" sort={sort} onSort={toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <Empty title="No ports match" />
                  </td>
                </tr>
              )}
              {sorted.map((r) => {
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
                      <div className="xs dim mono truncate" title={r.switchDesc}>{r.switchId}</div>
                    </td>
                    <td>
                      <LinkCell row={r} />
                    </td>
                    <td className="xs">
                      {r.port.description ? (
                        <span className="truncate" title={r.port.description} style={{ display: 'block' }}>
                          {r.port.description}
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
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
                      <DevicesCell row={r} mode={mode} />
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

      </div>

      {/* Auswahl gilt in beiden Ansichten – die Leiste gehoert deshalb nach aussen. */}
      {selected.size > 0 && (
        <div className="panel">
          <div className="toolbar" style={{ borderBottom: 'none' }}>
            <Plug size={13} className="dim" />
            <span className="sm">{pluralize(selected.size, 'port')} selected</span>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <div className="spacer" />
            <button className="btn primary sm" onClick={() => setAssignOpen(true)}>
              <Zap size={12} /> Assign policy
            </button>
          </div>
        </div>
      )}

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

/** Sortierbarer Spaltenkopf. */
function SortTh({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: string;
  sort: ReturnType<typeof useSort>['sort'];
  onSort: (k: string) => void;
}) {
  const active = sort.key === col;
  return (
    <th
      className="sortable"
      onClick={() => onSort(col)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title="Sort by this column"
    >
      <span style={{ color: active ? 'var(--text)' : undefined }}>
        {label}
        {sortIndicator(sort, col)}
      </span>
    </th>
  );
}

/**
 * Die Geraete an einem Port. Die Zahl allein beantwortet die eigentliche Frage
 * nicht – beim Hovern (oder per Tastaturfokus) kommt die Liste mit Identitaet,
 * Adresse und getroffener Regel.
 */
function DevicesCell({ row, mode }: { row: Row; mode: string }) {
  const n = row.devices.length;

  if (n === 0) {
    return mode === 'dynamic' && !row.adminDown && row.status?.link === 'up' ? (
      <span className="dim" title="The link is up but the FortiGate has not classified a device here yet">
        link up, no device seen
      </span>
    ) : (
      <span className="dim">none</span>
    );
  }

  const online = row.devices.filter((d) => d.online).length;
  const unmatched = row.devices.filter((d) => !d.matchedRule).length;

  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <HoverCard
        width={430}
        label={`Show the ${pluralize(n, 'device')} on ${row.switchId} ${row.port['port-name']}`}
        content={<DevicePopover row={row} />}
      >
        <span className="badge gray mono">
          <Users size={9} /> {n}
        </span>
        {online < n && <span className="xs dim">{online} online</span>}
      </HoverCard>

      {row.matchedRules.length > 0 && (
        <span className="dim truncate" title={row.matchedRules.join(', ')}>
          {row.matchedRules.join(', ')}
        </span>
      )}
      {unmatched > 0 && mode === 'dynamic' && (
        <span style={{ color: 'var(--amber)' }}>{unmatched === n ? 'no rule matched' : `${unmatched} unmatched`}</span>
      )}
    </div>
  );
}

function DevicePopover({ row }: { row: Row }) {
  // Die Liste scrollt, deshalb ist ein enger Deckel unnoetig – erst bei sehr
  // vielen MACs an einem Port verweisen wir auf die Assets-Seite.
  const shown = row.devices.slice(0, 25);
  const rest = row.devices.length - shown.length;

  return (
    <>
      <div className="hovercard-head">
        <Users size={12} />
        <span>
          {pluralize(row.devices.length, 'device')} on {row.port['port-name']}
        </span>
        <div className="spacer" />
        <span className="mono" style={{ fontWeight: 400 }}>
          {row.switchId}
        </span>
      </div>

      <div className="hovercard-body">
        {shown.map((d) => (
          <div className="hc-row" key={d.mac}>
            <span className={`dot ${d.online ? 'on' : 'off'}`} style={{ marginTop: 6 }} />
            <div className="hc-main">
              <div className="hc-name truncate">
                {d.hostname || <span className="dim">unnamed</span>}
                {d.vlanId !== null && <span className="badge gray">vlan {d.vlanId}</span>}
              </div>
              <div className="hc-meta mono truncate">
                {d.macDisplay}
                {d.ipv4 && ` · ${d.ipv4}`}
              </div>
              <div className="hc-meta truncate">
                {[d.vendor, d.type, d.family].filter(Boolean).join(' · ') || <span className="dim">unidentified</span>}
              </div>
            </div>
            <div className="hc-side">
              {d.matchedRule ? (
                <span className="badge green" title={`Matched by ${d.matchedDpp} / ${d.matchedRule}`}>
                  {d.matchedRule}
                </span>
              ) : (
                <span className="badge amber">no rule</span>
              )}
              <span className="xs dim">{d.online ? relTime(d.lastSeen) : `offline · ${relTime(d.lastSeen)}`}</span>
            </div>
          </div>
        ))}
      </div>

      {rest > 0 && <div className="hovercard-foot">and {rest} more — open the Assets page for the full list</div>}
    </>
  );
}

/**
 * Link-Zustand eines Ports.
 *
 * Bewusst getrennt vom administrativen Zustand: Ein Port kann konfigurativ
 * abgeschaltet sein (CMDB ports.status = down) oder schlicht nichts
 * angeschlossen haben (Monitor: link down). Das sind verschiedene Befunde und
 * fuehren zu verschiedenen Massnahmen.
 */
function LinkCell({ row }: { row: Row }) {
  if (row.adminDown) {
    return (
      <span className="badge red" title="Administratively disabled in the switch configuration (set status down)">
        admin down
      </span>
    );
  }

  if (!row.status) {
    return (
      <span className="dim xs" title="No live status available for this port">
        —
      </span>
    );
  }

  const up = row.status.link === 'up';
  const speed = linkSpeed(row.status.speed);
  const poe = row.status.portPower && row.status.portPower > 0 ? `${row.status.portPower} W PoE` : null;

  return (
    <div title={[up ? 'Link up' : 'Link down', speed, row.status.duplex ? `${row.status.duplex} duplex` : '', poe].filter(Boolean).join(' · ')}>
      <div className="row" style={{ gap: 6 }}>
        <span className={`dot ${up ? 'on' : 'off'}`} />
        <span className="xs" style={{ fontWeight: up ? 500 : 400, color: up ? undefined : 'var(--text-dim)' }}>
          {up ? speed || 'up' : 'down'}
        </span>
      </div>
      {poe && <div className="xs dim">{poe}</div>}
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

  const withDevices = rows.filter((r) => r.devices.length > 0);
  const adminDown = rows.filter((r) => r.adminDown);
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

      {adminDown.length > 0 && (
        <Note kind="warn">
          {pluralize(adminDown.length, 'selected port is', 'selected ports are')} administratively down. The policy will be
          stored, but nothing happens there until the port is enabled again.
        </Note>
      )}

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>Port</th>
              <th>Link</th>
              <th>Now</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 40).map((r) => (
              <tr key={`${r.switchId}|${r.port['port-name']}`}>
                <td>
                  <div className="mono xs">
                    {r.switchId} / {r.port['port-name']}
                  </div>
                  {r.port.description && <div className="xs dim truncate">{r.port.description}</div>}
                </td>
                <td>
                  <LinkCell row={r} />
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
