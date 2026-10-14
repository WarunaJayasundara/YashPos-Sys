import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { api, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, METHOD_LABEL, money, monthStart, today, toNum } from '../lib/format';
import { Button, Card, Confirm, ErrorBox, Input, Loading, Modal, PageHeader, Select } from '../components/ui';
import { DataTable } from '../components/Table';
import { DateRange, type Range } from '../components/DateRange';
import { useToast } from '../components/toast';

interface Expense { id: number; category: string; description: string; amount: string; expenseDate: string; method: string; reference: string | null; attachmentUrl: string | null; paidFromDrawer: boolean }

export default function ExpensesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>({ from: monthStart(), to: today() });
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<Expense | null>(null);
  const cats = useQuery({ queryKey: ['expense-cats'], queryFn: () => api.get<string[]>('/expenses/categories') });
  const q = useQuery({ queryKey: ['expenses', range, category], queryFn: () => api.get<Expense[]>(`/expenses${qs({ ...range, category })}`) });
  const total = (q.data ?? []).reduce((a, e) => a + toNum(e.amount), 0);

  const remove = async () => {
    if (!del) return;
    try { await api.del(`/expenses/${del.id}`); toast('Expense deleted'); qc.invalidateQueries({ queryKey: ['expenses'] }); }
    catch (e) { toast(errorText(e), 'error'); } finally { setDel(null); }
  };

  return (
    <div>
      <PageHeader title="Expenses" subtitle={`Total in period ${money(total)}`} actions={can('expenses.manage') && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Record expense</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <DateRange value={range} onChange={setRange} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.data?.map((c) => <option key={c}>{c}</option>)}</Select>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <DataTable rows={q.data!} rowKey={(e) => e.id} empty="No expenses in this period" columns={[
            { key: 'd', header: 'Description', primary: true, render: (e) => <span>{e.description}{e.attachmentUrl && <a href={e.attachmentUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex text-brand-700" aria-label="Attachment" onClick={(ev) => ev.stopPropagation()}><Paperclip className="h-4 w-4" /></a>}</span> },
            { key: 'dt', header: 'Date', render: (e) => dateOnly(e.expenseDate) },
            { key: 'c', header: 'Category', render: (e) => e.category },
            { key: 'm', header: 'Paid by', render: (e) => `${METHOD_LABEL[e.method]}${e.paidFromDrawer ? ' (drawer)' : ''}` },
            { key: 'r', header: 'Ref', render: (e) => e.reference ?? '-', hideMobile: true },
            { key: 'a', header: 'Amount', num: true, render: (e) => <b>{money(e.amount)}</b> },
            ...(can('expenses.manage') ? [{ key: 'x', header: '', render: (e: Expense) => <button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setDel(e)} aria-label="Delete expense"><Trash2 className="h-4 w-4" /></button> }] : []),
          ]} />
        )}
      </Card>
      {open && <ExpenseForm categories={cats.data ?? []} onClose={() => setOpen(false)} />}
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete this expense?" message={`${del?.description} - ${money(del?.amount)}. The deletion is recorded in the audit log.`} confirmLabel="Delete" onConfirm={remove} />
    </div>
  );
}

function ExpenseForm({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ category: categories[0] ?? 'Other', description: '', amount: '', expenseDate: today(), method: 'CASH', reference: '', paidFromDrawer: false });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    if (file) fd.append('attachment', file);
    try { await api.post('/expenses', fd); toast('Expense recorded'); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); }
    catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record expense" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="exp-form" loading={busy}>Save</Button></>}>
      <form id="exp-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input label="Date" type="date" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} required />
        <Input label="Description *" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required wrapClass="sm:col-span-2" />
        <Input label="Amount *" type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
        <Select label="Paid by" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['CASH', 'BANK_TRANSFER', 'CARD', 'QR'].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
        <Input label="Receipt / reference no." value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        <label className="text-sm"><span className="label">Attachment (image or PDF)</span><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        {f.method === 'CASH' && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.paidFromDrawer} onChange={(e) => setF({ ...f, paidFromDrawer: e.target.checked })} />Paid from the shop cash drawer (reduces expected drawer cash)</label>}
      </form>
    </Modal>
  );
}
