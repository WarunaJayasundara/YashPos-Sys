import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText, qs } from '../lib/api';
import { dateTime, METHOD_LABEL, money, today, toNum } from '../lib/format';
import { Button, Card, ErrorBox, Input, Loading, PageHeader } from '../components/ui';
import { useToast } from '../components/toast';

interface Summary {
  date: string; cashSales: string; cashCollections: string; cashRefunds: string; cashExpenses: string; expectedBeforeFloat: string; nonCashTotals: Record<string, string>;
  closing: null | { openingFloat: string; expectedCash: string; countedCash: string; difference: string; notes: string | null; createdAt: string };
}

const NOTES = [5000, 1000, 500, 100, 50, 20];

export default function CashPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [float, setFloat] = useState('0');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['cash', date], queryFn: () => api.get<Summary>(`/cash/summary${qs({ date })}`) });

  const counted = NOTES.reduce((a, n) => a + n * toNum(counts[n]), 0) + toNum(coins);
  const expected = toNum(q.data?.expectedBeforeFloat) + toNum(float);
  const diff = counted - expected;

  const close = async () => {
    if (!window.confirm(`Close ${date} with counted cash ${money(counted)}? This cannot be edited afterwards.`)) return;
    setBusy(true);
    try {
      await api.post('/cash/close', { date, openingFloat: toNum(float), countedCash: counted, notes: notes || undefined });
      toast('Day closed');
      qc.invalidateQueries({ queryKey: ['cash', date] });
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Daily cash closing" subtitle="Compare the cash expected in the drawer with what you count" actions={<Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Business date" />} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : (() => {
        const s = q.data!;
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Expected drawer cash">
              <dl className="space-y-2 p-4 text-sm">
                <Row k="Opening float" v={<input aria-label="Opening float" className="input w-32 py-1 text-right" type="number" min={0} value={s.closing ? toNum(s.closing.openingFloat) : float} disabled={!!s.closing} onChange={(e) => setFloat(e.target.value)} />} />
                <Row k="+ Cash sales" v={money(s.cashSales)} />
                <Row k="+ Credit payments received in cash" v={money(s.cashCollections)} />
                <Row k="- Cash refunds" v={money(s.cashRefunds)} />
                <Row k="- Expenses paid from drawer" v={money(s.cashExpenses)} />
                <Row k="Expected cash" v={<b className="text-base">{money(s.closing ? s.closing.expectedCash : expected)}</b>} />
              </dl>
              <div className="border-t border-slate-100 p-4 text-sm">
                <p className="label">Not in the drawer (for reconciliation with bank / card statements)</p>
                {Object.keys(s.nonCashTotals).length ? Object.entries(s.nonCashTotals).map(([m, v]) => <Row key={m} k={METHOD_LABEL[m]} v={money(v)} />) : <p className="text-slate-500">No card, transfer, QR or credit sales.</p>}
              </div>
            </Card>
            {s.closing ? (
              <Card title="Day closed">
                <dl className="space-y-2 p-4 text-sm">
                  <Row k="Closed at" v={dateTime(s.closing.createdAt)} />
                  <Row k="Expected" v={money(s.closing.expectedCash)} />
                  <Row k="Counted" v={money(s.closing.countedCash)} />
                  <Row k="Difference" v={<b className={toNum(s.closing.difference) === 0 ? 'text-emerald-700' : 'text-red-700'}>{money(s.closing.difference)}</b>} />
                  {s.closing.notes && <p className="text-slate-600">{s.closing.notes}</p>}
                </dl>
              </Card>
            ) : (
              <Card title="Count the drawer">
                <div className="space-y-2 p-4">
                  {NOTES.map((n) => (
                    <div key={n} className="flex items-center gap-2 text-sm">
                      <span className="w-20 tabular-nums">Rs. {n}</span><span>x</span>
                      <input aria-label={`Rs. ${n} notes`} className="input w-24 py-1 text-right" type="number" min={0} value={counts[n] ?? ''} onChange={(e) => setCounts({ ...counts, [n]: e.target.value })} />
                      <span className="ml-auto tabular-nums">{money(n * toNum(counts[n]))}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-sm"><span className="w-20">Coins</span><input aria-label="Coins total" className="input w-32 py-1 text-right" type="number" min={0} step="0.01" value={coins} onChange={(e) => setCoins(e.target.value)} /></div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                    <Row k="Counted" v={<b>{money(counted)}</b>} />
                    <Row k="Difference" v={<b className={Math.abs(diff) < 0.005 ? 'text-emerald-700' : 'text-red-700'}>{diff > 0 ? '+' : ''}{money(diff)}</b>} />
                  </div>
                  <Input label="Notes (explain any difference)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <Button className="w-full" loading={busy} onClick={close}>Close the day</Button>
                </div>
              </Card>
            )}
          </div>
        );
      })()}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex items-center justify-between gap-3"><dt className="text-slate-600">{k}</dt><dd className="tabular-nums">{v}</dd></div>;
