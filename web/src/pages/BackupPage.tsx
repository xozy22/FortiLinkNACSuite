// ---------------------------------------------------------------------------
// Sicherung und Wiederherstellung.
//
// Der Revert im Drawer gilt nur solange die Seite offen ist. Hier liegen die
// Staende auf der Platte – automatisch vor jedem Apply, dazu von Hand.
//
// Wiederhergestellt wird nie durch direktes Zurueckschreiben, sondern ueber
// einen Changeset: derselbe Diff, dieselbe Pruefung, derselbe Review-Schritt.
// Ein Rollback ist damit genauso nachvollziehbar wie eine Aenderung von Hand.
// ---------------------------------------------------------------------------
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Camera, Download, FileUp, History, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '@/api/client';
import type { ConfigBundle, Op, SnapshotMeta } from '@/api/types';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import { useSession } from '@/api/hooks';
import { Empty, ErrorBox, Loading, Modal, Note } from '@/components/common';
import { pluralize } from '@/lib/format';

export function BackupPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const cs = useChangeset();
  const { data: session } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<{ title: string; hint: string; ops: Op[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['snapshots'], queryFn: api.snapshots, staleTime: 10_000 });
  const snapshots = data?.snapshots ?? [];

  const takeSnapshot = useMutation({
    mutationFn: (note: string) => api.createSnapshot(note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots'] });
      toast('ok', 'Snapshot taken');
    },
  });

  const removeSnapshot = useMutation({
    mutationFn: api.deleteSnapshot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshots'] }),
  });

  async function doExport() {
    try {
      const cfg = await api.exportConfig();
      const name = `nac-config_${String(cfg.host ?? 'fortigate').replace(/[^\w.-]/g, '-')}_${cfg.vdom ?? 'root'}_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast('ok', 'Configuration exported', name);
    } catch (e) {
      toast('err', 'Export failed', (e as Error).message);
    }
  }

  async function planRestore(snap: SnapshotMeta) {
    setBusy(true);
    try {
      const r = await api.planSnapshotRestore(snap.id, true);
      if (!r.ops.length) {
        toast('ok', 'Nothing to roll back', 'The configuration already matches this snapshot.');
        return;
      }
      setPlan({
        title: `Roll back to ${new Date(snap.at ?? '').toLocaleString()}`,
        hint: `${pluralize(r.ops.length, 'operation')} would bring the configuration back to this snapshot. Objects created since then are removed.`,
        ops: r.ops,
      });
    } catch (e) {
      toast('err', 'Could not build the rollback', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      const cfg: ConfigBundle = JSON.parse(await file.text());
      const r = await api.planImport(cfg, false);
      if (!r.ops.length) {
        toast('ok', 'Nothing to import', 'This FortiGate already matches the file.');
        return;
      }
      setPlan({
        title: `Import ${file.name}`,
        hint:
          `${pluralize(r.ops.length, 'operation')} from a config captured on ${r.source.host ?? 'an unknown host'}` +
          `${r.source.vdom ? ` / ${r.source.vdom}` : ''}. Objects that exist here but not in the file are left alone, and ports the file mentions but this FortiGate does not have are skipped.`,
        ops: r.ops,
      });
    } catch (e) {
      const err = e as { message?: string; detail?: { errors?: string[] } };
      toast('err', 'Could not read the file', err.detail?.errors?.join(' ') ?? err.message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function stage(ops: Op[]) {
    cs.addMany(ops.map(({ id: _id, ...rest }) => rest));
    setPlan(null);
    toast('ok', `Staged ${pluralize(ops.length, 'operation')}`, 'Review them in the changes panel before applying.');
  }

  if (isLoading) return <div className="page"><Loading label="Reading snapshots…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Backup &amp; Restore</h1>
          <div className="page-sub">
            A snapshot is taken automatically before every apply. Rolling one back does not overwrite anything directly —
            it produces a changeset you review like any other.
          </div>
        </div>
        <div className="page-actions">
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            <FileUp size={13} /> Import file
          </button>
          <button className="btn" onClick={doExport}>
            <Download size={13} /> Export
          </button>
          <button className="btn primary" onClick={() => takeSnapshot.mutate('')} disabled={takeSnapshot.isPending}>
            <Camera size={13} /> Take snapshot
          </button>
        </div>
      </div>

      {session?.demo && (
        <Note kind="info">
          The demo FortiGate lives in memory — its snapshots are real files, but the configuration they describe resets
          when the server restarts.
        </Note>
      )}

      <div className="panel">
        <div className="panel-head">
          <History size={14} className="dim" />
          <span className="panel-title">Snapshots</span>
          <span className="panel-sub">
            {session?.host} / {session?.vdom}
          </span>
          <div className="panel-actions">
            <span className="xs dim">{snapshots.length} kept</span>
          </div>
        </div>

        {snapshots.length === 0 ? (
          <Empty
            title="No snapshots yet"
            hint="One is written before every apply. You can also take one now to have a known-good point to come back to."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Taken</th>
                <th>Reason</th>
                <th>Contents</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="sm" style={{ fontWeight: 500 }}>
                      {s.at ? new Date(s.at).toLocaleString() : '—'}
                    </div>
                    {s.note && <div className="xs dim">{s.note}</div>}
                  </td>
                  <td>
                    <span className={`badge ${s.reason === 'before-apply' ? 'blue' : 'gray'}`}>
                      {s.reason === 'before-apply' ? 'before apply' : s.reason}
                    </span>
                  </td>
                  <td className="xs dim">
                    {s.summary.policies} policies · {s.summary.rules} rules · {s.summary.vlanPolicies} VLAN policies ·{' '}
                    {s.summary.ports} NAC ports
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <button className="btn sm" onClick={() => planRestore(s)} disabled={busy}>
                        <RotateCcw size={12} /> Roll back
                      </button>
                      <button
                        className="btn ghost icon sm"
                        title="Delete this snapshot"
                        onClick={() => removeSnapshot.mutate(s.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head">
            <Archive size={14} className="dim" />
            <span className="panel-title">What a backup contains</span>
          </div>
          <div className="panel-body xs muted" style={{ lineHeight: 1.6 }}>
            Dynamic port policies including their rules and order, VLAN policies, interface tags, and which policy each
            switch port runs. Deliberately not the device state — PoE, link, learned MACs — that is not configuration and
            would only add noise to a diff.
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <Upload size={14} className="dim" />
            <span className="panel-title">Moving config between FortiGates</span>
          </div>
          <div className="panel-body xs muted" style={{ lineHeight: 1.6 }}>
            Export on one, import on the other. The import compares the file against the target and stages only the
            differences. Ports the file mentions but the target does not have are skipped rather than invented, so a lab
            export cannot create phantom hardware in production.
          </div>
        </div>
      </div>

      {plan && (
        <Modal
          title={plan.title}
          onClose={() => setPlan(null)}
          size="wide"
          footer={
            <>
              <button className="btn" onClick={() => setPlan(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => stage(plan.ops)}>
                Stage {pluralize(plan.ops.length, 'operation')}
              </button>
            </>
          }
        >
          <Note kind="info">{plan.hint}</Note>
          <div className="panel">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 78 }}>Kind</th>
                  <th>Target</th>
                  <th>Object</th>
                </tr>
              </thead>
              <tbody>
                {plan.ops.slice(0, 200).map((op) => (
                  <tr key={op.id}>
                    <td>
                      <span className={`op-kind ${op.kind}`}>{op.kind.toUpperCase()}</span>
                    </td>
                    <td className="xs mono">
                      {op.mkey}
                      {op.child ? ` / ${op.child.mkey}` : ''}
                    </td>
                    <td className="xs dim">{op.table.replace('switch-controller/', '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.ops.length > 200 && (
              <div className="xs dim" style={{ padding: 8 }}>Showing the first 200 of {plan.ops.length}.</div>
            )}
          </div>
          <Note kind="warn">
            Nothing is written yet. These operations go into the changes panel, where the diff, the equivalent CLI and the
            impact preview apply as usual.
          </Note>
        </Modal>
      )}
    </div>
  );
}
