import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, money, plain, today } from '../lib/format';
import type { Named } from '../lib/types';
import { Card, ErrorBox, Loading, PageHeader, Select, Button } from '../components/ui';
import { DateRange, type Range } from '../components/DateRange';

interface Report { key: string; title: string; from: string; to: string; columns: { key: string; label: string; money?: boolean }[]; rows: Record<string, unknown>[]; summary?: Record<string, string> }

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Sales', keys: ['daily-sales', 'period-sales', 'sales-by-product', 'sales-by-category', 'sales-by-brand', 'sales-by-cashier', 'best-sellers', 'discounts', 'returns'] },
  { title: 'Profit and money', keys: ['profit-by-product', 'profit-by-category', 'net-profit', 'cash-reconciliation', 'supplier-balances', 'purchases'] },
  { title: 'Inventory', keys: ['inventory-valuation', 'low-stock', 'slow-moving', 'stock-movements', 'adjustments'] },
];
const NO_DATES = ['inventory-valuation', 'low-stock', 'supplier-balances'];

export default function ReportsPage() {
  const { key } = useParams();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get<{ key: string; title: string }[]>('/reports') });
  if (!key) {
    return (
      <div>
        <PageHeader title="Reports" subtitle="Choose a report. All reports can be filtered by date and printed." />
        {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : (
          <div className="grid gap-4 lg:grid-cols-3">
            {GROUPS.map((g) => {
              const items = g.keys.map((k) => list.data!.find((r) => r.key === k)).filter(Boolean) as { key: string; title: string }[];
              if (!items.length) return null;
              return (
                <Card key={g.title} title={g.title}>
                  <ul className="divide-y divide-slate-100">{items.map((r) => <li key={r.key}><Link to={`/reports/${r.key}`} className="block px-4 py-3 text-sm font-medium text-brand-800 hover:bg-brand-50">{r.title}</Link></li>)}</ul>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  return <ReportView reportKey={key} />;
}

function ReportView({ reportKey }: { reportKey: string }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: today() });
  const [group, setGroup] = useState('week');
  const [categoryId, setCategoryId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [slowDays, setSlowDays] = useState('60');
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Named[]>('/categories') });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ id: number; fullName: string }[]>('/users/staff'), retry: false });
  const params = { ...range, group, categoryId, cashierId, slowDays };
  const q = useQuery({ queryKey: ['report', reportKey, params], queryFn: () => api.get<Report>(`/reports/${reportKey}${qs(params)}`) });
  const showCat = ['sales-by-product', 'profit-by-product', 'inventory-valuation', 'stock-movements', 'best-sellers'].includes(reportKey);
  const showCashier = ['daily-sales', 'period-sales', 'sales-by-product', 'sales-by-category', 'sales-by-cashier', 'discounts'].includes(reportKey);

  return (
    <div>
      <div className="no-print">
        <button className="mb-2 flex items-center gap-1 text-sm text-brand-700" onClick={() => nav('/reports')}><ArrowLeft className="h-4 w-4" />All reports</button>
        <PageHeader title={q.data?.title ?? 'Report'} actions={<>
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
          {can('reports.export') && <Button variant="secondary" onClick={() => window.open(`/api/reports/${reportKey}${qs({ ...params, format: 'csv' })}`, '_blank')}><Download className="h-4 w-4" />CSV / Excel</Button>}
        </>} />
        <div className="mb-4 flex flex-wrap items-end gap-2">
          {!NO_DATES.includes(reportKey) && <DateRange value={range} onChange={setRange} />}
          {reportKey === 'period-sales' && <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by"><option value="day">By day</option><option value="week">By week</option><option value="month">By month</option></Select>}
          {showCat && <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          {showCashier && staff.data && <Select value={cashierId} onChange={(e) => setCashierId(e.target.value)} aria-label="Cashier"><option value="">All staff</option>{staff.data.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>}
          {reportKey === 'slow-moving' && <Select value={slowDays} onChange={(e) => setSlowDays(e.target.value)} aria-label="Window"><option value="30">Last 30 days</option><option value="60">Last 60 days</option><option value="90">Last 90 days</option></Select>}
        </div>
      </div>
      <div className="hidden print:block"><h1 className="text-lg font-bold">YASH MOBILE - {q.data?.title}</h1><p className="text-xs">{NO_DATES.includes(reportKey) ? `As at ${today()}` : `${range.from} to ${range.to}`}</p></div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : (
        <Card>
          {q.data!.summary && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-100 px-4 py-3 text-sm">
              {Object.entries(q.data!.summary).map(([k, v]) => {
                const col = q.data!.columns.find((c) => c.key === k);
                return <span key={k}><span className="text-slate-500">{col?.label ?? k}:</span> <b className="tabular-nums">{col?.money ? money(v) : plain(v).replace(/\.00$/, '')}</b></span>;
              })}
            </div>
          )}
          {q.data!.rows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50"><tr>{q.data!.columns.map((c) => <th key={c.key} className={`th ${c.money ? 'text-right' : ''}`}>{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data!.rows.map((r, i) => (
                    <tr key={i} className={String(r.line ?? '').startsWith('Net profit') || String(r.line ?? '').startsWith('Gross profit') ? 'bg-slate-50 font-semibold' : ''}>
                      {q.data!.columns.map((c) => <td key={c.key} className={`td ${c.money || typeof r[c.key] === 'number' ? 'num' : ''}`}>{c.money && r[c.key] !== '' && !Number.isNaN(Number(r[c.key])) ? plain(r[c.key] as string) : String(r[c.key] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="p-8 text-center text-sm text-slate-500">No data for these filters.</p>}
        </Card>
      )}
    </div>
  );
}
