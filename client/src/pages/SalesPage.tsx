import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Search, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, METHOD_LABEL, money, today } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Select, type Tone } from '../components/ui';
import { DataTable } from '../components/Table';
import { DateRange, type Range } from '../components/DateRange';

interface Row { id: number; invoiceNumber: string; status: string; createdAt: string; cashierName: string; customerName: string | null; customerPhone: string | null; total: string; balanceDue: string; payments: { method: string; amount: string }[]; _count: { items: number } }

export const SALE_STATUS: Record<string, { tone: Tone; label: string }> = {
  COMPLETED: { tone: 'green', label: 'Completed' }, PARTIALLY_RETURNED: { tone: 'amber', label: 'Part returned' },
  RETURNED: { tone: 'violet', label: 'Returned' }, VOIDED: { tone: 'red', label: 'Voided' },
};

export default function SalesPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [range, setRange] = useState<Range>({ from: today(), to: today() });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ id: number; fullName: string }[]>('/users/staff'), enabled: can('sales.view_all') });
  const q = useQuery({
    queryKey: ['sales', range, search, status, method, cashierId],
    queryFn: () => api.get<Row[]>(`/sales${qs({ ...(search ? { q: search } : range), status, method, cashierId, limit: 300 })}`),
  });
  const total = (q.data ?? []).filter((s) => s.status !== 'VOIDED').reduce((a, s) => a + Number(s.total), 0);

  return (
    <div>
      <PageHeader title="Sales history" subtitle={can('sales.view_all') ? 'All sales' : 'Your sales'} actions={!search && <DateRange value={range} onChange={setRange} />} />
      <Card>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex gap-2 sm:col-span-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Invoice no., customer name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search sales" />
            </div>
            <Button variant={showFilters || status || method || cashierId ? 'soft' : 'secondary'} className="sm:hidden" onClick={() => setShowFilters((f) => !f)} aria-label="Filters" aria-expanded={showFilters}><SlidersHorizontal className="h-4 w-4" /></Button>
          </div>
          <div className={clsx('contents', !showFilters && 'max-sm:hidden')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(SALE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
            <option value="">All payment methods</option>
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {staff.data && (
            <Select value={cashierId} onChange={(e) => setCashierId(e.target.value)} aria-label="Cashier" wrapClass="sm:col-span-2">
              <option value="">All cashiers</option>
              {staff.data.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </Select>
          )}
          </div>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <>
            <p className="px-4 py-2 text-xs text-slate-500">{q.data!.length} sale(s){q.data!.length >= 300 ? ' (first 300)' : ''} · total {money(total)} (excluding voided)</p>
            <DataTable
              rows={q.data!}
              rowKey={(r) => r.id}
              onRowClick={(r) => nav(`/sales/${r.id}`)}
              empty="No sales match these filters"
              renderMobile={(r) => (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Receipt className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{r.invoiceNumber}</p>
                    <p className="truncate text-xs text-slate-500">{dateTime(r.createdAt)} · {r.payments.map((p) => METHOD_LABEL[p.method]).join(' + ')}</p>
                  </div>
                  <div className="text-right">
                    <p className={r.status === 'VOIDED' ? 'text-sm text-slate-400 line-through' : 'text-sm font-bold tabular-nums'}>{money(r.total)}</p>
                    {r.status !== 'COMPLETED' && <Badge tone={SALE_STATUS[r.status].tone}>{SALE_STATUS[r.status].label}</Badge>}
                  </div>
                </div>
              )}
              columns={[
                { key: 'inv', header: 'Invoice', primary: true, render: (r) => <span className="font-medium">{r.invoiceNumber}</span> },
                { key: 'date', header: 'Date', render: (r) => dateTime(r.createdAt) },
                { key: 'cashier', header: 'Cashier', render: (r) => r.cashierName },
                { key: 'cust', header: 'Customer', render: (r) => [r.customerName, r.customerPhone].filter(Boolean).join(' ') || '-', hideMobile: true },
                { key: 'pay', header: 'Payment', render: (r) => r.payments.map((p) => METHOD_LABEL[p.method]).join(' + ') || '-' },
                { key: 'status', header: 'Status', render: (r) => <Badge dot tone={SALE_STATUS[r.status].tone}>{SALE_STATUS[r.status].label}</Badge> },
                { key: 'total', header: 'Total', num: true, render: (r) => <span className="font-semibold">{money(r.total)}</span> },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
