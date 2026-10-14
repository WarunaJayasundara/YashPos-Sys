import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, dateTime, int, METHOD_LABEL, money, today, toNum } from '../lib/format';
import { Badge, Card, ErrorBox, Loading, PageHeader, Stat } from '../components/ui';
import { DateRange, type Range } from '../components/DateRange';

interface Dash {
  range: Range;
  today: { revenue: string; sales: number; avgBill: string; grossProfit?: string };
  period: { revenue: string; sales: number; avgBill: string; refunds: string; netSales?: string; cogs?: string; grossProfit?: string; grossMarginPercent?: number | null; expenses?: string; stockWrittenOff?: string; netProfit?: string };
  stock: { units: number; lowCount: number; outCount: number; retailValue: string; costValue?: string; potentialProfit?: string };
  series: { date: string; sales: number; total: string; profit?: string }[];
  bestSellers: { id: number; name: string; qty: number; total: string }[];
  slowMovers: { id: number; name: string; qtyOnHand: number; soldLast60Days: number }[];
  paymentMethods: { method: string; total: string }[];
  recentSales: { id: number; invoiceNumber: string; createdAt: string; total: string; status: string; cashierName: string }[];
  recentPurchases: { id: number; poNumber: string; purchaseDate: string; status: string; invoiceTotal: string; supplier: { name: string } }[];
  lowStock: { id: number; name: string; sku: string; available: number; reorderLevel: number }[];
}

