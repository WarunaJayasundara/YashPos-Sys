import clsx from 'clsx';
import {
  BarChart3, Boxes, ClipboardList, CloudOff, History, LayoutDashboard, LogOut, Menu, Package, Receipt, RotateCcw, Settings,
  ShieldCheck, ShoppingCart, Tags, Truck, Users, Wallet, X, RefreshCw, Banknote, ShieldPlus, PanelLeftClose, PanelLeftOpen,
  ChevronDown, UserRound, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useOnline, usePending } from '../lib/useOnline';
import { lastSyncedAt, syncCatalog, syncPending } from '../lib/offline';
import { dateTime } from '../lib/format';
import { useToast } from './toast';
import { StockBell } from './StockBell';

interface Item { to: string; label: string; icon: LucideIcon; perms: string[] }
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Sell',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'] },
      { to: '/pos', label: 'POS / New sale', icon: ShoppingCart, perms: ['sales.create'] },
      { to: '/sales', label: 'Sales history', icon: Receipt, perms: ['sales.view_own', 'sales.view_all'] },
      { to: '/returns', label: 'Returns & warranty', icon: RotateCcw, perms: ['returns.create', 'returns.approve', 'warranty.manage'] },
      { to: '/customers', label: 'Customers', icon: Users, perms: ['customers.view'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/products', label: 'Products', icon: Package, perms: ['products.view'] },
      { to: '/catalog', label: 'Categories & brands', icon: Tags, perms: ['catalog.manage'] },
      { to: '/stock', label: 'Stock movements', icon: Boxes, perms: ['stock.view', 'stock.adjust'] },
      { to: '/purchases', label: 'Purchases', icon: ClipboardList, perms: ['purchases.view'] },
      { to: '/suppliers', label: 'Suppliers', icon: Truck, perms: ['purchases.view', 'suppliers.manage'] },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Wallet, perms: ['expenses.view'] },
      { to: '/cash', label: 'Cash closing', icon: Banknote, perms: ['cash.close'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, perms: ['reports.sales', 'reports.inventory', 'reports.financial', 'cash.close'] },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/staff', label: 'Staff & permissions', icon: ShieldPlus, perms: ['users.manage'] },
      { to: '/audit', label: 'Audit log', icon: ShieldCheck, perms: ['audit.view'] },
      { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.manage'] },
    ],
  },
];
export const NAV: Item[] = GROUPS.flatMap((g) => g.items);

const initials = (n?: string) => (n ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Keeps the cached catalogue fresh and pushes queued offline sales. */
function useSync() {
  const online = useOnline();
  const pending = usePending();
  const { user } = useAuth();
  const toast = useToast();
  const [synced, setSynced] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { lastSyncedAt().then(setSynced).catch(() => undefined); }, []);

  const sync = async (quiet = false) => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const r = await syncPending(user.username);
      setSynced(await syncCatalog());
      if (!quiet && (r.synced || r.conflicts)) toast(`${r.synced} offline sale(s) synced${r.conflicts ? `, ${r.conflicts} need attention` : ''}`, r.conflicts ? 'error' : 'success');
      else if (quiet && r.synced) toast(`${r.synced} offline sale(s) sent to the server`);
    } catch {
      /* stays pending */
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (online) sync(true);
    const t = setInterval(() => navigator.onLine && sync(true), 10 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, user?.username]);

  return { online, pending, synced, busy, sync };
}

function StatusPill({ s }: { s: ReturnType<typeof useSync> }) {
  const conflicts = s.pending.filter((p) => p.status === 'CONFLICT').length;
  if (!s.online) return <Link to="/offline" className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-600/20"><CloudOff className="h-3.5 w-3.5" />Offline{s.pending.length ? ` · ${s.pending.length} pending` : ''}</Link>;
  if (s.pending.length) return <Link to="/offline" className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/25"><RefreshCw className={clsx('h-3.5 w-3.5', s.busy && 'animate-spin')} />{s.pending.length - conflicts} to sync{conflicts ? ` · ${conflicts} to fix` : ''}</Link>;
  return <span title={s.synced ? `Catalogue synced ${dateTime(s.synced)}` : undefined} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span><span className="hidden min-[400px]:inline">Online</span></span>;
}

