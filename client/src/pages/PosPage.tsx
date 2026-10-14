import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, CreditCard, Minus, Plus, Printer, QrCode, Search, Trash2, User, Landmark, NotebookPen, CloudOff, X, FileDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getCatalog, queueSale, syncCatalog, type CatalogItem } from '../lib/offline';
import { money, toNum, uuid, METHOD_LABEL } from '../lib/format';
import type { Sale, Settings } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import { Badge, Button, Input, Modal } from '../components/ui';
import { useApproval } from '../components/Approval';
import { useToast } from '../components/toast';

interface Line { product: CatalogItem; qty: number; unitPrice: number; lineDiscount: number; serialNumber: string }
interface Pay { method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'QR' | 'CREDIT'; amount: string; reference: string }

const cents = (v: number) => Math.round(v * 100);
const METHODS: { m: Pay['method']; icon: typeof Banknote }[] = [
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
  return scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).slice(0, 40).map((x) => x.p);
}

export default function PosPage() {
  const { user, can } = useAuth();
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const { run, dialog } = useApproval();
  const searchRef = useRef<HTMLInputElement>(null);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [billDiscount, setBillDiscount] = useState('');
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [showCustomer, setShowCustomer] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const [savedOffline, setSavedOffline] = useState<string | null>(null);
  const requestId = useRef(uuid());

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 300_000 });
  const taxRate = toNum(settings.data?.taxRate);

  const loadCatalog = async (fromServer: boolean) => {
    if (fromServer) await syncCatalog().catch(() => undefined);
    setCatalog(await getCatalog());
  };
  useEffect(() => { loadCatalog(navigator.onLine); }, []);

  // a changed cart is a different sale: new idempotency key
  useEffect(() => { requestId.current = uuid(); }, [lines, billDiscount]);

  const results = useMemo(() => matchProducts(catalog, term), [catalog, term]);
  useEffect(() => setActive(0), [term]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) && lines.length) { e.preventDefault(); setPayOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length]);

  const inCart = (id: number) => lines.find((l) => l.product.id === id)?.qty ?? 0;

  const add = (p: CatalogItem) => {
    if (inCart(p.id) + 1 > p.qtyAvailable) {
      toast(`Only ${p.qtyAvailable} of ${p.name} in stock`, 'error');
      return;
    }
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { product: p, qty: 1, unitPrice: toNum(p.sellingPrice), lineDiscount: 0, serialNumber: '' }];
    });
    setTerm('');
    searchRef.current?.focus();
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
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Escape') setTerm('');
    else if (e.key === 'Enter') {
      e.preventDefault();
      const t = term.trim().toLowerCase();
      // scanners type the code and press Enter: exact barcode/SKU wins
      const exact = catalog.find((p) => p.barcode?.toLowerCase() === t || p.sku.toLowerCase() === t);
      const pick = exact ?? results[active];
      if (pick) add(pick);
      else if (t) toast(`No product matches "${term}"`, 'error');
    }
  };

  // totals preview; the server recalculates authoritatively
  const subtotal = lines.reduce((a, l) => a + cents(l.unitPrice) * l.qty, 0);
  const lineDisc = lines.reduce((a, l) => a + cents(l.lineDiscount), 0);
  const listTotal = lines.reduce((a, l) => a + cents(toNum(l.product.sellingPrice)) * l.qty, 0);
  const bill = cents(toNum(billDiscount));
  const net = Math.max(0, subtotal - lineDisc - bill);
  const tax = Math.round((net * taxRate) / 100);
  const total = net + tax;
  const discountPct = listTotal ? ((listTotal - net) * 100) / listTotal : 0;
  const overLimit = discountPct > (user?.maxDiscountPercent ?? 0) + 1e-9 && !can('discounts.override');
  const belowMin = lines.some((l) => cents(l.unitPrice) * l.qty - cents(l.lineDiscount) < cents(toNum(l.product.minSellingPrice)) * l.qty);

  const reset = () => {
    setLines([]); setBillDiscount(''); setCustomer({ name: '', phone: '' }); setShowCustomer(false);
    requestId.current = uuid();
    searchRef.current?.focus();
  };

  const buildPayload = (pays: Pay[]) => ({
    clientRequestId: requestId.current,
    items: lines.map((l) => ({ productId: l.product.id, qty: l.qty, unitPrice: l.unitPrice, lineDiscount: l.lineDiscount, serialNumber: l.serialNumber || undefined })),
    billDiscount: toNum(billDiscount),
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

  return (
    <div className="-mx-3 -my-4 flex min-h-[calc(100vh-7rem)] flex-col lg:-mx-8 lg:flex-row sm:-mx-5">
      {dialog}
      {/* product search */}
      <section className="flex min-w-0 flex-1 flex-col border-slate-200 bg-white lg:border-r">
        <div className="sticky top-[52px] z-10 border-b border-slate-100 bg-white p-3 lg:top-0">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onSearchKey}
              className="input h-12 pl-10 text-base"
              placeholder="Scan barcode or search name, SKU, brand, model (F2)"
              aria-label="Search products"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          {!online && <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-700"><CloudOff className="h-4 w-4" />Offline: showing cached products; stock shown may be out of date.</p>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {term ? (
            results.length ? (
              <ul role="listbox" aria-label="Search results" className="divide-y divide-slate-100">
                {results.map((p, i) => {
                  const left = p.qtyAvailable - inCart(p.id);
                  return (
                    <li key={p.id} role="option" aria-selected={i === active}>
                      <button
                        onClick={() => add(p)}
                        onMouseEnter={() => setActive(i)}
                        disabled={left <= 0}
                        className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50', i === active && 'bg-brand-50')}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-900">{p.name}</p>
                          <p className="truncate text-xs text-slate-500">{p.sku}{p.brand ? ` · ${p.brand}` : ''}{p.compatibility ? ` · ${p.compatibility}` : ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{money(p.sellingPrice)}</p>
                          <Badge tone={left <= 0 ? 'red' : left <= 3 ? 'amber' : 'green'}>{left <= 0 ? 'Out of stock' : `${left} in stock`}</Badge>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="p-8 text-center text-sm text-slate-500">No products match "{term}".</p>
          ) : (
            <div className="p-6 text-center text-sm text-slate-500">
              <p>Scan a barcode or type to search. {catalog.length} active products loaded.</p>
              <p className="mt-2 hidden text-xs lg:block">Keys: <kbd className="rounded border px-1">F2</kbd> search · <kbd className="rounded border px-1">↑ ↓</kbd> choose · <kbd className="rounded border px-1">Enter</kbd> add · <kbd className="rounded border px-1">F9</kbd> pay</p>
            </div>
          )}
        </div>
      </section>

      {/* cart */}
      <section className="flex w-full flex-col bg-slate-50 lg:w-[440px] xl:w-[500px]">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="font-semibold">Current bill <span className="text-sm font-normal text-slate-500">({lines.reduce((a, l) => a + l.qty, 0)} items)</span></h2>
          {lines.length > 0 && <Button size="sm" variant="ghost" onClick={() => window.confirm('Clear the bill?') && reset()}><X className="h-4 w-4" />Clear</Button>}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {!lines.length && <p className="p-8 text-center text-sm text-slate-500">The bill is empty.</p>}
          {lines.map((l) => {
            const lineTotal = cents(l.unitPrice) * l.qty - cents(l.lineDiscount);
            const below = lineTotal < cents(toNum(l.product.minSellingPrice)) * l.qty;
            return (
              <div key={l.product.id} className="card p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{l.product.name}</p>
                    <p className="text-xs text-slate-500">{l.product.sku} · {l.product.qtyAvailable} in stock</p>
                  </div>
                  <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setQty(l.product.id, 0)} aria-label={`Remove ${l.product.name}`}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="flex items-center rounded-lg border border-slate-300 bg-white">
                    <button className="p-2" onClick={() => setQty(l.product.id, l.qty - 1)} aria-label="Decrease quantity"><Minus className="h-4 w-4" /></button>
                    <input aria-label="Quantity" inputMode="numeric" className="w-12 border-x border-slate-200 py-1.5 text-center text-sm tabular-nums" value={l.qty}
                      onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) setQty(l.product.id, v); }} />
                    <button className="p-2" onClick={() => setQty(l.product.id, l.qty + 1)} aria-label="Increase quantity"><Plus className="h-4 w-4" /></button>
                  </div>
                  <label className="flex-1 text-xs text-slate-500">Unit price
                    <input type="number" min={0} step="0.01" className={clsx('input py-1.5 text-right tabular-nums', below && 'input-error')} value={l.unitPrice}
                      onChange={(e) => patch(l.product.id, { unitPrice: Math.max(0, toNum(e.target.value)) })} />
                  </label>
                  <label className="w-24 text-xs text-slate-500">Discount
                    <input type="number" min={0} step="0.01" className="input py-1.5 text-right tabular-nums" value={l.lineDiscount || ''} placeholder="0"
                      onChange={(e) => patch(l.product.id, { lineDiscount: Math.max(0, toNum(e.target.value)) })} />
                  </label>
                  <p className="w-full text-right text-sm font-semibold tabular-nums sm:w-auto sm:min-w-24">{money(lineTotal / 100)}</p>
                </div>
                {below && <p className="mt-1 text-xs text-red-600">Below minimum price {money(l.product.minSellingPrice)}: needs supervisor approval</p>}
                {l.product.warrantyMonths > 0 && (
                  <input className="input mt-2 py-1.5 text-xs" placeholder={`Serial / IMEI (warranty ${l.product.warrantyMonths} months)`} value={l.serialNumber}
                    onChange={(e) => patch(l.product.id, { serialNumber: e.target.value })} aria-label="Serial number" />
                )}
              </div>
            );
          })}
        </div>

        <div className="sticky bottom-[60px] border-t border-slate-200 bg-white p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] lg:bottom-0">
          <button className="mb-2 flex items-center gap-1 text-sm text-brand-700" onClick={() => setShowCustomer((s) => !s)}>
            <User className="h-4 w-4" />{customer.phone || customer.name ? `${customer.name || 'Customer'} ${customer.phone}` : 'Add customer (optional)'}
          </button>
          {showCustomer && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} aria-label="Customer name" />
              <Input placeholder="Phone" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} aria-label="Customer phone" />
            </div>
          )}
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{money((subtotal - lineDisc) / 100)}</dd></div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500">Bill discount</dt>
              <dd><input type="number" min={0} step="0.01" className="input w-28 py-1 text-right tabular-nums" placeholder="0.00" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} aria-label="Bill discount" /></dd>
            </div>
            {tax > 0 && <div className="flex justify-between"><dt className="text-slate-500">{settings.data?.taxLabel} ({taxRate}%)</dt><dd className="tabular-nums">{money(tax / 100)}</dd></div>}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{money(total / 100)}</dd></div>
          </dl>
          {(overLimit || belowMin) && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{overLimit ? `Discount ${discountPct.toFixed(1)}% is above your ${user?.maxDiscountPercent}% limit. ` : ''}A supervisor will be asked to approve.</p>}
          <Button size="lg" className="mt-3 w-full" disabled={!lines.length || bill > subtotal - lineDisc} onClick={() => setPayOpen(true)}>
            Pay {money(total / 100)} <span className="hidden text-xs opacity-70 lg:inline">(F9)</span>
          </Button>
        </div>
      </section>

      <PaymentModal open={payOpen} total={total} onClose={() => setPayOpen(false)} onPay={checkout} hasCustomer={!!customer.phone} online={online} />

      <Modal open={!!done} onClose={() => setDone(null)} title="Sale completed" footer={<Button onClick={() => { setDone(null); searchRef.current?.focus(); }}>New sale</Button>}>
        {done && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-6 w-6" /><span className="text-base font-semibold">{done.invoiceNumber}</span></div>
            <p>Total <b>{money(done.total)}</b>{toNum(done.changeDue) > 0 && <> · Change due <b className="text-lg">{money(done.changeDue)}</b></>}</p>
            <p className="text-xs text-slate-500">The receipt opened in a new tab. If it was blocked, print here:</p>
            <div className="flex flex-wrap gap-2">
              {(['80', '58', 'A4'] as const).map((f) => (
                <Button key={f} variant="secondary" size="sm" onClick={() => window.open(`/print/${done.id}?format=${f}&auto=1`, '_blank', 'noopener')}><Printer className="h-4 w-4" />{f === 'A4' ? 'A4' : `${f} mm`}</Button>
              ))}
              <Button variant="secondary" size="sm" onClick={() => window.open(`/api/sales/${done.id}/invoice.pdf`, '_blank', 'noopener')}><FileDown className="h-4 w-4" />PDF</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!savedOffline} onClose={() => setSavedOffline(null)} title="Saved on this device" footer={<Button onClick={() => setSavedOffline(null)}>OK</Button>}>
        <p className="text-sm">The sale is <b>pending</b>: it is stored on this device and will be sent to the server when the connection returns. It is not a completed sale and has no invoice number until the server accepts it. Stock is re-checked then.</p>
      </Modal>
    </div>
  );
}

