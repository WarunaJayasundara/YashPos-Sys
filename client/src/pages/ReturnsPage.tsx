import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api, ApiError, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, dateTime, daysAgo, METHOD_LABEL, money, today, toNum } from '../lib/format';
import type { Sale } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea } from '../components/ui';
import { DataTable } from '../components/Table';
import { DateRange, type Range } from '../components/DateRange';
import { useApproval } from '../components/Approval';
import { useToast } from '../components/toast';

export default function ReturnsPage() {
  const { can } = useAuth();
  const tabs = [
    ...(can('returns.create', 'returns.approve') ? [{ value: 'new' as const, label: 'New return / exchange' }] : []),
    ...(can('returns.create', 'returns.approve', 'reports.sales') ? [{ value: 'list' as const, label: 'Returns history' }] : []),
    ...(can('warranty.manage', 'sales.view_all') ? [{ value: 'warranty' as const, label: 'Warranty' }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.value ?? 'warranty');
  return (
    <div>
      <PageHeader title="Returns and warranty" />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'new' && <NewReturn />}
      {tab === 'list' && <ReturnList />}
      {tab === 'warranty' && <Warranties />}
    </div>
  );
}

function NewReturn() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { run, dialog } = useApproval();
  const [invoice, setInvoice] = useState(sp.get('invoice') ?? '');
  const [sale, setSale] = useState<Sale | null>(null);
  const [error, setError] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState('');
  const [type, setType] = useState<'REFUND' | 'EXCHANGE'>('REFUND');
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState(false);

  const lookup = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(''); setSale(null);
    try {
      const s = await api.get<Sale>(`/returns/lookup${qs({ invoice: invoice.trim() })}`);
      setSale(s);
      setQty({}); setRestock(Object.fromEntries(s.items.map((i) => [i.id, true])));
    } catch (err) { setError(errorText(err)); }
  };
  useEffect(() => { if (sp.get('invoice')) lookup(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const lines = sale?.items.filter((i) => toNum(qty[i.id]) > 0) ?? [];
  const estimate = lines.reduce((a, i) => a + ((toNum(i.lineTotal) - toNum(i.allocatedBillDiscount)) / i.qty) * toNum(qty[i.id]), 0) * (1 + toNum(sale?.taxRate) / 100);

  const submit = async () => {
    if (!sale || !lines.length) return toast('Choose items and quantities to return', 'error');
    if (reason.trim().length < 3) return toast('Enter a reason', 'error');
    setBusy(true);
    try {
      const r = await run((approval) => api.post<{ returnNumber: string; refundTotal: string }>('/returns', {
        saleId: sale.id, reason, type, refundMethod: method, approval,
        items: lines.map((i) => ({ saleItemId: i.id, qty: parseInt(qty[i.id], 10), restock: restock[i.id] })),
      }));
      toast(`${r.returnNumber}: refund ${money(r.refundTotal)}`);
      qc.invalidateQueries();
      if (type === 'EXCHANGE') nav('/pos'); else lookup();
      setReason('');
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'APPROVAL_CANCELLED')) toast(errorText(e), 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {dialog}
      <Card>
        <form onSubmit={lookup} className="flex flex-wrap items-end gap-2 p-4">
          <Input label="Original invoice number" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="YM-2026-000123" wrapClass="flex-1 min-w-48" autoFocus />
          <Button type="submit"><Search className="h-4 w-4" />Find sale</Button>
        </form>
        {error && <p className="px-4 pb-4 text-sm text-red-700">{error}</p>}
      </Card>
      {sale && (
        <Card title={<>{sale.invoiceNumber} · {dateTime(sale.createdAt)} · {money(sale.total)}</>}>
          {['VOIDED', 'RETURNED'].includes(sale.status) ? <p className="p-4 text-sm text-red-700">This sale is {sale.status.toLowerCase()}; nothing more can be returned.</p> : (
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                {sale.items.map((i) => {
                  const left = i.qty - i.qtyReturned;
                  return (
                    <div key={i.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="min-w-40 flex-1"><p className="font-medium">{i.productName}</p><p className="text-xs text-slate-500">Sold {i.qty} at {money(i.unitPrice)}{i.qtyReturned ? ` · ${i.qtyReturned} already returned` : ''}</p></div>
                      <Input aria-label={`Return quantity for ${i.productName}`} type="number" min={0} max={left} value={qty[i.id] ?? ''} placeholder={`0-${left}`} disabled={!left} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} wrapClass="w-24" />
                      <label className="flex items-center gap-2"><input type="checkbox" checked={restock[i.id]} onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} />Resaleable (back to stock)</label>
                    </div>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select label="Type" value={type} onChange={(e) => setType(e.target.value as 'REFUND' | 'EXCHANGE')}><option value="REFUND">Refund</option><option value="EXCHANGE">Exchange (then sell the replacement)</option></Select>
                <Select label="Refund method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {['CASH', 'CARD', 'BANK_TRANSFER', 'QR', ...(sale.customerId ? ['CREDIT'] : [])].map((m) => <option key={m} value={m}>{m === 'CREDIT' ? 'Credit to customer account' : METHOD_LABEL[m]}</option>)}
                </Select>
                <Textarea label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <p className="text-sm">Estimated refund <b className="text-lg">{money(estimate)}</b> <span className="text-xs text-slate-500">(net price paid incl. bill discount; the server calculates the exact amount)</span></p>
                <Button loading={busy} onClick={submit} disabled={!lines.length}>Process return</Button>
              </div>
              <p className="text-xs text-slate-500">The original invoice is kept unchanged. Items not marked resaleable are recorded as damaged and written off.</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface Ret { id: number; returnNumber: string; createdAt: string; reason: string; type: string; refundTotal: string; sale: { invoiceNumber: string }; saleId: number; refunds: { method: string; amount: string }[]; items: { qty: number; restock: boolean; saleItem: { productName: string } }[] }

function ReturnList() {
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: today() });
  const q = useQuery({ queryKey: ['returns', range], queryFn: () => api.get<Ret[]>(`/returns${qs(range)}`) });
  return (
    <Card>
      <div className="border-b border-slate-100 p-3"><DateRange value={range} onChange={setRange} /></div>
      {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
        <DataTable rows={q.data!} rowKey={(r) => r.id} empty="No returns in this period" columns={[
          { key: 'n', header: 'Return', primary: true, render: (r) => <span className="font-medium">{r.returnNumber}</span> },
          { key: 'd', header: 'When', render: (r) => dateTime(r.createdAt) },
          { key: 's', header: 'Sale', render: (r) => <Link className="link" to={`/sales/${r.saleId}`}>{r.sale.invoiceNumber}</Link> },
          { key: 'i', header: 'Items', render: (r) => r.items.map((i) => `${i.qty} x ${i.saleItem.productName}${i.restock ? '' : ' (damaged)'}`).join(', ') },
          { key: 'r', header: 'Reason', render: (r) => r.reason, hideMobile: true },
          { key: 't', header: 'Type', render: (r) => r.type.toLowerCase() },
          { key: 'a', header: 'Refund', num: true, render: (r) => <>{money(r.refundTotal)} <span className="text-xs text-slate-500">{r.refunds.map((f) => METHOD_LABEL[f.method]).join(', ')}</span></> },
        ]} />
      )}
    </Card>
  );
}

interface W { id: number; saleId: number; serialNumber: string | null; startsAt: string; expiresAt: string; isActive: boolean; claimStatus: string; claimNotes: string | null; resolution: string | null; product: { name: string; sku: string }; sale: { invoiceNumber: string; customerName: string | null; customerPhone: string | null } }
const CLAIM = ['NONE', 'OPEN', 'IN_REPAIR', 'REPLACED', 'REJECTED', 'CLOSED'];

function Warranties() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<W | null>(null);
  const q = useQuery({ queryKey: ['warranties', term, status], queryFn: () => api.get<W[]>(`/warranties${qs({ q: term, status })}`) });
  const save = async () => {
    if (!edit) return;
    try {
      await api.put(`/warranties/${edit.id}`, { claimStatus: edit.claimStatus, claimNotes: edit.claimNotes ?? '', resolution: edit.resolution ?? '', serialNumber: edit.serialNumber ?? '' });
      toast('Warranty updated');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['warranties'] });
    } catch (e) { toast(errorText(e), 'error'); }
  };
  return (
    <Card>
      <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-3">
        <Input placeholder="Invoice, serial or customer phone" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search warranty" wrapClass="sm:col-span-2" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Claim status"><option value="">All</option><option value="ACTIVE">Still under warranty</option>{CLAIM.slice(1).map((c) => <option key={c} value={c}>Claim: {c.replace('_', ' ').toLowerCase()}</option>)}</Select>
      </div>
      {q.isLoading ? <Loading /> : (
        <DataTable rows={q.data ?? []} rowKey={(w) => w.id} onRowClick={can('warranty.manage') ? setEdit : undefined} empty="No warranty records" columns={[
          { key: 'p', header: 'Product', primary: true, render: (w) => <span>{w.product.name}{w.serialNumber && <span className="text-xs text-slate-500"> · S/N {w.serialNumber}</span>}</span> },
          { key: 'i', header: 'Invoice', render: (w) => w.sale.invoiceNumber },
          { key: 'c', header: 'Customer', render: (w) => [w.sale.customerName, w.sale.customerPhone].filter(Boolean).join(' ') || '-' },
          { key: 'd', header: 'Purchased', render: (w) => dateOnly(w.startsAt) },
          { key: 'e', header: 'Expires', render: (w) => <Badge tone={w.isActive ? 'green' : 'gray'}>{dateOnly(w.expiresAt)}</Badge> },
          { key: 's', header: 'Claim', render: (w) => (w.claimStatus === 'NONE' ? '-' : <Badge tone="amber">{w.claimStatus.replace('_', ' ').toLowerCase()}</Badge>) },
        ]} />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Warranty claim" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {edit && <div className="space-y-3 text-sm">
          <p><b>{edit.product.name}</b> · {edit.sale.invoiceNumber} · expires {dateOnly(edit.expiresAt)} {!edit.isActive && <Badge tone="red">Expired</Badge>}</p>
          <Input label="Serial number" value={edit.serialNumber ?? ''} onChange={(e) => setEdit({ ...edit, serialNumber: e.target.value })} />
          <Select label="Claim status" value={edit.claimStatus} onChange={(e) => setEdit({ ...edit, claimStatus: e.target.value })}>{CLAIM.map((c) => <option key={c} value={c}>{c.replace('_', ' ').toLowerCase()}</option>)}</Select>
          <Textarea label="Claim notes" value={edit.claimNotes ?? ''} onChange={(e) => setEdit({ ...edit, claimNotes: e.target.value })} />
          <Textarea label="Resolution" value={edit.resolution ?? ''} onChange={(e) => setEdit({ ...edit, resolution: e.target.value })} />
        </div>}
      </Modal>
    </Card>
  );
}
