import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

type Kind = 'ok' | 'err' | 'warn' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}

const Ctx = createContext<{ push: (kind: Kind, title: string, body?: string) => void } | null>(null);

const ICONS = { ok: CheckCircle2, err: XCircle, warn: AlertTriangle, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems((p) => [...p, { id, kind, title, body }]);
    // Fehler bleiben stehen, bis sie weggeklickt werden.
    if (kind !== 'err') setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`} role="status">
              <Icon size={15} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{t.title}</div>
                {t.body && <div className="xs muted" style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{t.body}</div>}
              </div>
              <button className="btn ghost icon sm" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v.push;
}