const COLORS = ['#1a44b8', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

export default function DashboardPage() {
  const { can } = useAuth();
  const fin = can('dashboard.financial');
  const nav = useNavigate();
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: today() });
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<Dash>(`/dashboard${qs(range)}`), refetchInterval: 60_000 });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Sales, stock and profit at a glance" actions={<DateRange value={range} onChange={setRange} />} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (() => {
        const d = q.data;
        const series = d.series.map((s) => ({ ...s, total: toNum(s.total), profit: toNum(s.profit) }));
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Today's sales" value={money(d.today.revenue)} sub={`${d.today.sales} bill(s)${fin && d.today.grossProfit ? ` · profit ${money(d.today.grossProfit)}` : ''}`} />
              <Stat label="Sales in period" value={money(d.period.revenue)} sub={`${int(d.period.sales)} bills · refunds ${money(d.period.refunds)}`} />
              <Stat label="Average bill" value={money(d.period.avgBill)} sub="Selected period" />
              {fin ? (
                <Stat label="Gross profit" value={money(d.period.grossProfit)} tone="green" sub={`Margin ${d.period.grossMarginPercent ?? 0}% of net sales`} />
              ) : (
                <Stat label="Units in stock" value={int(d.stock.units)} sub={`${d.stock.lowCount} low · ${d.stock.outCount} out`} />
              )}
              {fin && <>
                <Stat label="Net profit" value={money(d.period.netProfit)} tone={toNum(d.period.netProfit) < 0 ? 'red' : 'green'} sub={`After expenses ${money(d.period.expenses)} and write-offs ${money(d.period.stockWrittenOff)}`} />
                <Stat label="Stock value at cost" value={money(d.stock.costValue)} sub={`${int(d.stock.units)} units in stock`} />
                <Stat label="Stock retail value" value={money(d.stock.retailValue)} sub={`Potential profit ${money(d.stock.potentialProfit)}`} />
                <Stat label="Stock alerts" value={<span><span className="text-amber-700">{d.stock.lowCount} low</span> · <span className="text-red-700">{d.stock.outCount} out</span></span>} sub={<Link to="/products?status=LOW" className="text-brand-700 underline">View items</Link>} />
              </>}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={fin ? 'Daily sales and gross profit' : 'Daily sales'} className="lg:col-span-2">
                <div className="h-64 p-2">
                  {series.length ? (
                    <ResponsiveContainer>
                      <AreaChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} fontSize={11} />
                        <YAxis tickFormatter={short} fontSize={11} width={40} />
                        <Tooltip formatter={(v: number) => money(v)} />
                        <Legend />
                        <Area type="monotone" dataKey="total" name="Sales" stroke="#1a44b8" fill="#1a44b8" fillOpacity={0.15} />
                        {fin && <Area type="monotone" dataKey="profit" name="Gross profit (before returns)" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <p className="p-8 text-center text-sm text-slate-500">No sales in this period.</p>}
                </div>
              </Card>
              <Card title="Payment methods">
                <div className="h-64 p-2">
                  {d.paymentMethods.length ? (
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={d.paymentMethods.map((m) => ({ name: METHOD_LABEL[m.method], value: toNum(m.total) }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                          {d.paymentMethods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => money(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="p-8 text-center text-sm text-slate-500">No payments yet.</p>}
                </div>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Best-selling products">
                <div className="h-64 p-2">
                  {d.bestSellers.length ? (
                    <ResponsiveContainer>
                      <BarChart data={d.bestSellers} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <XAxis type="number" fontSize={11} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" width={130} fontSize={11} tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
                        <Tooltip />
                        <Bar dataKey="qty" name="Units sold" fill="#1a44b8" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="p-8 text-center text-sm text-slate-500">No sales in this period.</p>}
                </div>
              </Card>
              <Card title="Low stock" actions={<Link className="text-xs font-medium text-brand-700" to="/products?status=LOW">All</Link>}>
                <ul className="divide-y divide-slate-100">
                  {d.lowStock.length ? d.lowStock.map((l) => (
                    <li key={l.id}><button onClick={() => nav(`/products/${l.id}`)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                      <span className="min-w-0 truncate">{l.name}</span>
                      <Badge tone={l.available <= 0 ? 'red' : 'amber'}>{l.available <= 0 ? 'Out' : `${l.available} left`}</Badge>
                    </button></li>
                  )) : <li className="p-6 text-center text-sm text-slate-500">All products are above their reorder level.</li>}
                </ul>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Recent sales" className="lg:col-span-1">
                <ul className="divide-y divide-slate-100">
                  {d.recentSales.map((s) => (
                    <li key={s.id}><Link to={`/sales/${s.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span><span className="font-medium">{s.invoiceNumber}</span><br /><span className="text-xs text-slate-500">{dateTime(s.createdAt)} · {s.cashierName}</span></span>
                      <span className={s.status === 'VOIDED' ? 'text-slate-400 line-through' : 'font-semibold tabular-nums'}>{money(s.total)}</span>
                    </Link></li>
                  ))}
                </ul>
              </Card>
              <Card title="Slow-moving (60 days)">
                <ul className="divide-y divide-slate-100">
                  {d.slowMovers.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <Link to={`/products/${s.id}`} className="min-w-0 truncate hover:underline">{s.name}</Link>
                      <span className="whitespace-nowrap text-xs text-slate-500">{s.soldLast60Days} sold · {s.qtyOnHand} in stock</span>
                    </li>
                  ))}
                </ul>
              </Card>
              {can('purchases.view') && (
                <Card title="Recent purchases">
                  <ul className="divide-y divide-slate-100">
                    {d.recentPurchases.length ? d.recentPurchases.map((p) => (
                      <li key={p.id}><Link to={`/purchases/${p.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                        <span><span className="font-medium">{p.poNumber}</span><br /><span className="text-xs text-slate-500">{p.supplier.name}</span></span>
                        <span className="text-right"><span className="tabular-nums">{money(p.invoiceTotal)}</span><br /><Badge tone={p.status === 'RECEIVED' ? 'green' : 'amber'}>{p.status.replace('_', ' ').toLowerCase()}</Badge></span>
                      </Link></li>
                    )) : <li className="p-6 text-center text-sm text-slate-500">No purchases yet.</li>}
                  </ul>
                </Card>
              )}
            </div>
            <p className="text-xs text-slate-400">Sales = invoice totals incl. tax for non-voided sales. Gross profit = net sales after discounts and returns, excluding tax, minus the recorded cost of goods sold. Net profit = gross profit minus damaged/lost stock written off and expenses dated in the period.</p>
          </div>
        );
      })()}
    </div>
  );
}
