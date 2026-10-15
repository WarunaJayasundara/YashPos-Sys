import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, Printer, RotateCcw } from 'lucide-react';
import { usePaperChooser } from '../components/PaperChooser';
import { api, ApiError, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, METHOD_LABEL, money, today, toNum } from '../lib/format';
import type { Sale } from '../lib/types';
import { Badge, Button, Card, Confirm, ErrorBox, Input, Loading, PageHeader } from '../components/ui';
import { useApproval } from '../components/Approval';
import { useToast } from '../components/toast';
import { SALE_STATUS } from './SalesPage';

export default function SaleDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { run, dialog } = useApproval();
  const paper = usePaperChooser();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => api.get<Sale>(`/sales/${id}`) });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const showCost = s.totalCost !== undefined;
  const sameDay = new Date(new Date(s.createdAt).getTime() + 330 * 60_000).toISOString().slice(0, 10) === today();
  const net = toNum(s.total) - toNum(s.taxAmount);

  const doVoid = async () => {
    setBusy(true);
    try {
      await run((approval) => api.post(`/sales/${s.id}/void`, { reason, approval }));
      toast('Sale voided and stock restored');
      setVoidOpen(false);
      qc.invalidateQueries();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'APPROVAL_CANCELLED')) toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="space-y-4">
      {dialog}
      {paper.dialog}
      <PageHeader
        title={s.invoiceNumber}
        subtitle={<>{dateTime(s.createdAt)} · {s.cashierName} <Badge tone={SALE_STATUS[s.status].tone} className="ml-1">{SALE_STATUS[s.status].label}</Badge></>}
        actions={<>
          <Button variant="secondary" onClick={() => paper.ask(s.id, true)}><Printer className="h-4 w-4" />Print / PDF</Button>
          {can('returns.create', 'returns.approve') && !['VOIDED', 'RETURNED'].includes(s.status) && (
            <Button variant="secondary" onClick={() => nav(`/returns?invoice=${encodeURIComponent(s.invoiceNumber)}`)}><RotateCcw className="h-4 w-4" />Return / exchange</Button>
          )}
          {s.status === 'COMPLETED' && sameDay && (
            <Button variant="danger" onClick={() => setVoidOpen(true)}><Ban className="h-4 w-4" />Void</Button>
          )}
        </>}
      />
      {s.status === 'VOIDED' && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Voided {s.voidedAt && dateTime(s.voidedAt)}: {s.voidReason}. Stock was restored. The record is kept for audit.</p>}
      {s.offlineCreatedAt && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Recorded offline at {dateTime(s.offlineCreatedAt)} and synced later.</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Items" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50"><tr>
                <th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Unit</th><th className="th text-right">Disc.</th><th className="th text-right">Total</th>
                {showCost && <th className="th text-right">Cost</th>}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <td className="td"><Link className="font-medium hover:underline" to={`/products/${i.productId}`}>{i.productName}</Link><div className="text-xs text-slate-500">{i.sku}{i.serialNumber ? ` · S/N ${i.serialNumber}` : ''}{i.qtyReturned ? ` · ${i.qtyReturned} returned` : ''}</div></td>
                    <td className="td num">{i.qty}</td>
                    <td className="td num">{money(i.unitPrice)}{toNum(i.unitPrice) !== toNum(i.listPrice) && <div className="text-xs text-slate-400 line-through">{money(i.listPrice)}</div>}</td>
                    <td className="td num">{toNum(i.lineDiscount) ? money(i.lineDiscount) : '-'}</td>
                    <td className="td num font-semibold">{money(i.lineTotal)}</td>
                    {showCost && <td className="td num text-slate-500">{money(toNum(i.unitCost) * i.qty)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Totals and payment">
          <dl className="space-y-1.5 p-4 text-sm">
            <Row k="Subtotal" v={money(toNum(s.subtotal) - toNum(s.lineDiscount))} />
            {toNum(s.billDiscount) > 0 && <Row k="Bill discount" v={`- ${money(s.billDiscount)}`} />}
            {toNum(s.taxAmount) > 0 && <Row k={`Tax (${toNum(s.taxRate)}%)`} v={money(s.taxAmount)} />}
            <Row k="Total" v={money(s.total)} bold />
            {s.payments.map((p) => <Row key={p.id} k={`${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}`} v={money(p.amount)} />)}
            {toNum(s.amountTendered) > 0 && <><Row k="Cash received" v={money(s.amountTendered)} /><Row k="Change" v={money(s.changeDue)} /></>}
            {toNum(s.balanceDue) > 0 && <Row k="On account" v={money(s.balanceDue)} bold />}
            {showCost && <>
              <div className="my-2 border-t border-slate-100" />
              <Row k="Cost of goods" v={money(s.totalCost)} />
              <Row k="Gross profit (ex tax)" v={money(net - toNum(s.totalCost))} bold />
            </>}
            {(s.customerName || s.customerPhone) && <p className="pt-2 text-slate-600">Customer: {[s.customerName, s.customerPhone].filter(Boolean).join(' · ')}{s.customerId && <> · <Link className="link" to={`/customers?id=${s.customerId}`}>account</Link></>}</p>}
          </dl>
        </Card>
      </div>

      {s.returns.length > 0 && (
        <Card title="Returns against this sale">
          <ul className="divide-y divide-slate-100 text-sm">
            {s.returns.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                <span><b>{r.returnNumber}</b> · {dateTime(r.createdAt)} · {r.type.toLowerCase()} · {r.reason}</span>
                <span className="tabular-nums">Refund {money(r.refundTotal)} {r.refunds.map((f) => METHOD_LABEL[f.method]).join(', ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Confirm open={voidOpen} onClose={() => setVoidOpen(false)} title="Void this sale?" danger confirmLabel="Void sale" loading={busy} onConfirm={() => (reason.trim().length >= 3 ? doVoid() : toast('Enter a reason', 'error'))}
        message="Voiding cancels the whole sale and puts every item back into stock. Hand back any money received. The invoice stays in the history marked VOID.">
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Confirm>
    </div>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <div className={`flex justify-between gap-3 ${bold ? 'font-bold' : ''}`}><dt className="text-slate-600">{k}</dt><dd className="tabular-nums">{v}</dd></div>
);
