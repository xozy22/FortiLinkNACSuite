// ---------------------------------------------------------------------------
// Asset-Inventar – die Kernansicht.
//
// Alles, was die FortiGate ueber ein Geraet weiss, in einer Zeile: Identitaet,
// Standort am Switch und die Regel, die dort gerade greift. Aus der Auswahl
// heraus entstehen die Regeln, statt sie von Hand nachzubauen.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { Download, FileUp, Layers, ListPlus, RefreshCw, Repeat2, Rows3 } from 'lucide-react';
import { useInventory, useRefData } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { projectDpps } from '@/lib/project';
import { ReplaceDeviceDialog } from '@/components/ReplaceDeviceDialog';
import { CsvImportWizard } from '@/components/CsvImportWizard';
import type { Asset } from '@/api/types';
import { CoverageBadge, Empty, ErrorBox, Loading, Note, OnlineDot, Val } from '@/components/common';
import { applyFilter, emptyFilter, FilterBar, type FacetDef, type FilterState } from '@/components/FilterBar';
import { ColumnPicker, loadColumns, renderExtra } from '@/components/ColumnPicker';
import { useSort, sortIndicator } from '@/lib/sort';
import { downloadCsv, relTime } from '@/lib/format';
import { BulkRuleWizard } from '@/components/BulkRuleWizard';
import { simulateAll, compareWithFortiGate } from '@/lib/match';

type GroupBy = 'none' | 'vendor' | 'type' | 'family' | 'switchId' | 'coverage';

const FACETS: FacetDef<Asset>[] = [
  { key: 'coverage', label: 'Coverage', value: (a) => a.coverage },
  { key: 'vendor', label: 'Vendor', value: (a) => a.vendor },
  { key: 'type', label: 'Type', value: (a) => a.type },
  { key: 'family', label: 'Family', value: (a) => a.family },
  { key: 'os', label: 'OS', value: (a) => a.os },
  { key: 'switch', label: 'Switch', value: (a) => a.switchId },
  { key: 'policy', label: 'Port policy', value: (a) => a.portPolicy },
  { key: 'rule', label: 'Matched rule', value: (a) => a.matchedRule },
  { key: 'online', label: 'State', value: (a) => (a.online ? 'online' : 'offline') },
];

const searchText = (a: Asset) =>
  [a.macDisplay, a.hostname, a.ipv4, a.vendor, a.type, a.family, a.os, a.switchId, a.portName, a.matchedRule, a.matchedDpp]
    .filter(Boolean)
    .join(' ');

