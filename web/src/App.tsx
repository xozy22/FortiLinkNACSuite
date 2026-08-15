import { useQueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { useAuth, useSession } from './api/hooks';
import { Layout } from './components/Layout';
import { Loading } from './components/common';
import { ConnectPage } from './pages/ConnectPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AssetsPage } from './pages/AssetsPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { VlanPoliciesPage } from './pages/VlanPoliciesPage';
import { PortsPage } from './pages/PortsPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ActivityPage } from './pages/ActivityPage';
import { ChangesetProvider } from './state/changeset';

export default function App() {
  const qc = useQueryClient();
  const { data: auth, isLoading: authLoading } = useAuth();
  const needsLogin = auth?.required === true && auth.authed === false;
  // Erst nach bestandener Zugangsschranke die Verbindung abfragen.
  const { data: session, isLoading } = useSession(!authLoading && !needsLogin);

  if (authLoading || (isLoading && !needsLogin)) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Loading label="Starting…" />
      </div>
    );
  }

  if (needsLogin) {
    return <LoginPage onAuthed={() => qc.invalidateQueries()} />;
  }

  if (!session?.connected) return <ConnectPage />;

  // Der Changeset gehoert zu genau einer Verbindung und einem VDOM.
  const scope = `${session.host}|${session.vdom}`;

  return (
    <ChangesetProvider scope={scope}>
      <Layout session={session}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/policies/:dpp" element={<PoliciesPage />} />
          <Route path="/vlan-policies" element={<VlanPoliciesPage />} />
          <Route path="/ports" element={<PortsPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </Layout>
    </ChangesetProvider>
  );
}
