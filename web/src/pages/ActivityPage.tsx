// ---------------------------------------------------------------------------
// Aktivitaetsprotokoll.
//
// Der Apply-Bericht im Drawer ist nach einem Reload weg. Bei einem Werkzeug,
// das Netzwerkkonfiguration aendert, ist "wer hat wann was angewendet" aber
// genau das, wonach im Zweifel gesucht wird.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, History, LogIn, Plug, RefreshCw, ShieldAlert, Terminal, Zap } from 'lucide-react';
import { api } from '@/api/client';
import type { AuditEntry } from '@/api/types';
import { Empty, ErrorBox, Loading, Note } from '@/components/common';
import { copyToClipboard, pluralize } from '@/lib/format';
import { useToast } from '@/state/toast';

const EVENT_META: Record<string, { label: string; icon: typeof Zap; tone: string }> = {
  'changeset.apply': { label: 'Applied changes', icon: Zap, tone: 'accent' },
  'changeset.apply.error': { label: 'Apply failed', icon: AlertTriangle, tone: 'red' },
  'changeset.revert': { label: 'Reverted changes', icon: History, tone: 'amber' },
  'changeset.revert.error': { label: 'Revert failed', icon: AlertTriangle, tone: 'red' },
  'port.bounce': { label: 'Bounced a port', icon: RefreshCw, tone: 'blue' },
  'fortigate.connect': { label: 'Connected', icon: Plug, tone: 'gray' },
  'auth.ok': { label: 'Signed in', icon: LogIn, tone: 'gray' },
  'auth.failed': { label: 'Failed sign-in', icon: ShieldAlert, tone: 'red' },
};

export function ActivityPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'changes' | 'security'>('all');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api.audit(500),
    staleTime: 10_000,
  });

  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    if (filter === 'changes') return all.filter((e) => e.event.startsWith('changeset'));
    if (filter === 'security') return all.filter((e) => e.event.startsWith('auth') || e.event === 'fortigate.connect');
    return all;
  }, [data, filter]);

  if (isLoading) return <div className="page"><Loading label="Reading the activity log…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Activity</h1>
          <div className="page-sub">
            Every write this tool performed, with the operations and the equivalent CLI. Written server-side, so it
            survives a reload — and a restart.
          </div>
        </div>
        <div className="page-actions">
          <div className="btn-group">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              All
            </button>
            <button className={filter === 'changes' ? 'active' : ''} onClick={() => setFilter('changes')}>
              Changes
            </button>
            <button className={filter === 'security' ? 'active' : ''} onClick={() => setFilter('security')}>
              Access
            </button>
          </div>
          <button className="btn" onClick={() => refetch()}>
            <RefreshCw size={13} className={isFetching ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="panel">
          <Empty title="Nothing recorded yet" hint="Applying a changeset, reverting one or bouncing a port shows up here." />
        </div>
      ) : (
        <div className="panel">
          {entries.map((e, i) => (
            <Entry
              key={`${e.at}-${i}`}
              entry={e}
              expanded={open.has(i)}
              onToggle={() =>
                setOpen((prev) => {
                  const n = new Set(prev);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
              onCopyCli={(cli) => copyToClipboard(cli).then(() => toast('ok', 'CLI copied to clipboard'))}
            />
          ))}
        </div>
      )}

      {data?.file && (
        <div className="xs dim">
          Written to <code>{data.file}</code>, one JSON object per line. Rotates at 5 MB.
        </div>
      )}
    </div>
  );
}

function Entry({
  entry,
  expanded,
  onToggle,
  onCopyCli,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
  onCopyCli: (cli: string) => void;
}) {
  const meta = EVENT_META[entry.event] ?? { label: entry.event, icon: History, tone: 'gray' };
  const Icon = meta.icon;
  const ops = entry.operations ?? [];
  const hasDetail = ops.length > 0 || !!entry.cli || !!entry.error;

  const when = new Date(entry.at);
  const failed = (entry.counts?.failed ?? 0) + (entry.counts?.conflict ?? 0);

  return (
    <div className="op" style={{ padding: '10px 13px' }}>
      <div className="op-head" style={{ cursor: hasDetail ? 'pointer' : 'default' }} onClick={hasDetail ? onToggle : undefined}>
        {hasDetail ? (
          expanded ? <ChevronDown size={13} className="dim" /> : <ChevronRight size={13} className="dim" />
        ) : (
          <span style={{ width: 13 }} />
        )}
        <Icon size={13} />
        <span className={`badge ${meta.tone}`}>{meta.label}</span>

        {entry.counts && (
          <span className="xs dim">
            {entry.counts.applied} applied
            {failed > 0 && <span style={{ color: 'var(--red)' }}> · {failed} not applied</span>}
          </span>
        )}
        {entry.profile && <span className="xs dim">· {entry.profile}</span>}
        {entry.host && <span className="xs dim mono">· {entry.host}{entry.vdom ? `/${entry.vdom}` : ''}</span>}
        {entry.demo && <span className="badge violet">demo</span>}

        <div className="spacer" />
        <span className="xs dim mono" title={when.toISOString()}>
          {when.toLocaleString()}
        </span>
      </div>

      {entry.error && <Note kind="err">{entry.error}</Note>}

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {ops.length > 0 && (
            <div className="panel">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 78 }}>Kind</th>
                    <th>Target</th>
                    <th style={{ width: 90 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op, k) => (
                    <tr key={k}>
                      <td>
                        <span className={`op-kind ${op.kind}`}>{op.kind.toUpperCase()}</span>
                      </td>
                      <td className="xs mono">
                        {op.mkey}
                        {op.child ? ` / ${op.child}` : ''}
                        <div className="xs dim">{op.table}</div>
                        {op.message && <div className="xs" style={{ color: 'var(--amber)' }}>{op.message}</div>}
                      </td>
                      <td>
                        <span className={`badge ${op.status === 'applied' ? 'green' : op.status === 'conflict' ? 'amber' : op.status === 'failed' ? 'red' : 'gray'}`}>
                          {op.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {entry.cli && (
            <div>
              <div className="row" style={{ marginBottom: 4 }}>
                <Terminal size={12} className="dim" />
                <span className="xs dim">Equivalent configuration</span>
                <div className="spacer" />
                <button className="btn sm" onClick={() => onCopyCli(entry.cli!)}>
                  Copy
                </button>
              </div>
              <pre className="cli">{entry.cli}</pre>
            </div>
          )}

          {entry.from && <div className="xs dim">Requested from {entry.from}</div>}
        </div>
      )}
    </div>
  );
}

export function activitySummary(entries: AuditEntry[]) {
  const applies = entries.filter((e) => e.event === 'changeset.apply');
  return pluralize(applies.length, 'apply', 'applies');
}
