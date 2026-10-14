import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, money, today, toNum } from '../lib/format';
import type { Named, Product } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Select, Textarea, type Tone } from '../components/ui';
import { DataTable } from '../components/Table';
import { ProductPicker } from '../components/ProductPicker';
import { useToast } from '../components/toast';

export const PO_STATUS: Record<string, { tone: Tone; label: string }> = {
  DRAFT: { tone: 'gray', label: 'Draft' }, ORDERED: { tone: 'blue', label: 'Ordered' }, PARTIALLY_RECEIVED: { tone: 'amber', label: 'Part received' },
  RECEIVED: { tone: 'green', label: 'Received' }, CANCELLED: { tone: 'red', label: 'Cancelled' },
};

interface Row { id: number; poNumber: string; purchaseDate: string; status: string; supplierInvoiceNo: string | null; invoiceTotal: string; amountPaid: string; balance: string; supplier: { name: string }; _count: { items: number } }

export default function PurchasesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Named[]>('/suppliers') });
  const q = useQuery({ queryKey: ['purchases', status, supplierId, search], queryFn: () => api.get<Row[]>(`/purchases${qs({ status, supplierId, q: search })}`) });

  return (
    <div>
      <PageHeader title="Purchases" subtitle="Purchase orders, goods received and supplier invoices" actions={can('purchases.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New purchase</Button>} />
      <Card>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-3">
          <Input placeholder="PO or supplier invoice number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search purchases" />
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier"><option value="">All suppliers</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <DataTable rows={q.data!} rowKey={(r) => r.id} onRowClick={(r) => nav(`/purchases/${r.id}`)} empty="No purchases yet" columns={[
            { key: 'po', header: 'PO', primary: true, render: (r) => <span className="font-medium">{r.poNumber}</span> },
            { key: 'd', header: 'Date', render: (r) => dateOnly(r.purchaseDate) },
            { key: 's', header: 'Supplier', render: (r) => r.supplier.name },
            { key: 'inv', header: 'Supplier invoice', render: (r) => r.supplierInvoiceNo ?? '-', hideMobile: true },
            { key: 'st', header: 'Status', render: (r) => <Badge tone={PO_STATUS[r.status].tone}>{PO_STATUS[r.status].label}</Badge> },
            { key: 't', header: 'Invoice total', num: true, render: (r) => money(r.invoiceTotal) },
            { key: 'b', header: 'Balance', num: true, render: (r) => <span className={toNum(r.balance) > 0 ? 'font-semibold text-red-700' : ''}>{money(r.balance)}</span> },
          ]} />
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase" wide>
        <PurchaseForm onDone={(id) => { setCreating(false); nav(`/purchases/${id}`); }} onCancel={() => setCreating(false)} />
      </Modal>
    </div>
  );
}

function PurchaseForm({ onDone, onCancel }: { onDone: (id: number) => void; onCancel: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Named[]>('/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [invoiceTotal, setInvoiceTotal] = useState('');
  const [items, setItems] = useState<{ p: Product; qty: string; cost: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const computed = items.reduce((a, i) => a + toNum(i.qty) * toNum(i.cost), 0);

  const save = async (status: 'DRAFT' | 'ORDERED') => {
    if (!supplierId) return toast('Choose a supplier', 'error');
    if (!items.length) return toast('Add at least one product', 'error');
    setBusy(true);
    try {
      const po = await api.post<{ id: number }>('/purchases', {
        supplierId: Number(supplierId), supplierInvoiceNo: invoiceNo || undefined, purchaseDate: date, notes: notes || undefined, status,
        invoiceTotal: invoiceTotal ? toNum(invoiceTotal) : undefined,
        items: items.map((i) => ({ productId: i.p.id, qtyOrdered: parseInt(i.qty, 10), unitCost: toNum(i.cost) })),
      });
      toast('Purchase saved. Stock changes only when goods are received.');
      qc.invalidateQueries({ queryKey: ['purchases'] });
      onDone(po.id);
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Supplier *" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Choose...</option>{suppliers.data?.filter((s) => s.isActive !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Input label="Supplier invoice no." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
        <Input label="Purchase date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <ProductPicker label="Add product" onPick={(p) => setItems([...items, { p, qty: '1', cost: String(toNum(p.purchasePrice) || '') }])} exclude={items.map((i) => i.p.id)} />
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th w-24">Qty</th><th className="th w-32">Unit cost</th><th className="th text-right">Line</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i, k) => (
                <tr key={i.p.id}>
                  <td className="td">{i.p.name}<div className="text-xs text-slate-500">{i.p.sku}</div></td>
                  <td className="td"><input aria-label="Quantity" className="input py-1" type="number" min={1} value={i.qty} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td className="td"><input aria-label="Unit cost" className="input py-1" type="number" min={0} step="0.01" value={i.cost} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, cost: e.target.value } : x)))} /></td>
                  <td className="td num">{money(toNum(i.qty) * toNum(i.cost))}</td>
                  <td className="td"><button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Supplier invoice total" type="number" min={0} step="0.01" value={invoiceTotal} onChange={(e) => setInvoiceTotal(e.target.value)} placeholder={computed.toFixed(2)} hint={`Leave empty to use the item total ${money(computed)}. Enter the supplier's figure if it includes extra charges.`} />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={() => save('DRAFT')}>Save as draft</Button>
        <Button loading={busy} onClick={() => save('ORDERED')}>Save as ordered</Button>
      </div>
    </div>
  );
}