function OfflineBanner({ s }: { s: ReturnType<typeof useSync> }) {
  if (s.online && !s.pending.length) return null;
  const conflicts = s.pending.filter((p) => p.status === 'CONFLICT').length;
  return (
    <div className={clsx('no-print flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs font-medium lg:hidden', s.online ? 'bg-amber-100 text-amber-900' : 'bg-red-600 text-white')} role="status">
      {!s.online && <span className="flex items-center gap-1"><CloudOff className="h-4 w-4" />Offline. Sales are saved on this device only until synced.</span>}
      {s.pending.length - conflicts > 0 && <span>{s.pending.length - conflicts} sale(s) waiting to sync</span>}
      {conflicts > 0 && <Link to="/offline" className="underline">{conflicts} need reconciliation</Link>}
      {s.online && s.pending.length > 0 && <button onClick={() => s.sync()} className="ml-auto rounded bg-white/70 px-2 py-0.5" disabled={s.busy}>Sync now</button>}
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="flex flex-col gap-4 px-3 py-2" aria-label="Main">
      {GROUPS.map((g) => {
        const items = g.items.filter((n) => can(...n.perms));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            {!collapsed && <p className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[.12em] text-slate-500">{g.title}</p>}
            {collapsed && <div className="mx-auto mb-2 h-px w-6 bg-white/10" />}
            <div className="flex flex-col gap-0.5">
              {items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNavigate} title={collapsed ? n.label : undefined}
                  className={({ isActive }) => clsx('group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-white/[.08] text-white' : 'text-slate-400 hover:bg-white/[.04] hover:text-slate-100')}>
                  {({ isActive }) => <>
                    {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-gold-400" />}
                    <n.icon className={clsx('h-[18px] w-[18px] shrink-0', isActive ? 'text-gold-400' : 'text-slate-500 group-hover:text-slate-300')} />
                    {!collapsed && n.label}
                  </>}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className={clsx('flex items-center gap-3 px-5 py-5', collapsed && 'justify-center px-0')}>
      <img src="/icon.svg" alt="" className="h-9 w-9 rounded-xl shadow-lg shadow-black/30" />
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold tracking-wide text-white">YASH <span className="text-gold-400">MOBILE</span></p>
          <p className="text-[11px] font-medium text-slate-400">Point of sale</p>
        </div>
      )}
    </Link>
  );
}

function UserMenu({ compact }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-xs font-bold text-white">{initials(user?.fullName)}</span>
        {!compact && <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-semibold text-slate-800">{user?.fullName}</span><span className="block text-[11px] text-slate-500">{user?.roleName}</span></span>}
        <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-pop animate-fade-up" role="menu">
          <div className="border-b border-slate-100 px-4 py-2.5 sm:hidden"><p className="text-sm font-semibold">{user?.fullName}</p><p className="text-xs text-slate-500">{user?.roleName}</p></div>
          <Link to="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" role="menuitem"><UserRound className="h-4 w-4" />My account</Link>
          <button onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50" role="menuitem"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { can } = useAuth();
  const s = useSync();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('yash.navCollapsed') === '1'; } catch { return false; } });
  const loc = useLocation();
  const isPos = loc.pathname === '/pos';
  useEffect(() => setOpen(false), [loc.pathname]);
  // the till screen needs the width: icon-only sidebar there
  const slim = collapsed || isPos;
  useEffect(() => { try { localStorage.setItem('yash.navCollapsed', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);

  const bottom = [
    { to: '/', label: 'Home', icon: LayoutDashboard, perms: ['dashboard.view'] },
    { to: '/products', label: 'Stock', icon: Package, perms: ['products.view'] },
    { to: '/pos', label: 'Sell', icon: ShoppingCart, perms: ['sales.create'], main: true },
    { to: '/sales', label: 'Sales', icon: History, perms: ['sales.view_own', 'sales.view_all'] },
  ].filter((b) => can(...b.perms));

  return (
    <div className="flex min-h-[100dvh]">
      {/* desktop sidebar */}
      <aside className={clsx('no-print fixed inset-y-0 left-0 z-30 hidden flex-col bg-ink-900 transition-[width] duration-200 lg:flex', slim ? 'w-[76px]' : 'w-64')}>
        <Brand collapsed={slim} />
        <div className="flex-1 overflow-y-auto pb-4 scrollbar-none"><NavList collapsed={slim} /></div>
        {!isPos && <button onClick={() => setCollapsed((c) => !c)} className={clsx('m-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/5 hover:text-slate-300', collapsed && 'justify-center')} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />Collapse</>}
        </button>}
      </aside>

      {/* phone / tablet drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[19rem] max-w-[86vw] flex-col bg-ink-900 shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between pr-3"><Brand /><button className="rounded-lg p-2 text-slate-400 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></div>
            <div className="flex-1 overflow-y-auto pb-6"><NavList onNavigate={() => setOpen(false)} /></div>
          </div>
        </div>
      )}

      <div className={clsx('flex min-w-0 flex-1 flex-col transition-[padding] duration-200', slim ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200/80 bg-white/85 px-3 backdrop-blur-md sm:px-5 lg:h-16 lg:px-8">
          <button className="-ml-1 rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <Link to="/" className="flex items-center gap-2 lg:hidden"><img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" /><span className="whitespace-nowrap text-sm font-extrabold tracking-wide text-ink-900">YASH <span className="text-brand-600">MOBILE</span></span></Link>
          <p className="hidden text-sm text-slate-500 lg:block">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo' })}</p>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <StockBell />
            <StatusPill s={s} />
            {can('sales.create') && !isPos && (
              <Link to="/pos" className="hidden h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 sm:inline-flex"><ShoppingCart className="h-4 w-4" />New sale</Link>
            )}
            <UserMenu compact={isPos} />
          </div>
        </header>
        <OfflineBanner s={s} />
        {isPos
          ? <main className="flex min-h-0 flex-1 flex-col">{children ?? <Outlet />}</main>
          : <main key={loc.pathname} className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-5 pb-28 sm:px-5 lg:px-8 lg:py-7 lg:pb-10">{children ?? <Outlet />}</main>}

        {/* phone bottom bar */}
        {!isPos && (
          <nav className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-safe lg:hidden" aria-label="Quick">
            <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
              {bottom.map((b) => b.main ? (
                <NavLink key={b.to} to={b.to} className="flex flex-col items-center justify-start" aria-label="New sale">
                  <span className="-mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/40 ring-4 ring-white"><b.icon className="h-6 w-6" /></span>
                  <span className="mt-0.5 text-[11px] font-semibold text-brand-700">{b.label}</span>
                </NavLink>
              ) : (
                <NavLink key={b.to} to={b.to} end={b.to === '/'} className={({ isActive }) => clsx('flex flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-brand-600' : 'text-slate-500')}>
                  <b.icon className="h-5 w-5" />{b.label}
                </NavLink>
              ))}
              <button onClick={() => setOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-500"><Menu className="h-5 w-5" />More</button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
