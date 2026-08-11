// Verbindungsprofile verwalten. Tokens bleiben serverseitig – die Liste zeigt
// nur, ob eines hinterlegt ist.
import { useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plug, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { useConnectionMutations, useConnections, useSession, useSessionMutations } from '@/api/hooks';
import { useToast } from '@/state/toast';
import { useChangeset } from '@/state/changeset';
import type { ConnectionProfile } from '@/api/types';
import { Empty, Loading, Modal, Note } from '@/components/common';

export function ConnectionsPage() {
  const { data: profiles, isLoading } = useConnections();
  const { data: session } = useSession();
  const { create, update, remove, test } = useConnectionMutations();
  const { connectProfile } = useSessionMutations();
  const cs = useChangeset();
  const toast = useToast();

  const [editing, setEditing] = useState<ConnectionProfile | 'new' | null>(null);
  const [confirm, setConfirm] = useState<ConnectionProfile | null>(null);

  if (isLoading) return <div className="page"><Loading /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Connections</h1>
          <div className="page-sub">
            One profile per FortiGate and VDOM. API tokens are stored on the server and never sent to the browser.
          </div>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={13} /> New profile
          </button>
        </div>
      </div>

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Host</th>
              <th>VDOM</th>
              <th>TLS</th>
              <th>Access</th>
              <th style={{ width: 190 }} />
            </tr>
          </thead>
          <tbody>
            {!profiles?.length && (
              <tr>
                <td colSpan={6}>
                  <Empty title="No saved profiles" hint="Save the FortiGates you work with to switch between them quickly." />
                </td>
              </tr>
            )}
            {profiles?.map((p) => {
              const active = session?.connectionId === p.id;
              return (
                <tr key={p.id}>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      {active && <span className="badge green">connected</span>}
                    </div>
                  </td>
                  <td className="mono xs">{p.host}</td>
                  <td className="mono xs">{p.vdom}</td>
                  <td className="xs">{p.verifyTls ? <span className="badge green">verified</span> : <span className="badge gray">not verified</span>}</td>
                  <td className="xs">
                    {p.readOnly ? <span className="badge amber">read-only</span> : <span className="badge green">read-write</span>}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <button
                        className="btn sm"
                        disabled={active || connectProfile.isPending}
                        onClick={async () => {
                          if (cs.count > 0 && !confirmDiscard(cs.count)) return;
                          try {
                            cs.clear();
                            await connectProfile.mutateAsync(p.id);
                            toast('ok', `Connected to ${p.name}`);
                          } catch (e) {
                            const err = e as { message?: string; hint?: string };
                            toast('err', 'Could not connect', err.hint ?? err.message);
                          }
                        }}
                      >
                        <Plug size={12} /> Connect
                      </button>
                      <button className="btn ghost icon sm" title="Edit" onClick={() => setEditing(p)}>
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

      <Note kind="info">
        Set <code>FLNS_SECRET</code> in the server environment to encrypt stored tokens at rest with AES-256-GCM. Without it
        they sit in <code>server/data/connections.json</code> in plain text.
      </Note>

      {editing && (
        <ProfileModal
          profile={editing === 'new' ? null : editing}
          busy={create.isPending || update.isPending}
          testing={test.isPending}
          onTest={async (body) => {
            const r = await test.mutateAsync(body);
            if (r.ok) toast('ok', 'Connection works', JSON.stringify(r.info));
            else toast('err', r.error ?? 'Connection failed', r.hint);
          }}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              if (editing === 'new') await create.mutateAsync(body);
              else await update.mutateAsync({ id: editing.id, body });
              setEditing(null);
              toast('ok', 'Profile saved');
            } catch (e) {
              toast('err', 'Could not save', (e as Error).message);
            }
          }}
        />
      )}

      {confirm && (
        <Modal
          title="Delete connection profile"
          onClose={() => setConfirm(null)}
          size="narrow"
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  await remove.mutateAsync(confirm.id);
                  setConfirm(null);
                  toast('ok', 'Profile deleted');
                }}
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          }
        >
          <p className="sm">
            Remove <strong>{confirm.name}</strong> ({confirm.host})? This only deletes the stored profile — nothing changes on
            the FortiGate.
          </p>
        </Modal>
      )}
    </div>
  );
}

function confirmDiscard(n: number) {
  return window.confirm(`You have ${n} pending change${n === 1 ? '' : 's'}. Switching connections discards them. Continue?`);
}

function ProfileModal({
  profile,
  busy,
  testing,
  onClose,
  onSave,
  onTest,
}: {
  profile: ConnectionProfile | null;
  busy: boolean;
  testing: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  onTest: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(profile?.name ?? '');
  const [host, setHost] = useState(profile?.host ?? '');
  const [apiKey, setApiKey] = useState('');
  const [vdom, setVdom] = useState(profile?.vdom ?? 'root');
  const [verifyTls, setVerifyTls] = useState(profile?.verifyTls ?? false);
  const [readOnly, setReadOnly] = useState(profile?.readOnly ?? true);

  const body = { name: name || host, host, apiKey: apiKey || undefined, vdom, verifyTls, readOnly };
  const ok = !!host && (!!apiKey || !!profile?.hasToken || host.toLowerCase() === 'demo');

  return (
    <Modal
      title={profile ? `Edit "${profile.name}"` : 'New connection profile'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onTest({ ...body, id: profile?.id })} disabled={testing || !host}>
            {testing ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} Test
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(body)} disabled={!ok || busy}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Display name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={host || 'Production'} />
        </div>
        <div className="field">
          <label>
            Host<span className="req">*</span>
          </label>
          <input className="input mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="fortigate.example.local" />
          <div className="hint">Hostname or IP. Use "demo" for the built-in mock.</div>
        </div>
        <div className="field">
          <label>
            API token{!profile?.hasToken && <span className="req">*</span>}
          </label>
          <input
            className="input mono"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={profile?.hasToken ? '•••••••• (unchanged)' : 'REST API admin token'}
          />
          <div className="hint">Needs the "wifi" access group. Read-write only if you intend to apply changes.</div>
        </div>
        <div className="field">
          <label>VDOM</label>
          <input className="input mono" value={vdom} onChange={(e) => setVdom(e.target.value)} placeholder="root" />
        </div>
      </div>

      <div className="fieldset">
        <legend>Safety</legend>
        <label className="check">
          <input type="checkbox" checked={verifyTls} onChange={(e) => setVerifyTls(e.target.checked)} />
          Verify the TLS certificate
        </label>
        <div className="hint" style={{ marginTop: -4 }}>
          FortiGates usually present a self-signed certificate. Leave this off unless you installed a trusted one.
        </div>
        <label className="check">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          <ShieldAlert size={13} style={{ color: readOnly ? 'var(--amber)' : 'var(--text-dim)' }} />
          Read-only — refuse every write
        </label>
        {!readOnly && (
          <Note kind="warn">
            <XCircle size={12} style={{ verticalAlign: -2 }} /> This profile can change the live configuration. Changes still
            go through the review step, but they will be applied when you confirm.
          </Note>
        )}
      </div>
    </Modal>
  );
}
