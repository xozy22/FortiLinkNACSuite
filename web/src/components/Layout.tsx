import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cable,
  ChevronDown,
  History,
  LayoutDashboard,
  ListTree,
  LogOut,
  Moon,
  Network,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sun,
  Zap,
} from 'lucide-react';
import type { Session } from '@/api/types';
import { api } from '@/api/client';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import { useRefData, useRefreshAll, useSessionMutations } from '@/api/hooks';
import { ChangeDrawer } from './ChangeDrawer';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/assets', label: 'Assets', icon: Network, end: false },
  { to: '/policies', label: 'Port Policies', icon: ListTree, end: false },
  { to: '/vlan-policies', label: 'VLAN Policies', icon: Cable, end: false },
  { to: '/ports', label: 'Port Assignment', icon: Plug, end: false },
];

export function Layout({ session, children }: { session: Session; children: ReactNode }) {
  const cs = useChangeset();
  const nav = useNavigate();
  const refresh = useRefreshAll();
  const { disconnect } = useSessionMutations();
  const { data: ref, isFetching } = useRefData();
  const [drawer, setDrawer] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');

  const dppCount = ref?.['switch-controller/dynamic-port-policy']?.results?.length ?? 0;
  const vpCount = ref?.['switch-controller/vlan-policy']?.results?.length ?? 0;

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('flns-theme', next);
    setTheme(next);
  }

  const open = drawer || cs.count > 0;

  return (
    <div className={`shell ${open ? 'drawer-open' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <ShieldCheck size={14} />
        </div>
        <div className="brand-name">
          FortiLink <span>NAC Suite</span>
        </div>
      </div>

      <header className="topbar">
        <div className="row" style={{ minWidth: 0 }}>
          <span className={`badge ${session.demo ? 'violet' : session.readOnly ? 'amber' : 'green'}`}>
            {session.demo ? 'Demo' : session.readOnly ? 'Read-only' : 'Read-write'}
          </span>
          <span className="mono sm truncate" title={session.host}>
            {session.host}
          </span>
          <VdomSwitcher session={session} />
          {session.info?.version && <span className="xs dim">· FortiOS {session.info.version}</span>}
        </div>

        <div className="topbar-spacer" />

        <button className="btn ghost icon" onClick={refresh} title="Reload data from the FortiGate">
          <RefreshCw size={15} className={isFetching ? 'spin' : ''} />
        </button>
        <button className="btn ghost icon" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className={`btn ${cs.count ? 'primary' : ''}`}
          onClick={() => setDrawer((d) => !d)}
          title="Pending changes"
        >
          <Zap size={14} />
          {cs.count > 0 ? `${cs.count} pending` : 'Changes'}
        </button>
        <div className="sep" />
        <button
          className="btn ghost icon"
          title="Disconnect"
          onClick={async () => {
            await disconnect.mutateAsync();
            nav('/');
          }}
        >
          <LogOut size={15} />
        </button>
      </header>

      <nav className="nav">
        <div className="nav-group">Manage</div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <n.icon size={15} />
            <span>{n.label}</span>
            {n.to === '/policies' && dppCount > 0 && <span className="nav-count">{dppCount}</span>}
            {n.to === '/vlan-policies' && vpCount > 0 && <span className="nav-count">{vpCount}</span>}
          </NavLink>
        ))}

        <div className="nav-group">Setup</div>
        <NavLink to="/connections" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Plug size={15} />
          <span>Connections</span>
        </NavLink>
        <NavLink to="/activity" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <History size={15} />
          <span>Activity</span>
        </NavLink>

        <div className="spacer" />
        <div className="xs dim" style={{ padding: '10px 9px', lineHeight: 1.5 }}>
          Unofficial community tool.
          <br />
          Not supported by Fortinet.
        </div>
      </nav>

      <main className="main">{children}</main>

      {open && <ChangeDrawer onClose={() => setDrawer(false)} readOnly={!!session.readOnly} />}
    </div>
  );
}

/**
 * VDOM-Umschalter. Der VDOM haengt an der Sitzung, nicht am gespeicherten
 * Profil – ein Wechsel schreibt das Profil also nicht um. Anstehende
 * Aenderungen gehoeren zum alten VDOM und werden nicht mitgenommen.
 */
function VdomSwitcher({ session }: { session: Session }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cs = useChangeset();
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState('');

  const { data } = useQuery({ queryKey: ['vdoms'], queryFn: api.vdoms, enabled: open, staleTime: 5 * 60_000 });
  const switching = useMutation({
    mutationFn: api.switchVdom,
    onSuccess: () => {
      qc.invalidateQueries();
      setOpen(false);
    },
  });

  async function go(vdom: string) {
    if (!vdom || vdom === session.vdom) return setOpen(false);
    if (cs.count > 0 && !window.confirm(`${cs.count} pending change(s) belong to VDOM "${session.vdom}" and stay there. Switch anyway?`)) {
      return;
    }
    try {
      await switching.mutateAsync(vdom);
      toast('ok', `Switched to VDOM ${vdom}`);
    } catch (e) {
      const err = e as { message?: string; hint?: string };
      toast('err', 'Could not switch VDOM', err.hint ?? err.message);
    }
  }

  const list = data?.vdoms ?? [];

  return (
    <div className="facet">
      <button className="facet-btn" onClick={() => setOpen((o) => !o)} title="Switch VDOM">
        vdom <b style={{ fontWeight: 600 }}>{session.vdom}</b>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="facet-pop" style={{ minWidth: 210 }}>
          {list.map((v) => (
            <div key={v} className="facet-opt" onClick={() => go(v)}>
              <span className="mono xs">{v}</span>
              {v === session.vdom && <span className="badge green">current</span>}
            </div>
          ))}
          {list.length === 0 && (
            <div className="xs dim" style={{ padding: '4px 7px 7px' }}>
              Could not list VDOMs — the token needs global read access. Type the name instead.
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 4, paddingTop: 6, display: 'flex', gap: 5 }}>
            <input
              className="input mono"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go(manual.trim())}
              placeholder="vdom name"
              style={{ flex: 1 }}
            />
            <button className="btn sm" disabled={!manual.trim() || switching.isPending} onClick={() => go(manual.trim())}>
              Go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
