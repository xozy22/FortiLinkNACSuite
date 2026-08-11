// Verbindungs-Gate. Ohne Session zeigt die App nur diese Seite.
import { useState } from 'react';
import { KeyRound, Loader2, PlayCircle, Server, ShieldCheck, ShieldOff } from 'lucide-react';
import { useConnections, useSessionMutations } from '@/api/hooks';
import { useToast } from '@/state/toast';
import { Note } from '@/components/common';

export function ConnectPage() {
  const toast = useToast();
  const { data: profiles } = useConnections();
  const { connect, connectProfile } = useSessionMutations();

  const [host, setHost] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [vdom, setVdom] = useState('root');
  const [verifyTls, setVerifyTls] = useState(false);
  const [readOnly, setReadOnly] = useState(true);

  async function go(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      const err = e as { message?: string; hint?: string };
      toast('err', err.message ?? 'Could not connect', err.hint);
    }
  }

  const busy = connect.isPending || connectProfile.isPending;

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-app)' }}>
      <div style={{ width: 'min(880px, 100%)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ width: 36, height: 36, borderRadius: 9 }}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, letterSpacing: '-0.3px' }}>FortiLink NAC Suite</div>
            <div className="sm muted">Dynamic port policies for FortiLink-managed FortiSwitches</div>
          </div>
        </div>

        <div className="grid grid-2">
          {/* Gespeicherte Profile */}
          <div className="panel">
            <div className="panel-head">
              <Server size={14} className="dim" />
              <span className="panel-title">Saved connections</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {!profiles?.length && (
                <div className="xs dim">No saved profiles yet. Connect below — you can store the connection afterwards.</div>
              )}
              {profiles?.map((p) => (
                <button
                  key={p.id}
                  className="btn"
                  style={{ justifyContent: 'flex-start', padding: '9px 11px', height: 'auto' }}
                  disabled={busy}
                  onClick={() => go(() => connectProfile.mutateAsync(p.id))}
                >
                  <div style={{ textAlign: 'left', minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span className={`badge ${p.readOnly ? 'amber' : 'green'}`}>{p.readOnly ? 'read-only' : 'read-write'}</span>
                    </div>
                    <div className="xs dim mono truncate">
                      {p.host} · vdom {p.vdom} · {p.verifyTls ? 'TLS verified' : 'TLS not verified'}
                    </div>
                  </div>
                </button>
              ))}

              <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 9, marginTop: 2 }}>
                <button
                  className="btn"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={() => go(() => connect.mutateAsync({ host: 'demo', readOnly: false }))}
                >
                  <PlayCircle size={14} /> Explore with a demo FortiGate
                </button>
                <div className="xs dim" style={{ marginTop: 6 }}>
                  A built-in mock with switches, devices and policies. Changes apply against the mock, nothing leaves your
                  machine.
                </div>
              </div>
            </div>
          </div>

          {/* Direktverbindung */}
          <div className="panel">
            <div className="panel-head">
              <KeyRound size={14} className="dim" />
              <span className="panel-title">Connect</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="field">
                <label>
                  FortiGate host<span className="req">*</span>
                </label>
                <input
                  className="input mono"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="fortigate.example.local"
                  autoFocus
                />
              </div>

              <div className="field">
                <label>
                  REST API token<span className="req">*</span>
                </label>
                <input
                  className="input mono"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API key of a REST API admin"
                />
                <div className="hint">The admin profile needs the "wifi" access group. It stays on the server.</div>
              </div>

              <div className="form-grid tight">
                <div className="field">
                  <label>VDOM</label>
                  <input className="input mono" value={vdom} onChange={(e) => setVdom(e.target.value)} placeholder="root" />
                </div>
                <div className="field">
                  <label>TLS</label>
                  <label className="check" style={{ marginTop: 5 }}>
                    <input type="checkbox" checked={verifyTls} onChange={(e) => setVerifyTls(e.target.checked)} />
                    Verify certificate
                  </label>
                </div>
              </div>

              <label className="check">
                <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
                {readOnly ? <ShieldCheck size={13} style={{ color: 'var(--amber)' }} /> : <ShieldOff size={13} style={{ color: 'var(--green)' }} />}
                Read-only — block every write
              </label>

              {readOnly && (
                <Note kind="info">
                  Recommended for the first look at a production FortiGate. You can still build a full changeset and review the
                  CLI; only applying is blocked.
                </Note>
              )}

              <button
                className="btn primary"
                disabled={busy || !host || !apiKey}
                onClick={() => go(() => connect.mutateAsync({ host, apiKey, vdom, verifyTls, readOnly }))}
              >
                {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Connect
              </button>
            </div>
          </div>
        </div>

        <div className="xs dim" style={{ textAlign: 'center' }}>
          Unofficial community tool — not developed, endorsed or supported by Fortinet.
        </div>
      </div>
    </div>
  );
}
