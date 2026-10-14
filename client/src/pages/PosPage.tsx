import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, CheckCircle2, ChevronDown, ChevronUp, CloudOff, CreditCard, Delete, FileDown, Landmark, Minus, NotebookPen, Percent, Plus, Printer,
  QrCode, ScanBarcode, Search, ShoppingBag, Trash2, UserRound, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getCatalog, queueSale, syncCatalog, type CatalogItem } from '../lib/offline';
import { money, toNum, uuid, METHOD_LABEL } from '../lib/format';
import type { Sale, Settings } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import { Avatar, Button, Input, Modal } from '../components/ui';
import { ProductForm } from '../components/ProductForm';
import { useApproval } from '../components/Approval';
import { useToast } from '../components/toast';

interface Line { product: CatalogItem; qty: number; unitPrice: number; lineDiscount: number; serialNumber: string }
type Method = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'QR' | 'CREDIT';
interface Pay { method: Method; amount: string; reference: string }

const cents = (v: number) => Math.round(v * 100);
const METHODS: { m: Method; icon: typeof Banknote }[] = [
  { m: 'CASH', icon: Banknote }, { m: 'CARD', icon: CreditCard }, { m: 'QR', icon: QrCode }, { m: 'BANK_TRANSFER', icon: Landmark }, { m: 'CREDIT', icon: NotebookPen },
];

export function matchProducts(catalog: CatalogItem[], term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const words = t.split(/\s+/);
  const scored: { p: CatalogItem; s: number }[] = [];
  for (const p of catalog) {
    if (p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t) { scored.push({ p, s: 100 }); continue; }
    const hay = [p.name, p.sku, p.brand, p.compatibility, p.connectorType, p.color, p.category].filter(Boolean).join(' ').toLowerCase();
    if (words.every((w) => hay.includes(w))) {
      const name = p.name.toLowerCase();
      scored.push({ p, s: (name.startsWith(t) ? 50 : 10) + words.filter((w) => name.includes(w)).length * 5 + (name.startsWith(words[0]) ? 8 : 0) + (p.qtyAvailable > 0 ? 1 : 0) });
    }
  }
  return scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, 60).map((x) => x.p);
}

