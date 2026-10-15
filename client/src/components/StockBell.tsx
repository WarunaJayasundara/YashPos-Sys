import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, BellRing, PackageX, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Button, Modal } from './ui';
import { useToast } from './toast';

export interface LowItem { id: number; name: string; sku: string; available: number; reorderLevel: number; status: 'LOW' | 'OUT'; supplier: string | null }
interface Alerts {
  lowCount: number; outCount: number; items: LowItem[]; latestAlertId: number;
  recent: { id: number; productId: number; level: 'LOW' | 'OUT'; qtyAvailable: number; name: string; sku: string; createdAt: string }[];
}

const SEEN = 'yash.lastAlertSeen';
const read = (): number | null => { try { const v = localStorage.getItem(SEEN); return v === null ? null : Number(v); } catch { return null; } };
const write = (id: number) => { try { localStorage.setItem(SEEN, String(id)); } catch { /* storage blocked */ } };
const canNotify = () => typeof Notification !== 'undefined';

/** Low-stock bell for the owner/manager: badge count, list, and a pop-up (and device notification) for new alerts. */
export function StockBell() {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('stock.view', 'reports.inventory', 'products.manage');
  const q = useQuery({ queryKey: ['stock-alerts'], queryFn: () => api.get<Alerts>('/alerts/stock'), enabled: allowed, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(canNotify() ? Notification.permission : 'denied');

  // announce alerts that arrived since this device last looked
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const seen = read();
    if (seen === null) { write(d.latestAlertId); return; } // first run on this device: no backlog of pop-ups
    const fresh = d.recent.filter((a) => a.id > seen);
    if (!fresh.length) return;
    write(d.latestAlertId);
    const text = fresh.slice(0, 3).map((a) => `${a.name} ${a.level === 'OUT' ? 'sold out' : `low (${a.qtyAvailable} left)`}`).join(', ') + (fresh.length > 3 ? ` and ${fresh.length - 3} more` : '');
    toast(`Stock alert: ${text}`, 'error');
    if (canNotify() && Notification.permission === 'granted') {
      try { new Notification('Low stock', { body: text, icon: '/icon-192.png', tag: 'yash-stock' }); } catch { /* not allowed in this context */ }
    }
  }, [q.data, toast]);

  if (!allowed || !q.data) return null;
  const { lowCount, outCount, items, recent } = q.data;
  const total = lowCount + outCount;

  const enableNotifications = async () => {
    if (!canNotify()) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') toast('This device will now notify you about low stock while the POS is open');
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx('relative grid h-9 w-9 place-items-center rounded-lg transition hover:bg-slate-100', total ? 'text-amber-600' : 'text-slate-500')}
        aria-label={total ? `${total} items low on stock` : 'Stock alerts'}
        title={total ? `${outCount} sold out, ${lowCount} low` : 'No low stock'}
      >
        {total ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {total > 0 && (
          <span className={clsx('absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full px-1 text-center text-[11px] font-bold leading-[18px] text-white', outCount ? 'bg-red-600' : 'bg-amber-500')}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Low stock" wide
        footer={<>
          {canNotify() && perm === 'default' && <Button variant="secondary" onClick={enableNotifications}><BellRing className="h-4 w-4" />Notify me on this device</Button>}
          <Link to="/purchases" onClick={() => setOpen(false)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white hover:bg-brand-700"><ShoppingBag className="h-4 w-4" />New purchase</Link>
        </>}>
        {total === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Nothing is low. Every product is above its reorder level.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-600"><b className="text-red-700">{outCount} sold out</b> and <b className="text-amber-700">{lowCount} low</b> (at or below the reorder level).</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {items.map((i) => (
                <li key={i.id}>
                  <Link to={`/products/${i.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                    <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', i.status === 'OUT' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600')}><PackageX className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{i.name}</span>
                      <span className="block truncate text-xs text-slate-500">{i.sku}{i.supplier ? ` · ${i.supplier}` : ''}</span>
                    </span>
                    <span className="text-right">
                      <span className={clsx('block text-sm font-bold tabular-nums', i.status === 'OUT' ? 'text-red-700' : 'text-amber-700')}>{i.status === 'OUT' ? 'Sold out' : `${i.available} left`}</span>
                      <span className="block text-[11px] text-slate-500">reorder at {i.reorderLevel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Alerts in the last 7 days</h3>
            <ul className="space-y-1 text-xs text-slate-600">
              {recent.slice(0, 10).map((a) => (
                <li key={a.id} className="flex justify-between gap-3"><span className="truncate">{a.name}: {a.level === 'OUT' ? 'sold out' : `dropped to ${a.qtyAvailable}`}</span><span className="shrink-0 text-slate-400">{dateTime(a.createdAt)}</span></li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}
