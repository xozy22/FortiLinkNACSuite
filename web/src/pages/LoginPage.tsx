// Zugangsschranke der App selbst – vorgelagert vor jeder FortiGate-Verbindung.
import { useState } from 'react';
import { KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { Note } from '@/components/common';

export function LoginPage({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onAuthed();
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Sign in failed');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-app)' }}>
      <form onSubmit={submit} style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ width: 36, height: 36, borderRadius: 9 }}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>FortiLink NAC Suite</div>
            <div className="sm muted">Sign in to continue</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div className="field">
              <label>
                <Lock size={11} /> App password
              </label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
              <div className="hint">Set on the server with FLNS_APP_PASSWORD. This is not your FortiGate token.</div>
            </div>

            {error && <Note kind="err">{error}</Note>}

            <button className="btn primary" type="submit" disabled={busy || !password}>
              {busy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} Sign in
            </button>
          </div>
        </div>

        <div className="xs dim" style={{ textAlign: 'center' }}>
          Unofficial community tool — not developed, endorsed or supported by Fortinet.
        </div>
      </form>
    </div>
  );
}