export default function PosPage() {
  const { user, can } = useAuth();
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const { run, dialog } = useApproval();
  const searchRef = useRef<HTMLInputElement>(null);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [bumped, setBumped] = useState<number | null>(null);
  const [billDiscount, setBillDiscount] = useState('');
  const [discountPct, setDiscountPct] = useState(false);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [customerOpen, setCustomerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const [savedOffline, setSavedOffline] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const requestId = useRef(uuid());

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 300_000 });
  const taxRate = toNum(settings.data?.taxRate);

  const loadCatalog = async (fromServer: boolean) => {
    if (fromServer) await syncCatalog().catch(() => undefined);
    setCatalog(await getCatalog());
    setLoaded(true);
  };
  useEffect(() => { loadCatalog(navigator.onLine); }, []);
  useEffect(() => { requestId.current = uuid(); }, [lines, billDiscount, discountPct]);

  const categories = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    for (const p of catalog) {
      const key = p.categoryId ?? 0; // 0 = items with no category
      const c = m.get(key) ?? { id: key, name: p.category ?? 'Other', count: 0 };
      c.count++;
      m.set(key, c);
    }
    return [...m.values()].sort((a, b) => Number(a.id === 0) - Number(b.id === 0) || a.name.localeCompare(b.name));
  }, [catalog]);

  const visible = useMemo(() => {
    const base = term.trim() ? matchProducts(catalog, term) : [...catalog].sort((a, b) => Number(b.qtyAvailable > 0) - Number(a.qtyAvailable > 0) || a.name.localeCompare(b.name));
    return category !== null ? base.filter((p) => (p.categoryId ?? 0) === category) : base;
  }, [catalog, term, category]);
  useEffect(() => setActive(0), [term, category]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) && lines.length && !payOpen) { e.preventDefault(); setPayOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length, payOpen]);

  const inCart = (id: number) => lines.find((l) => l.product.id === id)?.qty ?? 0;

  const add = (p: CatalogItem) => {
    if (inCart(p.id) + 1 > p.qtyAvailable) { toast(`Only ${p.qtyAvailable} of ${p.name} in stock`, 'error'); return; }
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { product: p, qty: 1, unitPrice: toNum(p.sellingPrice), lineDiscount: 0, serialNumber: '' }];
    });
    setBumped(p.id);
    setTimeout(() => setBumped(null), 260);
    if (term) setTerm('');
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
  };

  const setQty = (id: number, qty: number) => {
    setLines((ls) => ls.flatMap((l) => {
      if (l.product.id !== id) return [l];
      if (qty <= 0) return [];
      if (qty > l.product.qtyAvailable) { toast(`Only ${l.product.qtyAvailable} available`, 'error'); return [{ ...l, qty: l.product.qtyAvailable }]; }
      return [{ ...l, qty }];
    }));
  };
  const patch = (id: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, ...p } : l)));

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const cols = window.innerWidth >= 1536 ? 5 : window.innerWidth >= 1280 ? 4 : 3;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + cols, visible.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - cols, 0)); }
    else if (e.key === 'ArrowRight' && term === '') { setActive((a) => Math.min(a + 1, visible.length - 1)); }
    else if (e.key === 'ArrowLeft' && term === '') { setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') setTerm('');
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = term.trim().toLowerCase();
      // scanners type the code and press Enter: exact barcode/SKU wins
      const exact = catalog.find((p) => p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t);
      const pick = exact ?? (t ? visible[active] : undefined);
      if (pick) add(pick);
      else if (t) toast(`No product matches "${term}"`, 'error');
    }
  };

  // totals preview; the server recalculates authoritatively
  const subtotal = lines.reduce((a, l) => a + cents(l.unitPrice) * l.qty, 0);
  const lineDisc = lines.reduce((a, l) => a + cents(l.lineDiscount), 0);
  const listTotal = lines.reduce((a, l) => a + cents(toNum(l.product.sellingPrice)) * l.qty, 0);
  const afterLines = subtotal - lineDisc;
  const bill = discountPct ? Math.round((afterLines * Math.min(100, toNum(billDiscount))) / 100) : cents(toNum(billDiscount));
  const net = Math.max(0, afterLines - bill);
  const tax = Math.round((net * taxRate) / 100);
  const total = net + tax;
  const discPct = listTotal ? ((listTotal - net) * 100) / listTotal : 0;
  const overLimit = discPct > (user?.maxDiscountPercent ?? 0) + 1e-9 && !can('discounts.override');
  const belowMin = lines.some((l) => cents(l.unitPrice) * l.qty - cents(l.lineDiscount) < cents(toNum(l.product.minSellingPrice)) * l.qty);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);

  const reset = () => {
    setLines([]); setBillDiscount(''); setDiscountPct(false); setCustomer({ name: '', phone: '' }); setCustomerOpen(false); setExpanded(null); setCartOpen(false);
    requestId.current = uuid();
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
  };

  const buildPayload = (pays: Pay[]) => ({
    clientRequestId: requestId.current,
    items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineDiscount: l.lineDiscount, serialNumber: l.serialNumber || undefined })),
    billDiscount: bill / 100,
    payments: pays.filter((p) => toNum(p.amount) > 0).map((p) => ({ method: p.method, amount: toNum(p.amount), reference: p.reference || undefined })),
    customer: customer.phone || customer.name ? { name: customer.name || undefined, phone: customer.phone || undefined } : undefined,
  });

  const saveOffline = async (payload: ReturnType<typeof buildPayload>) => {
    await queueSale({
      clientRequestId: payload.clientRequestId, payload: { ...payload, offlineCreatedAt: new Date().toISOString() }, username: user!.username,
      total: total / 100, summary: lines.map((l) => `${l.qty} x ${l.product.name}`).join(', '),
    });
    setCatalog(await getCatalog());
    setSavedOffline(payload.clientRequestId);
    setPayOpen(false);
    reset();
  };

  const checkout = async (pays: Pay[]) => {
    const payload = buildPayload(pays);
    if (!navigator.onLine) return saveOffline(payload);
    try {
      const r = await run((approval) => api.post<{ sale: Sale; duplicate: boolean }>('/sales', { ...payload, approval }));
      setDone(r.sale);
      setPayOpen(false);
      reset();
      loadCatalog(true);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      const fmt = settings.data?.defaultPrintFormat ?? '80';
      window.open(`/print/${r.sale.id}?format=${fmt}&auto=1`, '_blank', 'noopener');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'APPROVAL_CANCELLED') return;
      if (e instanceof ApiError && e.status === 0) {
        if (window.confirm('The server did not answer. Save this sale on this device and sync it when the connection returns?')) await saveOffline(payload);
        return;
      }
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') loadCatalog(true);
      toast(errorText(e), 'error');
    }
  };

  const cart = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-slate-900">Current sale</h2>
          {itemCount > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{itemCount}</span>}
        </div>
        <div className="flex items-center gap-1">
          {lines.length > 0 && <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => window.confirm('Clear this sale?') && reset()}><Trash2 className="h-4 w-4" />Clear</Button>}
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setCartOpen(false)} aria-label="Close bill"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <button onClick={() => setCustomerOpen((o) => !o)} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition hover:bg-slate-50">
        <span className={clsx('grid h-8 w-8 place-items-center rounded-full', customer.phone || customer.name ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400')}><UserRound className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1 text-sm">{customer.phone || customer.name ? <><span className="font-semibold text-slate-800">{customer.name || 'Customer'}</span> <span className="text-slate-500">{customer.phone}</span></> : <span className="text-slate-500">Walk-in customer <span className="text-slate-400">· add details</span></span>}</span>
        {customerOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {customerOpen && (
        <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <Input placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} aria-label="Customer name" />
          <Input placeholder="Phone" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} aria-label="Customer phone" />
          <p className="col-span-2 text-[11px] text-slate-500">Optional. Needed for warranty look-ups and selling on account.</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!lines.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><ShoppingBag className="h-7 w-7" /></span>
            <p className="font-semibold text-slate-700">No items yet</p>
            <p className="text-sm text-slate-500">Scan a barcode or tap a product.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l) => {
              const lineTotal = cents(l.unitPrice) * l.qty - cents(l.lineDiscount);
              const below = lineTotal < cents(toNum(l.product.minSellingPrice)) * l.qty;
              const edited = cents(l.unitPrice) !== cents(toNum(l.product.sellingPrice)) || l.lineDiscount > 0;
              const open = expanded === l.product.id;
              return (
                <li key={l.product.id} className={clsx('px-4 py-3 transition', open && 'bg-slate-50/80')}>
                  <div className="flex items-start gap-3">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(open ? null : l.product.id)} aria-expanded={open}>
                      <p className="text-sm font-semibold leading-snug text-slate-900">{l.product.name}</p>
                      <p className={clsx('mt-0.5 text-xs', below ? 'font-medium text-red-600' : 'text-slate-500')}>
                        {money(l.unitPrice)} each{l.lineDiscount ? ` · −${money(l.lineDiscount)}` : ''}{edited && !below ? ' · edited' : ''}{below ? ' · below minimum' : ''}
                      </p>
                    </button>
                    <p className="pt-0.5 text-sm font-bold tabular-nums text-slate-900">{money(lineTotal / 100)}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
                      <button className="grid h-9 w-9 place-items-center rounded-l-xl text-slate-600 hover:bg-slate-50 active:bg-slate-100" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Decrease quantity">{l.qty === 1 ? <Trash2 className="h-4 w-4 text-red-500" /> : <Minus className="h-4 w-4" />}</button>
                      <input aria-label="Quantity" inputMode="numeric" className="h-9 w-11 border-x border-slate-200 text-center text-sm font-semibold tabular-nums outline-none"
                        value={l.qty} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) setQty(l.product.id, v); }} />
                      <button className="grid h-9 w-9 place-items-center rounded-r-xl text-slate-600 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-30" disabled={l.qty >= l.product.qtyAvailable} onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Increase quantity"><Plus className="h-4 w-4" /></button>
                    </div>
                    <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setExpanded(open ? null : l.product.id)}>{open ? 'Done' : 'Price / discount'}</button>
                  </div>
                  {open && (
                    <div className="mt-3 grid grid-cols-2 gap-2 animate-fade-up">
                      <Input label="Unit price" type="number" min={0} step="0.01" className="text-right tabular-nums" error={below ? `Min ${money(l.product.minSellingPrice)}` : undefined} value={l.unitPrice} onChange={(e) => patch(l.product.id, { unitPrice: Math.max(0, toNum(e.target.value)) })} />
                      <Input label="Line discount" type="number" min={0} step="0.01" className="text-right tabular-nums" placeholder="0.00" value={l.lineDiscount || ''} onChange={(e) => patch(l.product.id, { lineDiscount: Math.max(0, toNum(e.target.value)) })} />
                      {l.product.warrantyMonths > 0 && <Input wrapClass="col-span-2" label={`Serial / IMEI (warranty ${l.product.warrantyMonths} months)`} value={l.serialNumber} onChange={(e) => patch(l.product.id, { serialNumber: e.target.value })} />}
                      <p className="col-span-2 text-[11px] text-slate-500">List price {money(l.product.sellingPrice)} · {l.product.qtyAvailable} in stock</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200/80 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-600"><dt>Subtotal</dt><dd className="tabular-nums">{money(afterLines / 100)}</dd></div>
          <div className="flex items-center justify-between gap-2 text-slate-600">
            <dt>Discount</dt>
            <dd className="flex items-center gap-1.5">
              <div className="relative">
                <input type="number" min={0} step="0.01" className="input h-8 w-28 pr-7 text-right tabular-nums" placeholder="0" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} aria-label="Bill discount" />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{discountPct ? '%' : 'Rs'}</span>
              </div>
              <button onClick={() => setDiscountPct((p) => !p)} className={clsx('grid h-8 w-8 place-items-center rounded-lg border text-xs font-bold transition', discountPct ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50')} aria-label="Toggle percent discount" title="Percent / amount"><Percent className="h-3.5 w-3.5" /></button>
            </dd>
          </div>
          {bill > 0 && <div className="flex justify-between text-emerald-700"><dt>You save</dt><dd className="tabular-nums">−{money(bill / 100)}</dd></div>}
          {tax > 0 && <div className="flex justify-between text-slate-600"><dt>{settings.data?.taxLabel} ({taxRate}%)</dt><dd className="tabular-nums">{money(tax / 100)}</dd></div>}
          <div className="flex items-baseline justify-between pt-1.5"><dt className="text-base font-bold text-slate-900">Total</dt><dd className="text-2xl font-extrabold tracking-tight tabular-nums text-slate-900">{money(total / 100)}</dd></div>
        </dl>
        {(overLimit || belowMin) && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-600/20">{overLimit ? `Discount ${discPct.toFixed(1)}% is above your ${user?.maxDiscountPercent}% limit. ` : 'A price is below its minimum. '}A supervisor will approve at payment.</p>}
        {bill > afterLines && <p className="mt-2 text-xs font-medium text-red-600">The discount is larger than the bill.</p>}
        <Button size="xl" variant="success" className="mt-3 w-full justify-between" disabled={!lines.length || bill > afterLines} onClick={() => setPayOpen(true)}>
          <span>Charge</span><span className="tabular-nums">{money(total / 100)}</span>
        </Button>
        <p className="mt-2 hidden text-center text-[11px] text-slate-400 lg:block"><span className="kbd">F2</span> search · <span className="kbd">Enter</span> add · <span className="kbd">F9</span> pay</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {dialog}
      {/* catalogue */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-14 z-10 space-y-3 border-b border-slate-200/80 bg-[#f3f5f9]/95 px-3 py-3 backdrop-blur sm:px-5 lg:top-16 lg:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onSearchKey}
              className="input h-12 rounded-xl pl-11 pr-24 text-base shadow-card"
              placeholder="Scan or search products"
              aria-label="Search products"
              autoComplete="off"
              enterKeyHint="search"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 text-xs text-slate-400 sm:flex"><ScanBarcode className="h-4 w-4" /><span className="kbd">F2</span></span>
            {term && <button className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 sm:right-20" onClick={() => { setTerm(''); searchRef.current?.focus(); }} aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </div>
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 scrollbar-none sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6" role="tablist" aria-label="Categories">
            {[{ id: null as number | null, name: 'All', count: catalog.length }, ...categories].map((c) => (
              <button key={c.id ?? 'all'} role="tab" aria-selected={category === c.id} onClick={() => setCategory(c.id)}
                className={clsx('chip', category === c.id ? 'border-ink-900 bg-ink-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900')}>
                {c.name}<span className="text-xs text-slate-400">{c.count}</span>
              </button>
            ))}
          </div>
          {!online && <p className="flex items-center gap-1.5 text-xs font-medium text-red-700"><CloudOff className="h-4 w-4" />Offline: cached products, stock may be out of date. Sales are saved on this device.</p>}
        </div>

        <div className="flex-1 px-3 pb-32 pt-3 sm:px-5 lg:px-6 lg:pb-6">
          {!loaded ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
          ) : visible.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" role="listbox" aria-label="Products">
              {visible.map((p, i) => {
                const qty = inCart(p.id);
                const left = p.qtyAvailable - qty;
                const out = p.qtyAvailable <= 0;
                return (
                  <button key={p.id} role="option" aria-selected={i === active} onClick={() => add(p)} disabled={left <= 0}
                    className={clsx('group relative flex flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-card transition duration-150',
                      'hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift active:translate-y-0 active:scale-[.98] disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-card',
                      i === active && term ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-slate-200/80',
                      qty > 0 && 'border-brand-400 ring-2 ring-brand-500/20', bumped === p.id && 'animate-bump')}>
                    <div className={clsx('relative', out && 'opacity-40 grayscale')}>
                      <Avatar name={p.name} src={p.imageUrl} className="aspect-[2/1] w-full text-xl xl:aspect-[16/10] xl:text-2xl" />
                      {qty > 0 && <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white shadow-md ring-2 ring-white animate-pop">{qty}</span>}
                      <span className={clsx('absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold backdrop-blur',
                        out ? 'bg-red-600/90 text-white' : left <= 3 ? 'bg-amber-400/95 text-amber-950' : 'bg-white/85 text-slate-700')}>
                        {out ? 'Out of stock' : `${left} left`}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{p.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{[p.brand, p.compatibility].filter(Boolean).join(' · ') || p.sku}</p>
                      <p className="mt-auto whitespace-nowrap pt-2 text-[15px] font-bold tabular-nums text-brand-700">{money(p.sellingPrice)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-200/60 text-slate-400"><Search className="h-7 w-7" /></span>
              <p className="font-semibold text-slate-700">{catalog.length ? `Nothing matches "${term}"` : 'No products yet'}</p>
              <p className="text-sm text-slate-500">{catalog.length ? 'Try a shorter search or another category.' : 'Add products first, then they appear here.'}</p>
              {can('products.manage') && online && (
                <Button className="mt-3" onClick={() => setQuickAdd(term.trim() || ' ')}><Plus className="h-4 w-4" />{term.trim() ? `Add "${term.trim()}" as a new product` : 'Add a product'}</Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* desktop cart */}
      <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-[400px] shrink-0 border-l border-slate-200/80 bg-white lg:block xl:w-[430px]" aria-label="Current sale">{cart}</aside>

      {/* phone / tablet: bill bar + sheet */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <button onClick={() => setCartOpen(true)} disabled={!lines.length}
          className="flex h-14 w-full items-center gap-3 rounded-2xl bg-ink-900 px-4 text-white shadow-lg transition-transform active:scale-[.99] disabled:bg-slate-300">
          <span className="relative"><ShoppingBag className="h-6 w-6" />{itemCount > 0 && <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-gold-400 px-1 text-[11px] font-bold text-ink-900">{itemCount}</span>}</span>
          <span className="flex-1 text-left text-sm font-semibold">{lines.length ? 'View bill' : 'Tap products to add'}</span>
          <span className="text-lg font-bold tabular-nums">{money(total / 100)}</span>
        </button>
      </div>
      {cartOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Current sale">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 top-10 overflow-hidden rounded-t-3xl bg-white shadow-pop animate-slide-up sm:left-auto sm:top-0 sm:w-[440px] sm:rounded-none">{cart}</div>
        </div>
      )}

      <PaymentModal open={payOpen} total={total} onClose={() => setPayOpen(false)} onPay={checkout} hasCustomer={!!customer.phone} online={online} />

      <Modal open={quickAdd !== null} onClose={() => setQuickAdd(null)} title="New product" wide>
        {quickAdd !== null && (
          <ProductForm
            initialName={quickAdd.trim()}
            onCancel={() => setQuickAdd(null)}
            onSaved={async (p) => {
              setQuickAdd(null);
              setTerm('');
              await loadCatalog(true);
              const item = (await getCatalog()).find((c) => c.id === p.id);
              if (item && item.qtyAvailable > 0) add(item);
              else if (item) toast('Product added. It has no stock yet, so it was not put on the bill.', 'info');
            }}
          />
        )}
      </Modal>

      <Modal open={!!done} onClose={() => setDone(null)} title="Sale completed">
        {done && (
          <div className="flex flex-col items-center pb-2 text-center">
            <span className="mt-1 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600 animate-pop"><CheckCircle2 className="h-9 w-9" /></span>
            <p className="mt-3 text-sm text-slate-500">Invoice <b className="text-slate-800">{done.invoiceNumber}</b> · total {money(done.total)}</p>
            {toNum(done.changeDue) > 0 ? (
              <div className="mt-4 w-full rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-600/15"><p className="text-sm font-medium text-emerald-800">Change due</p><p className="text-4xl font-extrabold tracking-tight tabular-nums text-emerald-700">{money(done.changeDue)}</p></div>
            ) : <p className="mt-4 text-lg font-semibold text-slate-800">Paid in full</p>}
            <p className="mt-4 text-xs text-slate-500">The receipt opened in a new tab. Print again:</p>
            <div className="mt-2 grid w-full grid-cols-4 gap-2">
              {(['80', '58', 'A4'] as const).map((f) => (
                <Button key={f} variant="secondary" size="sm" onClick={() => window.open(`/print/${done.id}?format=${f}&auto=1`, '_blank', 'noopener')}><Printer className="h-3.5 w-3.5" />{f === 'A4' ? 'A4' : `${f}mm`}</Button>
              ))}
              <Button variant="secondary" size="sm" onClick={() => window.open(`/api/sales/${done.id}/invoice.pdf`, '_blank', 'noopener')}><FileDown className="h-3.5 w-3.5" />PDF</Button>
            </div>
            <Button size="lg" className="mt-5 w-full" onClick={() => { setDone(null); searchRef.current?.focus(); }} autoFocus>New sale</Button>
          </div>
        )}
      </Modal>

      <Modal open={!!savedOffline} onClose={() => setSavedOffline(null)} title="Saved on this device" footer={<Button onClick={() => setSavedOffline(null)}>OK</Button>}>
        <div className="flex gap-3 text-sm"><CloudOff className="h-6 w-6 shrink-0 text-amber-600" /><p>The sale is <b>pending</b>: it is stored on this device and will be sent when the connection returns. It has no invoice number until the server accepts it, and stock is re-checked then.</p></div>
      </Modal>
    </div>
  );
}

function PaymentModal({ open, total, onClose, onPay, hasCustomer, online }: { open: boolean; total: number; onClose: () => void; onPay: (p: Pay[]) => Promise<void>; hasCustomer: boolean; online: boolean }) {
  const [pays, setPays] = useState<Pay[]>([]);
  const [current, setCurrent] = useState<Method>('CASH');
  const [fresh, setFresh] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPays([{ method: 'CASH', amount: (total / 100).toFixed(2), reference: '' }]); setCurrent('CASH'); setFresh(true);
      // the search box behind the dialog must not swallow keypad typing
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [open, total]);

  const paidNonCash = pays.filter((p) => p.method !== 'CASH').reduce((a, p) => a + cents(toNum(p.amount)), 0);
  const cash = pays.filter((p) => p.method === 'CASH').reduce((a, p) => a + cents(toNum(p.amount)), 0);
  const cashDue = total - paidNonCash;
  const paidTotal = paidNonCash + cash;
  const change = cash - Math.max(0, cashDue);
  const remaining = Math.max(0, total - paidTotal);
  const short = remaining > 0;
  const overNonCash = paidNonCash > total;
  const needsCustomer = pays.some((p) => p.method === 'CREDIT' && toNum(p.amount) > 0) && !hasCustomer;
  const ok = !short && !overNonCash && !needsCustomer && pays.length > 0;
  const cur = pays.find((p) => p.method === current);

  const select = (m: Method) => {
    setCurrent(m);
    setFresh(true);
    if (pays.some((p) => p.method === m)) return;
    // the only line still holds the full amount: switch method instead of splitting
    if (pays.length === 1 && cents(toNum(pays[0].amount)) === total) { setPays([{ method: m, amount: (total / 100).toFixed(2), reference: '' }]); return; }
    setPays([...pays, { method: m, amount: (remaining / 100).toFixed(2), reference: '' }]);
  };
  const setAmount = (v: string) => setPays((ps) => ps.map((p) => (p.method === current ? { ...p, amount: v } : p)));
  const key = (k: string) => {
    const s = fresh ? '' : cur?.amount ?? '';
    setFresh(false);
    if (k === 'back') return setAmount(s.slice(0, -1));
    if (k === '.' && s.includes('.')) return;
    if (s.includes('.') && s.split('.')[1].length >= 2) return;
    setAmount(`${s}${k}`);
  };

  const submit = async () => {
    setBusy(true);
    try { await onPay(pays); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // typing in the dialog's own reference field is normal text input
      if (t?.tagName === 'INPUT' && t.closest('[role=dialog]')) return;
      if (/^[0-9.]$/.test(e.key)) { e.preventDefault(); key(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); key('back'); }
      else if (e.key === 'Enter' && ok && !busy) { e.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const quick = [...new Set([total / 100, Math.ceil(total / 50000) * 500, Math.ceil(total / 100000) * 1000, Math.ceil(total / 500000) * 5000])].filter((v) => v >= total / 100).slice(0, 4);

  return (
    <Modal open={open} onClose={onClose} title="Take payment" wide footer={
      <Button size="xl" variant="success" className="w-full" loading={busy} disabled={!ok} onClick={submit}>
        {!online ? 'Save offline (pending)' : short ? `Short by ${money(remaining / 100)}` : change > 0 ? `Complete sale · change ${money(change / 100)}` : 'Complete sale'}
      </Button>
    }>
      <div className="grid gap-5 md:grid-cols-[1fr_1.05fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-ink-900 p-4 text-white">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Amount due</p>
            <p className="text-3xl font-extrabold tracking-tight tabular-nums">{money(total / 100)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/5 px-3 py-2"><p className="text-[11px] text-slate-400">Received</p><p className="font-semibold tabular-nums">{money(paidTotal / 100)}</p></div>
              <div className={clsx('rounded-xl px-3 py-2', short ? 'bg-red-500/15' : 'bg-emerald-500/15')}>
                <p className={clsx('text-[11px]', short ? 'text-red-300' : 'text-emerald-300')}>{short ? 'Still to pay' : 'Change'}</p>
                <p className={clsx('font-bold tabular-nums', short ? 'text-red-200' : 'text-emerald-200')}>{money((short ? remaining : Math.max(0, change)) / 100)}</p>
              </div>
            </div>
          </div>
          <div>
            <p className="label">Payment method</p>
            <div className="grid grid-cols-5 gap-1.5">
              {METHODS.map(({ m, icon: Icon }) => {
                const used = pays.some((p) => p.method === m);
                return (
                  <button key={m} onClick={() => select(m)} className={clsx('flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[11px] font-semibold transition',
                    current === m ? 'border-brand-600 bg-brand-600 text-white shadow-sm' : used ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                    <Icon className="h-5 w-5" />{METHOD_LABEL[m].replace('Bank transfer', 'Bank')}
                  </button>
                );
              })}
            </div>
          </div>
          {pays.length > 1 && (
            <ul className="space-y-1.5 rounded-xl border border-slate-200 p-2 text-sm">
              {pays.map((p) => (
                <li key={p.method} className={clsx('flex items-center gap-2 rounded-lg px-2 py-1.5', p.method === current && 'bg-brand-50')}>
                  <button className="flex-1 text-left font-medium" onClick={() => { setCurrent(p.method); setFresh(true); }}>{METHOD_LABEL[p.method]}</button>
                  <span className="tabular-nums">{money(p.amount)}</span>
                  <button onClick={() => { setPays(pays.filter((x) => x.method !== p.method)); if (current === p.method) setCurrent(pays.find((x) => x.method !== p.method)?.method ?? 'CASH'); }} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${METHOD_LABEL[p.method]}`}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          {cur && cur.method !== 'CASH' && cur.method !== 'CREDIT' && (
            <Input label={`${METHOD_LABEL[cur.method]} reference (optional)`} placeholder="Approval code / transaction ID" value={cur.reference} onChange={(e) => setPays(pays.map((p) => (p.method === current ? { ...p, reference: e.target.value } : p)))} />
          )}
          {needsCustomer && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Add the customer's phone number to sell on account.</p>}
          {overNonCash && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">Card, QR, bank and account amounts are more than the total.</p>}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{current === 'CASH' ? 'Cash received' : `${METHOD_LABEL[current]} amount`}</p>
            <p className={clsx('text-right text-3xl font-bold tabular-nums', fresh ? 'text-slate-400' : 'text-slate-900')}>{money(cur?.amount ?? 0)}</p>
          </div>
          {current === 'CASH' && (
            <div className="grid grid-cols-4 gap-2">
              {quick.map((v) => (
                <button key={v} onClick={() => { setAmount(v.toFixed(2)); setFresh(true); }} className="h-10 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold tabular-nums text-emerald-800 transition hover:bg-emerald-100 active:scale-95">
                  {v === total / 100 ? 'Exact' : v.toLocaleString('en-LK')}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
              <button key={k} onClick={() => key(k)} className="grid h-12 place-items-center rounded-xl border border-slate-200 bg-white text-xl md:h-14 font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-95 active:bg-slate-100" aria-label={k === 'back' ? 'Backspace' : k}>
                {k === 'back' ? <Delete className="h-6 w-6" /> : k}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
