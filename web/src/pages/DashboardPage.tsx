// ---------------------------------------------------------------------------
// Dashboard.
//
// Beantwortet vier Fragen auf einen Blick: Wie viele Geraete kennt die Anlage,
// wie viele davon werden von einer Regel erfasst, wo laeuft NAC ueberhaupt, und
// naehert sich etwas einer Grenze der FortiGate.
// ---------------------------------------------------------------------------
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CircleAlert, Cpu, ListTree, Network, Plug, ShieldCheck } from 'lucide-react';
import { useInventory, useRefData, useSchema } from '@/api/hooks';
import { useChangeset } from '@/state/changeset';
import { ErrorBox, Loading, Note, Stat } from '@/components/common';
import { projectDpps } from '@/lib/project';
import { isCatchAll } from '@/lib/match';
import { absTime, pluralize } from '@/lib/format';

export function DashboardPage() {
  const { data: inv, isLoading, error } = useInventory();
  const { data: ref } = useRefData();
  const { data: schema } = useSchema();
  const cs = useChangeset();

  const dpps = useMemo(() => projectDpps(ref?.['switch-controller/dynamic-port-policy']?.results ?? [], cs.ops), [ref, cs.ops]);
  const switches = ref?.['switch-controller/managed-switch']?.results ?? [];
  const nacStats = ref?._nacStats ?? null;

  const ports = useMemo(() => {
    let dynamic = 0;
    let total = 0;
    const usedPolicies = new Set<string>();
    for (const sw of switches) {
      for (const p of sw.ports ?? []) {
        total++;
        if (p['access-mode'] === 'dynamic' && p['port-policy']) {
          dynamic++;
          usedPolicies.add(p['port-policy']);
        }
      }
    }
    return { dynamic, total, usedPolicies };
  }, [switches]);

  const orphanPolicies = dpps.filter((d) => !ports.usedPolicies.has(d.name));
  const shadowedRules = useMemo(() => {
    const out: { dpp: string; rule: string }[] = [];
    for (const d of dpps) {
      const rules = d.policy ?? [];
      const idx = rules.findIndex(isCatchAll);
      if (idx === -1) continue;
      for (const r of rules.slice(idx + 1)) if (r.status !== 'disable') out.push({ dpp: d.name, rule: r.name });
    }
    return out;
  }, [dpps]);

  const dppLimit = schema?.tables?.['switch-controller/dynamic-port-policy']?.max_table_size_vdom ?? 256;
  const c = inv?.counts;

  if (isLoading) return <div className="page"><Loading label="Gathering the picture…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  const matchedPct = c && c.onSwitch ? Math.round((c.matched / c.onSwitch) * 100) : 0;
  const nacPct = nacStats?.max_limit ? Math.round((nacStats.vdom_count / nacStats.max_limit) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <div className="page-sub">
            NAC coverage across the FortiLink fabric. Data read at {absTime(inv?.fetchedAt)}.
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat
          icon={<Network size={11} />}
          label="Devices detected"
          value={c?.total ?? 0}
          note={
            <>
              {c?.online ?? 0} online · {c?.onSwitch ?? 0} on a switch port
            </>
          }
        />
        <Stat
          icon={<ShieldCheck size={11} />}
          label="Covered by a rule"
          value={c?.matched ?? 0}
          unit={c?.onSwitch ? `/ ${c.onSwitch}` : undefined}
          meter={{ pct: matchedPct, tone: matchedPct > 80 ? 'ok' : matchedPct > 40 ? 'warn' : 'crit' }}
          note={`${matchedPct}% of devices on switch ports`}
        />
        <Stat
          icon={<Plug size={11} />}
          label="Ports under NAC"
          value={ports.dynamic}
          unit={`/ ${ports.total}`}
          meter={{ pct: ports.total ? (ports.dynamic / ports.total) * 100 : 0 }}
          note={`across ${pluralize(switches.length, 'managed switch', 'managed switches')}`}
        />
        <Stat
          icon={<Cpu size={11} />}
          label="Matched device slots"
          value={nacStats?.vdom_count ?? '—'}
          unit={nacStats ? `/ ${nacStats.max_limit}` : undefined}
          meter={nacStats ? { pct: nacPct, tone: nacPct > 90 ? 'crit' : nacPct > 70 ? 'warn' : 'ok' } : undefined}
          note={nacStats ? 'hardware limit for this FortiGate' : 'not reported by this FortiOS'}
        />
      </div>

      {/* Handlungsbedarf */}
      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <CircleAlert size={14} className="dim" />
            <span className="panel-title">Needs attention</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {ports.dynamic === 0 && (
              <Note kind="warn">
                <strong>No port runs NAC.</strong> Dynamic port policies have no effect until ports are set to dynamic access
                mode. <Link to="/ports" style={{ textDecoration: 'underline' }}>Port Assignment</Link>
              </Note>
            )}

            {orphanPolicies.length > 0 && (
              <Note kind="warn">
                <strong>{pluralize(orphanPolicies.length, 'policy', 'policies')} not assigned to any port:</strong>{' '}
                {orphanPolicies.map((d) => d.name).join(', ')}. Their rules never run.
              </Note>
            )}

            {shadowedRules.length > 0 && (
              <Note kind="warn">
                <strong>{pluralize(shadowedRules.length, 'rule')} sit behind a catch-all</strong> and can never match:{' '}
                {shadowedRules.slice(0, 5).map((r) => `${r.dpp}/${r.rule}`).join(', ')}
                {shadowedRules.length > 5 ? ` and ${shadowedRules.length - 5} more` : ''}.
              </Note>
            )}

            {(c?.portStatic ?? 0) > 0 && (
              <Note kind="info">
                {pluralize(c!.portStatic, 'device')} sit{c!.portStatic === 1 ? 's' : ''} on statically configured ports. NAC
                cannot reach them there.
              </Note>
            )}

            {(c?.noRule ?? 0) > 0 && (
              <Note kind="info">
                {pluralize(c!.noRule, 'device')} on NAC-enabled ports match no rule.{' '}
                <Link to="/assets" style={{ textDecoration: 'underline' }}>Review them in Assets</Link>
              </Note>
            )}

            {(c?.unidentified ?? 0) > 0 && (
              <Note kind="info">
                {pluralize(c!.unidentified, 'device has', 'devices have')} no vendor, type or hostname. Matching by MAC address
                is the only reliable option for them.
              </Note>
            )}

            {ports.dynamic > 0 &&
              !orphanPolicies.length &&
              !shadowedRules.length &&
              !(c?.noRule ?? 0) &&
              !(c?.portStatic ?? 0) && <Note kind="ok">Nothing stands out. Every device on a NAC port matches a rule.</Note>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <ListTree size={14} className="dim" />
            <span className="panel-title">Policies</span>
            <div className="panel-actions">
              <Link className="btn sm" to="/policies">
                Open
              </Link>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Policy</th>
                <th className="num">Rules</th>
                <th className="num">Ports</th>
                <th>FortiLink</th>
              </tr>
            </thead>
            <tbody>
              {dpps.length === 0 && (
                <tr>
                  <td colSpan={4} className="dim xs" style={{ padding: 14 }}>
                    No dynamic port policies configured yet.
                  </td>
                </tr>
              )}
              {dpps.map((d) => {
                const usedOn = switches.reduce(
                  (n, sw) => n + (sw.ports ?? []).filter((p) => p['access-mode'] === 'dynamic' && p['port-policy'] === d.name).length,
                  0
                );
                return (
                  <tr key={d.name}>
                    <td>
                      <Link to={`/policies/${encodeURIComponent(d.name)}`} style={{ fontWeight: 500 }}>
                        {d.name}
                      </Link>
                      {d.description && <div className="xs dim truncate">{d.description}</div>}
                    </td>
                    <td className="num">{(d.policy ?? []).length}</td>
                    <td className="num">{usedOn === 0 ? <span style={{ color: 'var(--amber)' }}>0</span> : usedOn}</td>
                    <td className="mono xs dim">{d.fortilink ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="panel-body" style={{ paddingTop: 8 }}>
            <div className="xs dim row">
              <Activity size={11} />
              {dpps.length} of {dppLimit} policies used on this VDOM
              {schema?.source === 'local' && ' · limits read from the bundled schema'}
            </div>
          </div>
        </div>
      </div>

      {inv?.warnings?.length ? (
        <Note kind="warn">
          <strong>Some data sources failed:</strong> {inv.warnings.map((w) => `${w.source} (${w.message})`).join(' · ')}
        </Note>
      ) : null}
    </div>
  );
}
