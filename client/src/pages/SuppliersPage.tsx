import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, METHOD_LABEL, money, toNum } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Textarea } from '../components/ui';
import { DataTable } from '../components/Table';
import { useToast } from '../components/toast';
import { PO_STATUS } from './PurchasesPage';

interface Supplier { id: number; name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; businessRegNo: string | null; notes: string | null; isActive: boolean; invoiced: number; paid: number; balance: number }
interface Detail extends Supplier {
  purchases: { id: number; poNumber: string; purchaseDate: string; status: string; invoiceTotal: string; amountPaid: string }[];
  payments: { id: number; amount: string; method: string; paidAt: string; reference: string | null }[];
  priceHistory: { productId: number; name: string; sku: string; unitCost: string; purchaseDate: string; poNumber: string }[];
}

export default function SuppliersPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Supplier[]>('/suppliers') });
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [view, setView] = useState<number | null>(null);
  return (
    <div>
      <PageHeader title="Suppliers" actions={can('suppliers.manage') && <Button onClick={() => setEdit({ isActive: true })}><Plus className="h-4 w-4" />New supplier</Button>} />
      <Card>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <DataTable rows={q.data!} rowKey={(s) => s.id} onRowClick={(s) => setView(s.id)} empty="No suppliers yet" columns={[
            { key: 'n', header: 'Supplier', primary: true, render: (s) => <span className="font-medium">{s.name} {!s.isActive && <Badge>Inactive</Badge>}</span> },
            { key: 'c', header: 'Contact', render: (s) => [s.contactPerson, s.phone].filter(Boolean).join(' · ') || '-' },
            { key: 'i', header: 'Invoiced', num: true, render: (s) => money(s.invoiced) },
            { key: 'p', header: 'Paid', num: true, render: (s) => money(s.paid) },
            { key: 'b', header: 'Outstanding', num: true, render: (s) => <span className={s.balance > 0 ? 'font-semibold text-red-700' : ''}>{money(s.balance)}</span> },
          ]} />
        )}
      </Card>
      {edit && <SupplierForm supplier={edit} onClose={() => setEdit(null)} />}
      {view && <SupplierDetail id={view} onClose={() => setView(null)} onEdit={(s) => { setView(null); setEdit(s); }} />}
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier: Partial<Supplier>; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState(supplier);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Supplier) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = { name: f.name, contactPerson: f.contactPerson || null, phone: f.phone || null, email: f.email || null, address: f.address || null, businessRegNo: f.businessRegNo || null, notes: f.notes || null, isActive: f.isActive };
    try {
      if (f.id) await api.put(`/suppliers/${f.id}`, body); else await api.post('/suppliers', body);
      toast('Supplier saved');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit supplier' : 'New supplier'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="sup-form" loading={busy}>Save</Button></>}>
      <form id="sup-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Input label="Name *" value={f.name ?? ''} onChange={set('name')} required wrapClass="sm:col-span-2" />
        <Input label="Contact person" value={f.contactPerson ?? ''} onChange={set('contactPerson')} />
        <Input label="Phone" value={f.phone ?? ''} onChange={set('phone')} inputMode="tel" />
        <Input label="Email" type="email" value={f.email ?? ''} onChange={set('email')} />
        <Input label="Business reg. no." value={f.businessRegNo ?? ''} onChange={set('businessRegNo')} />
        <Input label="Address" value={f.address ?? ''} onChange={set('address')} wrapClass="sm:col-span-2" />
        <Textarea label="Notes" value={f.notes ?? ''} onChange={set('notes')} wrapClass="sm:col-span-2" />
        {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Active</label>}
      </form>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (s: Supplier) => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['supplier', id], queryFn: () => api.get<Detail>(`/suppliers/${id}`) });
  const s = q.data;
  return (
    <Modal open onClose={onClose} title={s?.name ?? 'Supplier'} wide footer={can('suppliers.manage') && s && <Button variant="secondary" onClick={() => onEdit(s)}><Pencil className="h-4 w-4" />Edit</Button>}>
      {!s ? <Loading /> : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">{[s.contactPerson, s.phone, s.email, s.address].filter(Boolean).join(' · ')}</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Invoiced</p><p className="font-bold">{money(s.invoiced)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Paid</p><p className="font-bold">{money(s.paid)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Outstanding</p><p className="font-bold text-red-700">{money(s.balance)}</p></div>
          </div>
          <div><p className="label">Purchases</p>
            <ul className="divide-y divide-slate-100 rounded-lg border">{s.purchases.length ? s.purchases.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><Link className="link" to={`/purchases/${p.id}`}>{p.poNumber}</Link><span>{dateOnly(p.purchaseDate)}</span><Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge><span className="tabular-nums">{money(p.invoiceTotal)} (bal. {money(toNum(p.invoiceTotal) - toNum(p.amountPaid))})</span></li>
            )) : <li className="p-3 text-slate-500">None</li>}</ul>
          </div>
          <div><p className="label">Payments</p>
            <ul className="divide-y divide-slate-100 rounded-lg border">{s.payments.length ? s.payments.map((p) => (
              <li key={p.id} className="flex justify-between px-3 py-2"><span>{dateOnly(p.paidAt)} · {METHOD_LABEL[p.method]} {p.reference}</span><b>{money(p.amount)}</b></li>
            )) : <li className="p-3 text-slate-500">None</li>}</ul>
          </div>
          <div><p className="label">Buying price history</p>
            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border">{s.priceHistory.length ? s.priceHistory.map((h, i) => (
              <li key={i} className="flex justify-between gap-2 px-3 py-2"><span className="min-w-0 truncate">{h.name}</span><span className="whitespace-nowrap text-slate-500">{dateOnly(h.purchaseDate)} · <b className="text-slate-800">{money(h.unitCost)}</b></span></li>
            )) : <li className="p-3 text-slate-500">None</li>}</ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
