import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout, NAV } from './components/Layout';
import { Loading } from './components/ui';
import LoginPage from './pages/LoginPage';

const Dashboard = lazy(() => import('./pages/DashboardPage'));
const Pos = lazy(() => import('./pages/PosPage'));
const Sales = lazy(() => import('./pages/SalesPage'));
const SaleDetail = lazy(() => import('./pages/SaleDetailPage'));
const PrintPage = lazy(() => import('./pages/PrintPage'));
const Products = lazy(() => import('./pages/ProductsPage'));
const ProductDetail = lazy(() => import('./pages/ProductDetailPage'));
const Catalog = lazy(() => import('./pages/CatalogPage'));
const Stock = lazy(() => import('./pages/StockPage'));
const Purchases = lazy(() => import('./pages/PurchasesPage'));
const PurchaseDetail = lazy(() => import('./pages/PurchaseDetailPage'));
const Suppliers = lazy(() => import('./pages/SuppliersPage'));
const Customers = lazy(() => import('./pages/CustomersPage'));
const Returns = lazy(() => import('./pages/ReturnsPage'));
const Expenses = lazy(() => import('./pages/ExpensesPage'));
const Cash = lazy(() => import('./pages/CashPage'));
const Reports = lazy(() => import('./pages/ReportsPage'));
const Staff = lazy(() => import('./pages/StaffPage'));
const Audit = lazy(() => import('./pages/AuditPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const Offline = lazy(() => import('./pages/OfflinePage'));
const Account = lazy(() => import('./pages/AccountPage'));

function Guard({ perms, children }: { perms?: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (perms && !can(...perms)) {
    return <div className="card p-8 text-center text-sm text-slate-600">You do not have permission to open this page.</div>;
  }
  return <>{children}</>;
}

const p = (to: string) => NAV.find((n) => n.to === to)?.perms;

/** First page the signed-in user is allowed to see. */
function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('sales.create')) return <Navigate to="/pos" replace />;
  return <Navigate to="/products" replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Starting YASH MOBILE POS..." />;
  if (!user) return <LoginPage />;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/print/:id" element={<Guard perms={['sales.view_own', 'sales.view_all', 'sales.create']}><PrintPage /></Guard>} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="pos" element={<Guard perms={p('/pos')}><Pos /></Guard>} />
          <Route path="sales" element={<Guard perms={p('/sales')}><Sales /></Guard>} />
          <Route path="sales/:id" element={<Guard perms={p('/sales')}><SaleDetail /></Guard>} />
          <Route path="products" element={<Guard perms={p('/products')}><Products /></Guard>} />
          <Route path="products/:id" element={<Guard perms={p('/products')}><ProductDetail /></Guard>} />
          <Route path="catalog" element={<Guard perms={p('/catalog')}><Catalog /></Guard>} />
          <Route path="stock" element={<Guard perms={p('/stock')}><Stock /></Guard>} />
          <Route path="purchases" element={<Guard perms={p('/purchases')}><Purchases /></Guard>} />
          <Route path="purchases/:id" element={<Guard perms={p('/purchases')}><PurchaseDetail /></Guard>} />
          <Route path="suppliers" element={<Guard perms={p('/suppliers')}><Suppliers /></Guard>} />
          <Route path="customers" element={<Guard perms={p('/customers')}><Customers /></Guard>} />
          <Route path="returns" element={<Guard perms={p('/returns')}><Returns /></Guard>} />
          <Route path="expenses" element={<Guard perms={p('/expenses')}><Expenses /></Guard>} />
          <Route path="cash" element={<Guard perms={p('/cash')}><Cash /></Guard>} />
          <Route path="reports" element={<Guard perms={p('/reports')}><Reports /></Guard>} />
          <Route path="reports/:key" element={<Guard perms={p('/reports')}><Reports /></Guard>} />
          <Route path="staff" element={<Guard perms={p('/staff')}><Staff /></Guard>} />
          <Route path="audit" element={<Guard perms={p('/audit')}><Audit /></Guard>} />
          <Route path="settings" element={<Guard perms={p('/settings')}><SettingsPage /></Guard>} />
          <Route path="offline" element={<Offline />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<div className="card p-8 text-center text-sm text-slate-600">Page not found.</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
