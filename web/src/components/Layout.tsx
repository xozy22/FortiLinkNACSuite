import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Cable,
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
import { useChangeset } from '@/state/changeset';
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
          <span className="mono sm truncate" title={`${session.host} · VDOM ${session.vdom}`}>
            {session.host}
          </span>
          <span className="xs dim">vdom {session.vdom}</span>
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