function PaymentModal({ open, total, onClose, onPay, hasCustomer, online }: { open: boolean; total: number; onClose: () => void; onPay: (p: Pay[]) => Promise<void>; hasCustomer: boolean; online: boolean }) {
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState(false);
  const cashRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPays([{ method: 'CASH', amount: (total / 100).toFixed(2), reference: '' }]);
      setTimeout(() => cashRef.current?.select(), 50);
    }
  }, [open, total]);

  const paidNonCash = pays.filter((p) => p.method !== 'CASH').reduce((a, p) => a + cents(toNum(p.amount)), 0);
  const cash = pays.filter((p) => p.method === 'CASH').reduce((a, p) => a + cents(toNum(p.amount)), 0);
  const cashDue = total - paidNonCash;
  const change = cash - Math.max(0, cashDue);
  const short = cashDue > 0 && cash < cashDue;
  const overNonCash = paidNonCash > total;
  const needsCustomer = pays.some((p) => p.method === 'CREDIT' && toNum(p.amount) > 0) && !hasCustomer;

  const addMethod = (m: Pay['method']) => {
    if (pays.some((p) => p.method === m)) return;
    const remaining = Math.max(0, total - pays.reduce((a, p) => a + cents(toNum(p.amount)), 0));
    if (pays.length === 1 && pays[0].method === 'CASH' && cents(toNum(pays[0].amount)) === total) {
      setPays([{ method: m, amount: (total / 100).toFixed(2), reference: '' }]);
      return;
    }
    setPays([...pays, { method: m, amount: (remaining / 100).toFixed(2), reference: '' }]);
  };

  const submit = async () => {
    setBusy(true);
    try { await onPay(pays); } finally { setBusy(false); }
  };

  const quick = [total / 100, Math.ceil(total / 50000) * 500, Math.ceil(total / 100000) * 1000, Math.ceil(total / 500000) * 5000].filter((v, i, a) => a.indexOf(v) === i && v >= total / 100);

  return (
    <Modal open={open} onClose={onClose} title={`Payment - ${money(total / 100)}`} footer={<>
      <Button variant="secondary" onClick={onClose}>Back</Button>
      <Button size="lg" variant="success" loading={busy} disabled={short || overNonCash || needsCustomer || !pays.length} onClick={submit}>
        {online ? 'Complete sale' : 'Save offline (pending)'}
      </Button>
    </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-5 gap-1.5">
          {METHODS.map(({ m, icon: Icon }) => (
            <button key={m} onClick={() => addMethod(m)} className={clsx('flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium', pays.some((p) => p.method === m) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
              <Icon className="h-5 w-5" />{METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {pays.map((p, i) => (
          <div key={p.method} className="flex flex-wrap items-end gap-2">
            <Input ref={p.method === 'CASH' ? cashRef : undefined} wrapClass="flex-1 min-w-32" label={p.method === 'CASH' ? 'Cash received' : METHOD_LABEL[p.method]} type="number" min={0} step="0.01" inputMode="decimal" value={p.amount}
              onChange={(e) => setPays(pays.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
              onKeyDown={(e) => e.key === 'Enter' && !short && !overNonCash && !needsCustomer && submit()} />
            {p.method !== 'CASH' && p.method !== 'CREDIT' && (
              <Input wrapClass="flex-1 min-w-32" label="Reference (optional)" value={p.reference} onChange={(e) => setPays(pays.map((x, k) => (k === i ? { ...x, reference: e.target.value } : x)))} />
            )}
            {pays.length > 1 && <Button variant="ghost" onClick={() => setPays(pays.filter((_, k) => k !== i))} aria-label={`Remove ${METHOD_LABEL[p.method]}`}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}
        {pays.some((p) => p.method === 'CASH') && (
          <div className="flex flex-wrap gap-2">
            {quick.map((v) => (
              <Button key={v} size="sm" variant="secondary" onClick={() => setPays(pays.map((p) => (p.method === 'CASH' ? { ...p, amount: (v - paidNonCash / 100).toFixed(2) } : p)))}>{money(v)}</Button>
            ))}
          </div>
        )}
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          {short && <p className="font-semibold text-red-700">Short by {money((cashDue - cash) / 100)}</p>}
          {overNonCash && <p className="font-semibold text-red-700">Card / QR / transfer / credit amounts exceed the total</p>}
          {needsCustomer && <p className="font-semibold text-red-700">Add the customer's phone number to sell on account</p>}
          {!short && !overNonCash && <p className="flex items-baseline justify-between"><span>Change due</span><span className="text-2xl font-bold tabular-nums text-emerald-700">{money(Math.max(0, change) / 100)}</span></p>}
        </div>
      </div>
    </Modal>
  );
}