export function AssetsPage() {
  const { data, isLoading, error, refetch, isFetching } = useInventory();
  const { data: ref } = useRefData();
  const cs = useChangeset();
  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [extraColumns, setExtraColumns] = useState<string[]>(() => loadColumns());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wizard, setWizard] = useState(false);
  /** Offener Tausch-Dialog, vorbelegt mit der angeklickten Seite des Tauschs. */
  const [replacing, setReplacing] = useState<{ oldMac: string; newMac: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const assets = data?.assets ?? [];
  const filtered = useMemo(() => applyFilter(assets, filter, FACETS, searchText), [assets, filter]);

  // Sortierung. Die Gruppierung hat Vorrang – innerhalb einer Gruppe wird sortiert.
  const accessors = useMemo(
    () => ({
      device: (a: Asset) => a.hostname || a.macDisplay,
      address: (a: Asset) => a.ipv4,
      lastSeen: (a: Asset) => a.lastSeen ?? Number.MAX_SAFE_INTEGER,
      classification: (a: Asset) => [a.vendor, a.type].filter(Boolean).join(' '),
      location: (a: Asset) => `${a.switchId} ${String(a.portId ?? '').padStart(4, '0')}`,
      rule: (a: Asset) => a.matchedRule,
      coverage: (a: Asset) => a.coverage,
      ...Object.fromEntries(extraColumns.map((k) => [`x:${k}`, (a: Asset) => renderExtra(a.raw?.[k])])),
    }),
    [extraColumns]
  );
  const { sorted, sort, toggle: toggleSort } = useSort(filtered, accessors);

  // Ist-Abgleich: weicht unsere Auswertung von dem ab, was die FortiGate meldet?
  const divergences = useMemo(() => {
    if (!ref || !assets.length) return [];
    const ctx = {
      dpps: ref['switch-controller/dynamic-port-policy'].results,
      switches: ref['switch-controller/managed-switch'].results,
    };
    return compareWithFortiGate(assets, simulateAll(assets, ctx));
  }, [assets, ref]);

  const rows = useMemo(() => buildRows(sorted, groupBy), [sorted, groupBy]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === 'group' ? 30 : 42),
    overscan: 14,
  });

  const selectedAssets = useMemo(() => assets.filter((a) => selected.has(a.mac)), [assets, selected]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.mac));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((a) => next.delete(a.mac));
      else filtered.forEach((a) => next.add(a.mac));
      return next;
    });
  }

  function toggleOne(mac: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mac)) next.delete(mac);
      else next.add(mac);
      return next;
    });
  }

  function exportCsv() {
    downloadCsv(
      `assets-${new Date().toISOString().slice(0, 10)}.csv`,
      ['MAC', 'Hostname', 'IPv4', 'Vendor', 'Type', 'Family', 'OS', 'Online', 'Switch', 'Port', 'VLAN', 'Access mode', 'Port policy', 'Matched DPP', 'Matched rule', 'Coverage'],
      filtered.map((a) => [a.macDisplay, a.hostname, a.ipv4, a.vendor, a.type, a.family, `${a.os} ${a.osVersion}`.trim(), a.online ? 'yes' : 'no', a.switchId, a.portName, a.vlanId, a.accessMode, a.portPolicy, a.matchedDpp, a.matchedRule, a.coverage])
    );
  }

  if (isLoading) return <div className="page"><Loading label="Reading the device inventory…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  return (
    <div className="page flush">
      <div style={{ padding: '16px 20px 0' }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">Assets</h1>
            <div className="page-sub">
              Every device the FortiGate has detected, joined with where it sits on the switch fabric and which rule applies
              to it right now.
            </div>
          </div>
          <div className="page-actions">
            <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={13} /> CSV
            </button>
            <button className="btn" onClick={() => refetch()}>
              <RefreshCw size={13} className={isFetching ? 'spin' : ''} /> Refresh
            </button>
            <button
              className="btn"
              onClick={() => setCsvOpen(true)}
              title="Create rules from a device list — for hardware the FortiGate has not seen yet"
            >
              <FileUp size={13} /> Import list
            </button>
            <button
              className="btn"
              onClick={() => setReplacing({ oldMac: '', newMac: selectedAssets.length === 1 ? selectedAssets[0].mac : '' })}
              title="A device was swapped out — move its rules to the replacement's MAC address"
            >
              <Repeat2 size={13} /> Replace device
            </button>
            <button className="btn primary" disabled={!selected.size} onClick={() => setWizard(true)}>
              <ListPlus size={13} /> Create rules ({selected.size})
            </button>
          </div>
        </div>

        {data?.warnings?.length ? (
          <Note kind="warn" className="" >
            <strong>Some sources could not be read.</strong>{' '}
            {data.warnings.map((w) => `${w.source}: ${w.message}`).join(' · ')}
          </Note>
        ) : null}

        {divergences.length > 0 && (
          <Note kind="info" className="">
            <strong>{divergences.length} device{divergences.length === 1 ? '' : 's'} differ from the simulation.</strong> The
            FortiGate re-evaluates a device only when it reconnects, so a rule you changed earlier may not have taken effect
            yet. The <em>Matched rule</em> column always shows what the FortiGate actually reports.
          </Note>
        )}
      </div>

      <div style={{ padding: '12px 20px 0' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)' }}>
          <FilterBar
            rows={assets}
            facets={FACETS}
            state={filter}
            onChange={setFilter}
            search={searchText}
            placeholder="Search MAC, hostname, IP, vendor…"
            right={
              <div className="row">
                <span className="xs dim">
                  {filtered.length} of {assets.length}
                </span>
                <div className="sep" />
                <ColumnPicker fields={data?.fields ?? []} selected={extraColumns} onChange={setExtraColumns} />
                <Layers size={12} className="dim" />
                <select className="select" style={{ width: 'auto', padding: '4px 24px 4px 8px', fontSize: 'var(--fs-xs)' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                  <option value="none">No grouping</option>
                  <option value="vendor">Group by vendor</option>
                  <option value="type">Group by type</option>
                  <option value="family">Group by family</option>
                  <option value="switchId">Group by switch</option>
                  <option value="coverage">Group by coverage</option>
                </select>
              </div>
            }
          />

          <div className="tbl-wrap" ref={scrollRef}>
            {rows.length === 0 ? (
              <Empty title="No devices match" hint="Adjust the search or clear the filters." />
            ) : (
              <table className="tbl" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 34 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 190 }} />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 190 }} />
                  <col style={{ width: 110 }} />
                  {extraColumns.map((k) => (
                    <col key={k} style={{ width: 150 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="col-check">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all visible" />
                    </th>
                    <SortTh label="Device" col="device" sort={sort} onSort={toggleSort} />
                    <SortTh label="Address" col="address" sort={sort} onSort={toggleSort} />
                    <SortTh label="Classification" col="classification" sort={sort} onSort={toggleSort} />
                    <SortTh label="Location" col="location" sort={sort} onSort={toggleSort} />
                    <SortTh label="Applied rule" col="rule" sort={sort} onSort={toggleSort} />
                    <SortTh label="Coverage" col="coverage" sort={sort} onSort={toggleSort} />
                    {extraColumns.map((k) => (
                      <SortTh key={k} label={k} col={`x:${k}`} sort={sort} onSort={toggleSort} mono />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ height: virt.getVirtualItems()[0]?.start ?? 0 }} />
                  {virt.getVirtualItems().map((v) => {
                    const row = rows[v.index];
                    if (row.kind === 'group') {
                      return (
                        <tr key={`g-${row.label}`} style={{ height: v.size }}>
                          <td colSpan={7 + extraColumns.length} style={{ background: 'var(--bg-panel-2)', fontWeight: 600, fontSize: 'var(--fs-xs)', letterSpacing: '0.3px' }}>
                            <span className="dim" style={{ textTransform: 'uppercase' }}>{row.label || '(unclassified)'}</span>
                            <span className="badge gray" style={{ marginLeft: 8 }}>{row.count}</span>
                          </td>
                        </tr>
                      );
                    }
                    const a = row.asset;
                    return (
                      <tr key={a.mac} className={selected.has(a.mac) ? 'selected' : ''} style={{ height: v.size }}>
                        <td className="col-check">
                          <input type="checkbox" checked={selected.has(a.mac)} onChange={() => toggleOne(a.mac)} aria-label={`Select ${a.macDisplay}`} />
                        </td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <OnlineDot online={a.online} />
                            <span className="truncate" style={{ fontWeight: a.hostname ? 500 : 400 }}>
                              {a.hostname || <span className="dim">unnamed</span>}
                            </span>
                          </div>
                          <div className="xs dim mono truncate">{a.macDisplay}</div>
                        </td>
                        <td>
                          <div className="mono xs truncate"><Val>{a.ipv4}</Val></div>
                          <div className="xs dim">{a.lastSeen !== null ? relTime(a.lastSeen) : '—'}</div>
                        </td>
                        <td>
                          <div className="truncate xs">
                            <Val>{a.vendor}</Val>
                          </div>
                          <div className="xs dim truncate">
                            {[a.type, a.family, a.os].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td>
                          {a.onSwitch ? (
                            <>
                              <div className="mono xs truncate">{a.switchId}</div>
                              <div className="xs dim">
                                {a.portName}
                                {a.vlanId !== null && ` · vlan ${a.vlanId}`}
                                {a.accessMode && a.accessMode !== 'dynamic' && (
                                  <span className="badge red" style={{ marginLeft: 5 }}>{a.accessMode}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <span className="dim xs">not on a switch port</span>
                          )}
                        </td>
                        <td>
                          {a.matchedRule ? (
                            <>
                              <div className="truncate xs" style={{ fontWeight: 500 }}>{a.matchedRule}</div>
                              <div className="xs dim truncate">{a.matchedDpp}</div>
                            </>
                          ) : (
                            <span className="dim xs">—</span>
                          )}
                        </td>
                        <td>
                          <CoverageBadge value={a.coverage} />
                        </td>
                        {extraColumns.map((k) => {
                          const v = renderExtra(a.raw?.[k]);
                          return (
                            <td key={k} className="xs mono">
                              {v ? <span className="truncate" style={{ display: 'block' }} title={v}>{v}</span> : <span className="dim">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr style={{ height: Math.max(0, virt.getTotalSize() - (virt.getVirtualItems().at(-1)?.end ?? 0)) }} />
                </tbody>
              </table>
            )}
          </div>

          {selected.size > 0 && (
            <div className="toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
              <Rows3 size={13} className="dim" />
              <span className="sm">{selected.size} selected</span>
              <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              <div className="spacer" />
              <button className="btn primary sm" onClick={() => setWizard(true)}>
                <ListPlus size={12} /> Create dynamic port policy rules
              </button>
            </div>
          )}
        </div>
      </div>

      {csvOpen && (
        <CsvImportWizard
          dpps={projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops)}
          assets={assets}
          onClose={() => setCsvOpen(false)}
        />
      )}

      {replacing && (
        <ReplaceDeviceDialog
          dpps={projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops)}
          assets={assets}
          initialOldMac={replacing.oldMac}
          initialNewMac={replacing.newMac}
          onClose={() => setReplacing(null)}
        />
      )}

      {wizard && (
        <BulkRuleWizard
          assets={selectedAssets}
          allAssets={assets}
          onClose={() => setWizard(false)}
          onDone={() => {
            setWizard(false);
            setSelected(new Set());
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
  mono,
}: {
  label: string;
  col: string;
  sort: ReturnType<typeof useSort>['sort'];
  onSort: (k: string) => void;
  mono?: boolean;
}) {
  const active = sort.key === col;
  return (
    <th
      className={`sortable ${mono ? 'mono' : ''}`}
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

// --- Gruppierung -----------------------------------------------------------

type Row = { kind: 'group'; label: string; count: number } | { kind: 'asset'; asset: Asset };

function buildRows(assets: Asset[], groupBy: GroupBy): Row[] {
  if (groupBy === 'none') return assets.map((a) => ({ kind: 'asset', asset: a }));

  const groups = new Map<string, Asset[]>();
  for (const a of assets) {
    const key = String(a[groupBy] ?? '');
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }

  const out: Row[] = [];
  for (const [label, list] of [...groups.entries()].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]))) {
    out.push({ kind: 'group', label, count: list.length });
    for (const a of list) out.push({ kind: 'asset', asset: a });
  }
  return out;
}
