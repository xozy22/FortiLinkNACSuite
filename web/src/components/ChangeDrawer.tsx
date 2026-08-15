// ---------------------------------------------------------------------------
// Der Review-Schritt vor jedem Schreibvorgang.
//
// Drei Sichten auf denselben Changeset: die Aenderungen selbst als Diff, der
// aequivalente FortiOS-CLI-Block, und die Auswirkung auf den realen
// Geraetebestand. Erst danach gibt es einen Apply-Knopf.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCopy,
  Loader2,
  Play,
  RotateCcw,
  Terminal,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import { useApply, useInventory, useRefData, useRevert, useValidate } from '@/api/hooks';
import type { ApplyResult, Op, ValidateResult } from '@/api/types';
import { DiffView } from './DiffView';
import { Empty, Note } from './common';
import { projectDpps, projectSwitches } from '@/lib/project';
import { computeImpact } from '@/lib/match';
import { copyToClipboard, pluralize } from '@/lib/format';

type Tab = 'changes' | 'cli' | 'impact';

export function ChangeDrawer({ onClose, readOnly }: { onClose: () => void; readOnly: boolean }) {
  const cs = useChangeset();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('changes');
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const validate = useValidate();
  const apply = useApply();
  const revert = useRevert();

  const { data: inventory } = useInventory();
  const { data: ref } = useRefData();

  // Bei jeder Aenderung neu validieren – die Pruefung braucht den Serverbestand.
  useEffect(() => {
    setResult(null);
    if (!cs.ops.length) {
      setValidation(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      validate
        .mutateAsync(cs.ops)
        .then((v) => !cancelled && setValidation(v))
        .catch(() => !cancelled && setValidation(null));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs.ops]);

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const blocked = readOnly || errors.length > 0;

  const impact = useMemo(() => {
    if (!inventory || !ref) return null;
    const dpps = ref['switch-controller/dynamic-port-policy'].results;
    const switches = ref['switch-controller/managed-switch'].results;
    return computeImpact(
      inventory.assets,
      { dpps, switches },
      { dpps: projectDpps(dpps, cs.ops), switches: projectSwitches(switches, cs.ops) }
    );
  }, [inventory, ref, cs.ops]);

  async function onApply() {
    try {
      const r = await apply.mutateAsync({ ops: cs.ops });
      setResult(r);
      cs.setLastApplied(r.revertable);
      if (r.failedCount === 0 && r.conflictCount === 0) {
        toast('ok', `Applied ${pluralize(r.appliedCount, 'change')}`);
        cs.clear();
      } else {
        toast(
          'warn',
          `Applied ${r.appliedCount} of ${cs.ops.length}`,
          `${r.failedCount} failed, ${r.conflictCount} conflicted, ${r.skippedCount} skipped.`
        );
      }
    } catch (e) {
      const err = e as { message?: string; hint?: string };
      toast('err', 'Apply failed', err.hint ?? err.message);
    }
  }

  async function onRevert() {
    if (!cs.lastApplied?.length) return;
    try {
      const r = await revert.mutateAsync(cs.lastApplied);
      toast(r.failedCount ? 'warn' : 'ok', `Reverted ${pluralize(r.appliedCount, 'operation')}`,
        r.failedCount ? `${r.failedCount} could not be rolled back.` : undefined);
      cs.setLastApplied(null);
      setResult(null);
    } catch (e) {
      toast('err', 'Revert failed', (e as Error).message);
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <Zap size={15} style={{ color: 'var(--accent-bright)' }} />
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>Pending changes</div>
        {cs.count > 0 && <span className="badge accent mono">{cs.count}</span>}
        <div className="spacer" />
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close panel">
          <X size={15} />
        </button>
      </div>

      {cs.count > 0 && (
        <div className="btn-group" style={{ margin: '10px 12px 0', width: 'calc(100% - 24px)' }}>
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')} style={{ flex: 1 }}>
            Changes
          </button>
          <button className={tab === 'cli' ? 'active' : ''} onClick={() => setTab('cli')} style={{ flex: 1 }}>
            CLI
          </button>
          <button className={tab === 'impact' ? 'active' : ''} onClick={() => setTab('impact')} style={{ flex: 1 }}>
            Impact
          </button>
        </div>
      )}

      <div className="drawer-body">
        {cs.count === 0 && !result && (
          <div style={{ padding: 16 }}>
            <Empty
              title="Nothing staged"
              hint="Edits you make anywhere in the app collect here. Nothing reaches the FortiGate until you review and apply."
            />
            {cs.lastApplied?.length ? (
              <button className="btn" style={{ width: '100%' }} onClick={onRevert} disabled={revert.isPending || readOnly}>
                <Undo2 size={13} /> Revert the last apply ({cs.lastApplied.length})
              </button>
            ) : null}
          </div>
        )}

        {result && <ApplyReport result={result} onDismiss={() => setResult(null)} />}

        {cs.count > 0 && !result && (
          <>
            <div style={{ padding: '10px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cs.restored && (
                <Note kind="info">
                  Restored from your last session — these changes were never applied.
                  <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={cs.dismissRestored}>
                    Got it
                  </button>
                </Note>
              )}
              {readOnly && (
                <Note kind="warn">
                  This connection is <strong>read-only</strong>. Turn off read-only on the connection profile and reconnect to
                  apply changes.
                </Note>
              )}
              {validate.isPending && (
                <div className="xs dim row">
                  <Loader2 size={12} className="spin" /> Validating against the FortiGate…
                </div>
              )}
              {errors.map((e, i) => (
                <Note kind="err" key={`e${i}`}>
                  {e.label && <strong>{e.label}: </strong>}
                  {e.field && <code className="xs">{e.field} — </code>}
                  {e.message}
                </Note>
              ))}
              {warnings.map((w, i) => (
                <Note kind="warn" key={`w${i}`}>
                  {w.label && <strong>{w.label}: </strong>}
                  {w.message}
                </Note>
              ))}
            </div>

            {tab === 'changes' && <OpList ops={cs.ops} order={validation?.ordered} onRemove={cs.remove} />}
            {tab === 'cli' && <CliPanel cli={validation?.cli ?? ''} />}
            {tab === 'impact' && <ImpactPanel impact={impact} />}
          </>
        )}
      </div>

      {cs.count > 0 && !result && (
        <div className="drawer-foot">
          <button className="btn danger" onClick={cs.clear}>
            <Trash2 size={13} /> Discard
          </button>
          <div className="spacer" />
          <button className="btn primary" onClick={onApply} disabled={blocked || apply.isPending}>
            {apply.isPending ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            Apply {cs.count}
          </button>
        </div>
      )}
    </aside>
  );
}

// --- Operationsliste -------------------------------------------------------

function OpList({ ops, order, onRemove }: { ops: Op[]; order?: string[]; onRemove: (id: string) => void }) {
  // In der Reihenfolge zeigen, in der das Backend sie ausfuehren wird.
  const sorted = useMemo(() => {
    if (!order?.length) return ops;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...ops].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }, [ops, order]);

  return (
    <div style={{ marginTop: 10 }}>
      {sorted.map((op, i) => (
        <div className="op" key={op.id}>
          <div className="op-head">
            <span className="dim mono xs" style={{ width: 16 }}>
              {i + 1}
            </span>
            <span className={`op-kind ${op.kind}`}>{op.kind.toUpperCase()}</span>
            <span className="op-target" title={`${op.table}${op.child ? ` / ${op.child.table}` : ''}`}>
              {op.child ? (
                <>
                  {op.mkey} / <b>{op.child.mkey}</b>
                </>
              ) : (
                <b>{op.mkey}</b>
              )}
            </span>
            <div className="spacer" />
            <button className="btn ghost icon sm" onClick={() => onRemove(op.id)} title="Remove from changeset">
              <X size={12} />
            </button>
          </div>
          <div className="xs dim">{shortTable(op.table)}</div>
          <DiffView op={op} />
        </div>
      ))}
    </div>
  );
}

function shortTable(t: string) {
  return t.replace('switch-controller/', '').replace('switch-controller.', '');
}

// --- CLI -------------------------------------------------------------------

function CliPanel({ cli }: { cli: string }) {
  const toast = useToast();
  if (!cli.trim()) return <div style={{ padding: 16 }}><Empty title="No CLI to show yet" /></div>;
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row">
        <Terminal size={13} className="dim" />
        <span className="xs dim">Equivalent FortiOS configuration</span>
        <div className="spacer" />
        <button
          className="btn sm"
          onClick={() => copyToClipboard(cli).then(() => toast('ok', 'CLI copied to clipboard'))}
        >
          <ClipboardCopy size={12} /> Copy
        </button>
      </div>
      <pre className="cli">{cli}</pre>
      <div className="xs dim">
        This is what the REST calls are equivalent to. Applying uses the API, not the CLI — the block is here for review and
        change records.
      </div>
    </div>
  );
}

// --- Impact ----------------------------------------------------------------

function ImpactPanel({ impact }: { impact: ReturnType<typeof computeImpact> | null }) {
  if (!impact) return <div style={{ padding: 16 }}><Empty title="Inventory not loaded" hint="The impact preview needs the asset inventory." /></div>;

  const { rows, gained, lost, changed, unaffected, deadRules } = impact;

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row wrap">
        <span className="badge green">{gained} gain a rule</span>
        <span className="badge amber">{changed} change rule</span>
        <span className="badge red">{lost} lose their rule</span>
        <span className="badge gray">{unaffected} unaffected</span>
      </div>

      <Note kind="info">
        Simulated from the current inventory. FortiOS re-evaluates a device when it reconnects or the port bounces, so the
        real switchover can lag behind.
      </Note>

      {rows.length === 0 && <Empty title="No device changes its rule" hint="The staged changes do not alter which rule applies to any known device." />}

      {rows.length > 0 && (
        <div className="panel">
          <table className="tbl">
            <thead>
              <tr>
                <th>Device</th>
                <th>From</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map((r) => (
                <tr key={r.asset.mac}>
                  <td style={{ maxWidth: 130 }}>
                    <div className="truncate">{r.asset.hostname || <span className="mono xs">{r.asset.macDisplay}</span>}</div>
                    <div className="xs dim truncate">{r.asset.vendor || r.asset.type || '—'}</div>
                  </td>
                  <td className="xs" style={{ color: 'var(--diff-del)' }}>{r.from}</td>
                  <td className="xs">
                    <ArrowRight size={10} className="dim" /> <span style={{ color: 'var(--diff-add)' }}>{r.to}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 80 && <div className="xs dim" style={{ padding: 8 }}>Showing the first 80 of {rows.length}.</div>}
        </div>
      )}

      {deadRules.length > 0 && (
        <Note kind="warn">
          <strong>{pluralize(deadRules.length, 'rule')} would match no known device:</strong>{' '}
          {deadRules.slice(0, 8).map((d) => `${d.dpp}/${d.rule}`).join(', ')}
          {deadRules.length > 8 ? ` and ${deadRules.length - 8} more` : ''}. That is expected for rules covering devices that
          are not currently connected.
        </Note>
      )}
    </div>
  );
}

// --- Ergebnisbericht -------------------------------------------------------

function ApplyReport({ result, onDismiss }: { result: ApplyResult; onDismiss: () => void }) {
  const ICON = {
    applied: <Check size={13} style={{ color: 'var(--green)' }} />,
    failed: <X size={13} style={{ color: 'var(--red)' }} />,
    conflict: <AlertTriangle size={13} style={{ color: 'var(--amber)' }} />,
    skipped: <RotateCcw size={13} style={{ color: 'var(--text-dim)' }} />,
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row wrap">
        <span className="badge green">{result.appliedCount} applied</span>
        {result.failedCount > 0 && <span className="badge red">{result.failedCount} failed</span>}
        {result.conflictCount > 0 && <span className="badge amber">{result.conflictCount} conflicts</span>}
        {result.skippedCount > 0 && <span className="badge gray">{result.skippedCount} skipped</span>}
        <div className="spacer" />
        <button className="btn sm ghost" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      {result.conflictCount > 0 && (
        <Note kind="warn">
          Conflicting objects changed on the FortiGate after they were loaded here. They were left untouched. Reload and
          redo those edits.
        </Note>
      )}

      <div className="panel">
        {result.results.map((r) => (
          <div className="op" key={r.id}>
            <div className="op-head">
              {ICON[r.status]}
              <span className="sm truncate">{r.label}</span>
            </div>
            {r.message && <div className="xs dim">{r.message}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
