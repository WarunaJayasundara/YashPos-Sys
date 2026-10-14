import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, Plus, X } from 'lucide-react';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, daysAgo, money, today } from '../lib/format';
import type { Product } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea } from '../components/ui';
import { DataTable } from '../components/Table';
import { DateRange, type Range } from '../components/DateRange';
import { ProductPicker } from '../components/ProductPicker';
import { useToast } from '../components/toast';

const TYPES = ['OPENING', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'DAMAGED', 'LOST', 'ADJUSTMENT'];
const label = (t: string) => t.replace(/_/g, ' ').toLowerCase();

interface Move { id: number; productId: number; product: { name: string; sku: string }; type: string; qtyChange: number; qtyAfter: number; unitCost?: string; refType: string | null; refId: number | null; reason: string | null; user?: string; createdAt: string }
interface Adj { id: number; productId: number; product: { name: string; sku: string; qtyOnHand: number }; type: string; qtyChange: number; reason: string; status: string; createdAt: string }

export function AdjustmentForm({ productId, onDone }: { productId?: number; onDone: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState('DAMAGED');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const pid = productId ?? product?.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pid) return toast('Choose a product', 'error');
    const n = Math.abs(parseInt(qty, 10));
    if (!n) return toast('Enter a quantity', 'error');
    setBusy(true);
    try {
      const r = await api.post<{ status: string }>('/stock/adjustments', { productId: pid, type, qtyChange: type === 'ADJUSTMENT' && direction === 'in' ? n : -n, reason });
      toast(r.status === 'APPROVED' ? 'Stock updated' : 'Adjustment sent for approval');
      onDone();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!productId && (product ? <p className="text-sm">Product: <b>{product.name}</b> ({product.qtyOnHand} on hand) <button type="button" className="text-brand-700 underline" onClick={() => setProduct(null)}>change</button></p> : <ProductPicker onPick={setProduct} />)}
      <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="DAMAGED">Damaged (remove from stock)</option>
        <option value="LOST">Lost / missing (remove)</option>
        <option value="SUPPLIER_RETURN">Returned to supplier (remove)</option>
        <option value="ADJUSTMENT">Count correction (add or remove)</option>
      </Select>
      {type === 'ADJUSTMENT' && (
        <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
          <option value="out">Remove units (counted fewer)</option><option value="in">Add units (counted more)</option>
        </Select>
      )}
      <Input label="Quantity" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
      <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
      {!can('stock.approve') && <p className="text-xs text-amber-700">A manager must approve this before stock changes.</p>}
      <div className="flex justify-end"><Button type="submit" loading={busy}>Save adjustment</Button></div>
    </form>
  );
}

export default function StockPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'moves' | 'adj'>(can('stock.view') ? 'moves' : 'adj');
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() });
  const [type, setType] = useState('');
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjStatus, setAdjStatus] = useState('PENDING');
  const moves = useQuery({ queryKey: ['movements', range, type], queryFn: () => api.get<Move[]>(`/stock/movements${qs({ ...range, type, limit: 1000 })}`), enabled: tab === 'moves' && can('stock.view') });
  const adjs = useQuery({ queryKey: ['adjustments', adjStatus], queryFn: () => api.get<Adj[]>(`/stock/adjustments${qs({ status: adjStatus })}`), enabled: tab === 'adj' });

  const decide = async (id: number, approve: boolean) => {
    try {
      await api.post(`/stock/adjustments/${id}/decide`, { approve });
      toast(approve ? 'Approved and applied' : 'Rejected');
      qc.invalidateQueries({ queryKey: ['adjustments'] });
    } catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <div>
      <PageHeader title="Inventory and stock" subtitle="Every change to stock, with who did it and why" actions={can('stock.adjust') && <Button onClick={() => setAdjOpen(true)}><Plus className="h-4 w-4" />Stock adjustment</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('stock.view') ? [{ value: 'moves' as const, label: 'Movement history' }] : []), { value: 'adj' as const, label: 'Adjustments' }]} />
      {tab === 'moves' ? (
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <DateRange value={range} onChange={setRange} />
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
          </div>
          {moves.isLoading ? <Loading /> : moves.error ? <div className="p-3"><ErrorBox error={moves.error} /></div> : (
            <DataTable rows={moves.data!} rowKey={(m) => m.id} empty="No stock movements in this period" columns={[
              { key: 'p', header: 'Product', primary: true, render: (m) => <Link to={`/products/${m.productId}`} className="hover:underline">{m.product.name} <span className="text-xs text-slate-500">{m.product.sku}</span></Link> },
              { key: 'when', header: 'When', render: (m) => dateTime(m.createdAt) },
              { key: 't', header: 'Type', render: (m) => <Badge tone={m.qtyChange < 0 ? 'red' : 'green'}>{label(m.type)}</Badge> },
              { key: 'c', header: 'Change', num: true, render: (m) => <b>{m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}</b> },
              { key: 'a', header: 'Balance', num: true, render: (m) => m.qtyAfter },
              ...(can('products.view_cost') ? [{ key: 'uc', header: 'Unit cost', num: true, render: (m: Move) => money(m.unitCost) }] : []),
              { key: 'u', header: 'By', render: (m) => m.user ?? '-' },
              { key: 'r', header: 'Reference', render: (m) => <span className="text-xs">{m.refType === 'SALE' && m.refId ? <Link className="text-brand-700 underline" to={`/sales/${m.refId}`}>Sale #{m.refId}</Link> : m.refType ?? ''} {m.reason}</span> },
            ]} />
          )}
        </Card>
      ) : (
        <Card>
          <div className="border-b border-slate-100 p-3">
            <Select value={adjStatus} onChange={(e) => setAdjStatus(e.target.value)} aria-label="Status" wrapClass="max-w-xs"><option value="PENDING">Waiting for approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All</option></Select>
          </div>
          {adjs.isLoading ? <Loading /> : (
            <DataTable rows={adjs.data ?? []} rowKey={(a) => a.id} empty="No adjustments" columns={[
              { key: 'p', header: 'Product', primary: true, render: (a) => `${a.product.name} (${a.product.qtyOnHand} on hand)` },
              { key: 'w', header: 'Requested', render: (a) => dateTime(a.createdAt) },
              { key: 't', header: 'Type', render: (a) => label(a.type) },
              { key: 'q', header: 'Qty', num: true, render: (a) => a.qtyChange },
              { key: 'r', header: 'Reason', render: (a) => a.reason },
              { key: 's', header: 'Status', render: (a) => <Badge tone={a.status === 'APPROVED' ? 'green' : a.status === 'REJECTED' ? 'red' : 'amber'}>{a.status.toLowerCase()}</Badge> },
              ...(can('stock.approve') ? [{ key: 'x', header: '', render: (a: Adj) => a.status === 'PENDING' && (
                <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="success" onClick={() => decide(a.id, true)}><Check className="h-4 w-4" />Approve</Button>
                  <Button size="sm" variant="secondary" onClick={() => decide(a.id, false)}><X className="h-4 w-4" />Reject</Button>
                </span>
              ) }] : []),
            ]} />
          )}
        </Card>
      )}
      <Modal open={adjOpen} onClose={() => setAdjOpen(false)} title="Stock adjustment">
        <AdjustmentForm onDone={() => { setAdjOpen(false); qc.invalidateQueries({ queryKey: ['adjustments'] }); qc.invalidateQueries({ queryKey: ['movements'] }); }} />
      </Modal>
    </div>
  );
}
