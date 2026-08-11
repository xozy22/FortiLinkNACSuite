import { Route, Routes } from 'react-router-dom';
import { useSession } from './api/hooks';
import { Layout } from './components/Layout';
import { Loading } from './components/common';
import { ConnectPage } from './pages/ConnectPage';
import { DashboardPage } from './pages/DashboardPage';
import { AssetsPage } from './pages/AssetsPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { VlanPoliciesPage } from './pages/VlanPoliciesPage';
import { PortsPage } from './pages/PortsPage';
import { ConnectionsPage } from './pages/ConnectionsPage';

export default function App() {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <Loading label="Starting…" />
      </div>
    );
  }

  if (!session?.connected) return <ConnectPage />;

  return (
    <Layout session={session}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/policies/:dpp" element={<PoliciesPage />} />
        <Route path="/vlan-policies" element={<VlanPoliciesPage />} />
        <Route path="/ports" element={<PortsPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </Layout>
  );
}
