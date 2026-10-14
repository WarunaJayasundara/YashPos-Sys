import clsx from 'clsx';
import {
  BarChart3, Boxes, ClipboardList, CloudOff, FileText, History, LayoutDashboard, LogOut, Menu, Package, Receipt, RotateCcw,
  Settings, ShieldCheck, ShoppingCart, Tags, Truck, Users, Wallet, X, RefreshCw, Banknote, ShieldPlus,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useOnline, usePending } from '../lib/useOnline';
import { lastSyncedAt, syncCatalog, syncPending } from '../lib/offline';
import { dateTime } from '../lib/format';
import { useToast } from './toast';

interface Item { to: string; label: string; icon: typeof LayoutDashboard; perms: string[] }
export const NAV: Item[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'] },
  { to: '/pos', label: 'POS / New sale', icon: ShoppingCart, perms: ['sales.create'] },
  { to: '/sales', label: 'Sales history', icon: Receipt, perms: ['sales.view_own', 'sales.view_all'] },
  { to: '/products', label: 'Products', icon: Package, perms: ['products.view'] },
  { to: '/catalog', label: 'Categories & brands', icon: Tags, perms: ['catalog.manage'] },
  { to: '/stock', label: 'Inventory / Stock', icon: Boxes, perms: ['stock.view', 'stock.adjust'] },
  { to: '/purchases', label: 'Purchases', icon: ClipboardList, perms: ['purchases.view'] },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, perms: ['purchases.view', 'suppliers.manage'] },
  { to: '/customers', label: 'Customers', icon: Users, perms: ['customers.view'] },
  { to: '/returns', label: 'Returns & warranty', icon: RotateCcw, perms: ['returns.create', 'returns.approve', 'warranty.manage'] },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perms: ['expenses.view'] },
  { to: '/cash', label: 'Cash closing', icon: Banknote, perms: ['cash.close'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, perms: ['reports.sales', 'reports.inventory', 'reports.financial', 'cash.close'] },
  { to: '/staff', label: 'Staff & permissions', icon: ShieldPlus, perms: ['users.manage'] },
  { to: '/audit', label: 'Audit logs', icon: ShieldCheck, perms: ['audit.view'] },
  { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.manage'] },
];

function SyncBar() {
  const online = useOnline();
  const pending = usePending();
  const { user } = useAuth();
  const toast = useToast();
  const [synced, setSynced] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    lastSyncedAt().then(setSynced).catch(() => undefined);
  }, []);

  const sync = async (quiet = false) => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const r = await syncPending(user.username);
      setSynced(await syncCatalog());
      if (!quiet && (r.synced || r.conflicts)) toast(`${r.synced} offline sale(s) synced${r.conflicts ? `, ${r.conflicts} need attention` : ''}`, r.conflicts ? 'error' : 'success');
    } catch {
      /* stays pending */
    } finally {
      setBusy(false);
    }
  };

  // sync when the connection returns, and refresh the catalogue every 10 minutes
  useEffect(() => {
    if (online) sync(true);
    const t = setInterval(() => navigator.onLine && sync(true), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, user?.username]);

  const waiting = pending.filter((p) => p.status !== 'CONFLICT').length;
  const conflicts = pending.filter((p) => p.status === 'CONFLICT').length;
  if (online && !pending.length) {
    return synced ? <p className="no-print hidden px-4 pb-2 text-[11px] text-slate-400 lg:block">Catalogue synced {dateTime(synced)}</p> : null;
  }
  return (
    <div className={clsx('no-print flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs font-medium', online ? 'bg-amber-100 text-amber-900' : 'bg-red-600 text-white')} role="status">
      {!online && <span className="flex items-center gap-1"><CloudOff className="h-4 w-4" /> Offline - sales are saved on this device and are NOT yet recorded on the server</span>}
      {waiting > 0 && <span>{waiting} sale(s) waiting to sync</span>}
      {conflicts > 0 && <NavLink to="/offline" className="underline">{conflicts} sale(s) need reconciliation</NavLink>}
      {synced && <span className="opacity-80">Last sync {dateTime(synced)}</span>}
      {online && pending.length > 0 && (
        <button onClick={() => sync()} className="ml-auto inline-flex items-center gap-1 rounded bg-white/70 px-2 py-0.5 text-amber-900" disabled={busy}>
          <RefreshCw className={clsx('h-3 w-3', busy && 'animate-spin')} /> Sync now
        </button>
      )}
      <NavLink to="/offline" className="underline">View queue</NavLink>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
      {NAV.filter((n) => can(...n.perms)).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate}
          className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-700 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white')}>
          <n.icon className="h-[18px] w-[18px] shrink-0" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <img src="/icon.svg" alt="" className="h-9 w-9" />
      <div className="leading-tight">
        <p className="text-sm font-extrabold tracking-wide text-white">YASH MOBILE</p>
        <p className="text-[11px] text-slate-400">POS & Inventory</p>
      </div>
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const bottom = [
    { to: '/', label: 'Home', icon: LayoutDashboard, perms: ['dashboard.view'] },
    { to: '/pos', label: 'POS', icon: ShoppingCart, perms: ['sales.create'] },
    { to: '/products', label: 'Stock', icon: Package, perms: ['products.view'] },
    { to: '/sales', label: 'Sales', icon: History, perms: ['sales.view_own', 'sales.view_all'] },
    { to: '/reports', label: 'Reports', icon: FileText, perms: ['reports.sales', 'reports.inventory', 'reports.financial'] },
  ].filter((b) => can(...b.perms)).slice(0, 4);

  return (
    <div className="flex min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-900 lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto"><NavList /></div>
        <UserBox name={user?.fullName} role={user?.roleName} onLogout={logout} />
      </aside>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-slate-900 shadow-xl">
            <div className="flex items-center justify-between pr-2"><Brand /><button className="rounded-lg p-2 text-slate-300" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
            <div className="flex-1 overflow-y-auto"><NavList onNavigate={() => setOpen(false)} /></div>
            <UserBox name={user?.fullName} role={user?.roleName} onLogout={logout} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:hidden">
          <button className="rounded-lg p-2 text-slate-700 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="text-sm font-extrabold tracking-wide text-brand-900">YASH MOBILE</span>
          <span className="ml-auto truncate text-xs text-slate-500">{user?.fullName}</span>
        </header>
        <div className="no-print sticky top-[52px] z-10 lg:top-0"><SyncBar /></div>
        <main className="flex-1 px-3 py-4 pb-24 sm:px-5 lg:px-8 lg:pb-8">{children ?? <Outlet />}</main>
        <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }} aria-label="Quick">
          {bottom.map((b) => (
            <NavLink key={b.to} to={b.to} end={b.to === '/'} className={({ isActive }) => clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}>
              <b.icon className="h-5 w-5" />{b.label}
            </NavLink>
          ))}
          <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500"><Menu className="h-5 w-5" />More</button>
        </nav>
      </div>
    </div>
  );
}

function UserBox({ name, role, onLogout }: { name?: string; role?: string; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-white/10 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <p className="truncate text-xs text-slate-400">{role}</p>
      </div>
      <NavLink to="/account" className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="My account"><Settings className="h-4 w-4" /></NavLink>
      <button onClick={onLogout} className="rounded-lg p-2 text-slate-300 hover:bg-white/10" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
    </div>
  );
}
