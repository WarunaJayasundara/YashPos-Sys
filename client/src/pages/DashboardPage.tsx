import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowRight, Banknote, Boxes, ChartNoAxesCombined, CircleDollarSign, Coins, PackageOpen, Receipt, ShoppingCart, TrendingUp, Trophy, Truck, Wallet } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysAgo, dateTime, int, METHOD_LABEL, money, money0, today, toNum } from '../lib/format';
import { Avatar, Badge, Card, ErrorBox, PageHeader, Skeleton, Stat } from '../components/ui';
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

const PAY_COLORS: Record<string, string> = { CASH: '#10b981', CARD: '#3550e8', QR: '#8b5cf6', BANK_TRANSFER: '#f59e0b', CREDIT: '#ef4444' };
const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

function greeting() {
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => <p key={p.name} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}: <b className="tabular-nums">{money0(p.value)}</b></p>)}
    </div>
  );
}

export default function DashboardPage() {
  const { can, user } = useAuth();
  const fin = can('dashboard.financial');
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: today() });
  const q = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<Dash>(`/dashboard${qs(range)}`), refetchInterval: 60_000 });

  return (
    <div>
      <PageHeader title={`${greeting()}, ${user?.fullName.split(' ')[0]}`} subtitle="Here is how YASH MOBILE is doing." actions={<DateRange value={range} onChange={setRange} />} />
      {q.isLoading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      )}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (() => {
        const d = q.data;
        const series = d.series.map((s) => ({ ...s, label: new Date(`${s.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), total: toNum(s.total), profit: toNum(s.profit) }));
        const payTotal = d.paymentMethods.reduce((a, m) => a + toNum(m.total), 0);
        return (
          <div className="space-y-4 lg:space-y-5">
            {/* hero: today */}
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-brand-950 to-brand-800 p-5 text-white shadow-lift sm:p-6">
              <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-500/30 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl" />
              <div className="relative flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="text-sm font-medium text-brand-200">Today's sales</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">{money(d.today.revenue)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium">{d.today.sales} bill{d.today.sales === 1 ? '' : 's'}</span>
                    <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium">Avg {money0(d.today.avgBill)}</span>
                    {fin && d.today.grossProfit && <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 font-semibold text-emerald-200">Profit {money0(d.today.grossProfit)}</span>}
                  </div>
                </div>
                {can('sales.create') && (
                  <Link to="/pos" className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-brand-800 shadow-lg transition hover:bg-brand-50">
                    <ShoppingCart className="h-4 w-4" />Start a sale<ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              <Stat icon={CircleDollarSign} label="Sales in period" value={money0(d.period.revenue)} sub={`${int(d.period.sales)} bills · refunds ${money0(d.period.refunds)}`} />
              <Stat icon={Receipt} accent="violet" label="Average bill" value={money0(d.period.avgBill)} sub={`${range.from} to ${range.to}`} />
              {fin ? <>
                <Stat icon={TrendingUp} accent="green" label="Gross profit" value={money0(d.period.grossProfit)} tone="green" sub={`${d.period.grossMarginPercent ?? 0}% margin on net sales`} />
                <Stat icon={Wallet} accent={toNum(d.period.netProfit) < 0 ? 'red' : 'green'} label="Net profit" value={money0(d.period.netProfit)} tone={toNum(d.period.netProfit) < 0 ? 'red' : 'green'} sub="After expenses and stock write-offs" />
                <Stat icon={Receipt} accent="red" label="Expenses" value={money0(d.period.expenses)} sub={`Write-offs ${money0(d.period.stockWrittenOff)}`} />
                <Stat icon={Coins} accent="amber" label="Stock value at cost" value={money0(d.stock.costValue)} sub={`${int(d.stock.units)} units in stock`} />
                <Stat icon={Banknote} accent="slate" label="Stock retail value" value={money0(d.stock.retailValue)} sub={`Potential profit ${money0(d.stock.potentialProfit)}`} />
              </> : (
                <Stat icon={Boxes} accent="amber" label="Units in stock" value={int(d.stock.units)} sub={`Retail value ${money0(d.stock.retailValue)}`} />
              )}
              <Link to="/products?status=LOW" className="contents">
                <Stat icon={AlertTriangle} accent="red" label="Stock alerts" value={<span><span className="text-amber-600">{d.stock.lowCount}</span><span className="text-sm font-medium text-slate-400"> low · </span><span className="text-red-600">{d.stock.outCount}</span><span className="text-sm font-medium text-slate-400"> out</span></span>} sub={<span className="link">Review items</span>} />
              </Link>
            </div>

            <div className="grid gap-4 lg:gap-5 xl:grid-cols-3">
              <Card title={fin ? 'Sales and gross profit' : 'Daily sales'} icon={ChartNoAxesCombined} className="xl:col-span-2">
                <div className="h-72 px-2 pb-3 pt-4">
                  {series.length ? (
                    <ResponsiveContainer>
                      <AreaChart data={series} margin={{ left: 0, right: 12, top: 4 }}>
                        <defs>
                          <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3550e8" stopOpacity={0.28} /><stop offset="100%" stopColor="#3550e8" stopOpacity={0} /></linearGradient>
                          <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.25} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} tick={{ fill: '#64748b' }} minTickGap={20} />
                        <YAxis tickFormatter={short} fontSize={11} width={40} tickLine={false} axisLine={false} tick={{ fill: '#64748b' }} />
                        <Tooltip content={<ChartTip />} />
                        <Area type="monotone" dataKey="total" name="Sales" stroke="#3550e8" strokeWidth={2.5} fill="url(#gSales)" />
                        {fin && <Area type="monotone" dataKey="profit" name="Gross profit" stroke="#10b981" strokeWidth={2} fill="url(#gProfit)" />}
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <p className="p-8 text-center text-sm text-slate-500">No sales in this period.</p>}
                </div>
              </Card>
              <Card title="Payment methods" icon={Wallet}>
                {d.paymentMethods.length ? (
                  <div className="flex flex-col items-center gap-4 p-5 sm:flex-row xl:flex-col">
                    <div className="relative h-40 w-40 shrink-0">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={d.paymentMethods.map((m) => ({ name: METHOD_LABEL[m.method], value: toNum(m.total), key: m.method }))} dataKey="value" innerRadius={52} outerRadius={76} paddingAngle={3} stroke="none">
                            {d.paymentMethods.map((m) => <Cell key={m.method} fill={PAY_COLORS[m.method]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><p className="text-[11px] text-slate-500">Total</p><p className="text-sm font-bold tabular-nums">{money0(payTotal)}</p></div></div>
                    </div>
                    <ul className="w-full space-y-2.5 text-sm">
                      {[...d.paymentMethods].sort((a, b) => toNum(b.total) - toNum(a.total)).map((m) => (
                        <li key={m.method} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAY_COLORS[m.method] }} />
                          <span className="flex-1 text-slate-600">{METHOD_LABEL[m.method]}</span>
                          <span className="font-semibold tabular-nums">{money0(m.total)}</span>
                          <span className="w-10 text-right text-xs text-slate-400">{payTotal ? Math.round((toNum(m.total) / payTotal) * 100) : 0}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="p-8 text-center text-sm text-slate-500">No payments yet.</p>}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
              <Card title="Best sellers" icon={Trophy}>
                {d.bestSellers.length ? (
                  <ul className="divide-y divide-slate-100">
                    {d.bestSellers.map((b, i) => {
                      const max = d.bestSellers[0].qty || 1;
                      return (
                        <li key={b.id}>
                          <Link to={`/products/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50 sm:px-5">
                            <span className="w-4 text-xs font-bold text-slate-400">{i + 1}</span>
                            <Avatar name={b.name} className="h-9 w-9 shrink-0 rounded-xl text-xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{b.name}</p>
                              <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(b.qty / max) * 100}%` }} /></div>
                            </div>
                            <div className="text-right"><p className="text-sm font-semibold tabular-nums">{b.qty} sold</p><p className="text-xs text-slate-500 tabular-nums">{money0(b.total)}</p></div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="p-8 text-center text-sm text-slate-500">No sales in this period.</p>}
              </Card>
              <Card title="Needs restocking" icon={PackageOpen} actions={<Link className="link text-xs" to="/products?status=LOW">View all</Link>}>
                <ul className="divide-y divide-slate-100">
                  {d.lowStock.length ? d.lowStock.map((l) => (
                    <li key={l.id}>
                      <Link to={`/products/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50 sm:px-5">
                        <Avatar name={l.name} className="h-9 w-9 shrink-0 rounded-xl text-xs" />
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{l.name}</p><p className="text-xs text-slate-500">{l.sku} · reorder at {l.reorderLevel}</p></div>
                        <Badge dot tone={l.available <= 0 ? 'red' : 'amber'}>{l.available <= 0 ? 'Out of stock' : `${l.available} left`}</Badge>
                      </Link>
                    </li>
                  )) : <li className="p-8 text-center text-sm text-slate-500">Everything is above its reorder level.</li>}
                </ul>
              </Card>
            </div>

            <div className="grid gap-4 lg:gap-5 xl:grid-cols-3">
              <Card title="Recent sales" icon={Receipt} actions={<Link className="link text-xs" to="/sales">All sales</Link>}>
                <ul className="divide-y divide-slate-100">
                  {d.recentSales.map((s) => (
                    <li key={s.id}><Link to={`/sales/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-slate-50 sm:px-5">
                      <span className="min-w-0"><span className="block font-medium text-slate-800">{s.invoiceNumber}</span><span className="block truncate text-xs text-slate-500">{dateTime(s.createdAt)} · {s.cashierName}</span></span>
                      <span className={s.status === 'VOIDED' ? 'text-slate-400 line-through' : 'font-semibold tabular-nums'}>{money(s.total)}</span>
                    </Link></li>
                  ))}
                </ul>
              </Card>
              <Card title="Slow-moving (60 days)" icon={Boxes}>
                <ul className="divide-y divide-slate-100">
                  {d.slowMovers.map((s) => (
                    <li key={s.id}><Link to={`/products/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-slate-50 sm:px-5">
                      <span className="min-w-0 truncate font-medium text-slate-800">{s.name}</span>
                      <span className="whitespace-nowrap text-xs text-slate-500">{s.soldLast60Days} sold · {s.qtyOnHand} left</span>
                    </Link></li>
                  ))}
                </ul>
              </Card>
              {can('purchases.view') && (
                <Card title="Recent purchases" icon={Truck} actions={<Link className="link text-xs" to="/purchases">All purchases</Link>}>
                  <ul className="divide-y divide-slate-100">
                    {d.recentPurchases.length ? d.recentPurchases.map((p) => (
                      <li key={p.id}><Link to={`/purchases/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-slate-50 sm:px-5">
                        <span className="min-w-0"><span className="block font-medium text-slate-800">{p.poNumber}</span><span className="block truncate text-xs text-slate-500">{p.supplier.name}</span></span>
                        <span className="text-right"><span className="block font-semibold tabular-nums">{money0(p.invoiceTotal)}</span><Badge tone={p.status === 'RECEIVED' ? 'green' : 'amber'}>{p.status.replace('_', ' ').toLowerCase()}</Badge></span>
                      </Link></li>
                    )) : <li className="p-8 text-center text-sm text-slate-500">No purchases yet.</li>}
                  </ul>
                </Card>
              )}
            </div>
            <p className="text-xs leading-relaxed text-slate-400">Sales are invoice totals including tax, excluding voided sales. Gross profit = net sales after discounts and returns (excluding tax) minus the recorded cost of goods sold. Net profit also subtracts damaged or lost stock and the expenses dated in the period. Tiles show whole rupees; reports show exact amounts.</p>
          </div>
        );
      })()}
    </div>
  );
}
