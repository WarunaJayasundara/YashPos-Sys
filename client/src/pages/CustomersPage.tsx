import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, METHOD_LABEL, money, toNum } from '../lib/format';
import { Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Select } from '../components/ui';
import { DataTable } from '../components/Table';
import { useToast } from '../components/toast';
import { SALE_STATUS } from './SalesPage';
import { Badge } from '../components/ui';

interface Customer { id: number; name: string; phone: string | null; email: string | null; notes: string | null; balance: string; _count?: { sales: number } }
interface Detail extends Customer {
  sales: { id: number; invoiceNumber: string; createdAt: string; total: string; balanceDue: string; status: string }[];
  payments: { id: number; amount: string; method: string; createdAt: string; reference: string | null }[];
}

export default function CustomersPage() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState('');
  const [d, setD] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setD(term), 250); return () => clearTimeout(t); }, [term]);
  const q = useQuery({ queryKey: ['customers', d], queryFn: () => api.get<Customer[]>(`/customers${qs({ q: d })}`) });
  const openId = sp.get('id');

  return (
    <div>
      <PageHeader title="Customers" subtitle="Optional customer records, purchase history and account balances" actions={can('customers.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New customer</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-3"><Input placeholder="Search by name or phone" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search customers" wrapClass="max-w-md" /></div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <DataTable rows={q.data!} rowKey={(c) => c.id} onRowClick={(c) => setSp({ id: String(c.id) })} empty="No customers" columns={[
            { key: 'n', header: 'Name', primary: true, render: (c) => <span className="font-medium">{c.name}</span> },
            { key: 'p', header: 'Phone', render: (c) => c.phone ?? '-' },
            { key: 's', header: 'Purchases', num: true, render: (c) => c._count?.sales ?? 0 },
            { key: 'b', header: 'Balance due', num: true, render: (c) => <span className={toNum(c.balance) > 0 ? 'font-semibold text-red-700' : ''}>{money(c.balance)}</span> },
          ]} />
        )}
      </Card>
      {creating && <CustomerForm onClose={() => setCreating(false)} />}
      {openId && <CustomerDetail id={Number(openId)} onClose={() => setSp({})} />}
    </div>
  );
}

function CustomerForm({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', notes: customer?.notes ?? '' });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: f.name, phone: f.phone || null, email: f.email || null, notes: f.notes || null };
    try {
      if (customer) await api.put(`/customers/${customer.id}`, body); else await api.post('/customers', body);
      toast('Customer saved');
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
    } catch (err) { toast(errorText(err), 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={customer ? 'Edit customer' : 'New customer'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="cust-form">Save</Button></>}>
      <form id="cust-form" onSubmit={save} className="space-y-3">
        <Input label="Name *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Input label="Phone" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint="Used to find the customer at the POS" />
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <p className="text-xs text-slate-500">Only collect what is needed for receipts, warranty or credit.</p>
      </form>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Detail>(`/customers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const c = q.data;
  const pay = async () => {
    try {
      await api.post(`/customers/${id}/payments`, { amount: toNum(amount), method });
      toast('Payment recorded');
      setAmount('');
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (e) { toast(errorText(e), 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={c?.name ?? 'Customer'} wide footer={can('customers.manage') && c && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}>
      {!c ? <Loading /> : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">{[c.phone, c.email, c.notes].filter(Boolean).join(' · ') || 'No contact details'}</p>
          <p>Balance due: <b className={toNum(c.balance) > 0 ? 'text-red-700' : ''}>{money(c.balance)}</b></p>
          {can('customers.manage') && toNum(c.balance) > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
              <Input label="Receive payment" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} wrapClass="w-40" />
              <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>{['CASH', 'CARD', 'BANK_TRANSFER', 'QR'].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
              <Button onClick={pay} disabled={!toNum(amount)}>Record</Button>
            </div>
          )}
          <div><p className="label">Purchase history</p>
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border">{c.sales.length ? c.sales.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link className="link" to={`/sales/${s.id}`}>{s.invoiceNumber}</Link><span className="text-slate-500">{dateTime(s.createdAt)}</span>
                <Badge tone={SALE_STATUS[s.status].tone}>{SALE_STATUS[s.status].label}</Badge>
                <span className="tabular-nums">{money(s.total)}{toNum(s.balanceDue) > 0 && <span className="text-red-700"> (on account {money(s.balanceDue)})</span>}</span>
              </li>
            )) : <li className="p-3 text-slate-500">No purchases</li>}</ul>
          </div>
          {c.payments.length > 0 && <div><p className="label">Payments received</p>
            <ul className="divide-y divide-slate-100 rounded-lg border">{c.payments.map((p) => <li key={p.id} className="flex justify-between px-3 py-2"><span>{dateTime(p.createdAt)} · {METHOD_LABEL[p.method]}</span><b>{money(p.amount)}</b></li>)}</ul>
          </div>}
        </div>
      )}
      {editing && c && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
    </Modal>
  );
}
