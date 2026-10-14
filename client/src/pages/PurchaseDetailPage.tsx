import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { PackageCheck, Wallet, Ban, Send } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateOnly, dateTime, METHOD_LABEL, money, toNum } from '../lib/format';
import { Badge, Button, Card, Confirm, ErrorBox, Input, Loading, Modal, PageHeader, Select, Stat } from '../components/ui';
import { useToast } from '../components/toast';
import { PO_STATUS } from './PurchasesPage';

interface PO {
  id: number; poNumber: string; status: string; supplierInvoiceNo: string | null; purchaseDate: string; notes: string | null; invoiceTotal: string; amountPaid: string; balance: string;
  supplier: { id: number; name: string; phone: string | null };
  items: { id: number; productId: number; qtyOrdered: number; qtyReceived: number; qtyDamaged: number; qtyMissing: number; unitCost: string; product: { name: string; sku: string } }[];
  receipts: { id: number; receiptNumber: string; receivedAt: string; additionalCost: string; notes: string | null; items: { purchaseItemId: number; qtyReceived: number; qtyDamaged: number; qtyMissing: number; qtyAccepted: number; landedUnitCost: string }[] }[];
  payments: { id: number; amount: string; method: string; reference: string | null; paidAt: string }[];
}

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => api.get<PO>(`/purchases/${id}`) });
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [invoiceEdit, setInvoiceEdit] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const po = q.data!;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['purchase', id] }); qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['products'] }); };
  const canReceive = can('purchases.manage') && ['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); refresh(); } catch (e) { toast(errorText(e), 'error'); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={po.poNumber} subtitle={<>{po.supplier.name} · {dateOnly(po.purchaseDate)}{po.supplierInvoiceNo ? ` · Invoice ${po.supplierInvoiceNo}` : ''} <Badge className="ml-1" tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge></>}
        actions={<>
          {po.status === 'DRAFT' && can('purchases.manage') && <Button variant="secondary" onClick={() => act(() => api.post(`/purchases/${po.id}/order`), 'Marked as ordered')}><Send className="h-4 w-4" />Mark ordered</Button>}
          {canReceive && <Button onClick={() => setReceiving(true)}><PackageCheck className="h-4 w-4" />Receive goods</Button>}
          {can('purchases.pay') && po.status !== 'CANCELLED' && toNum(po.balance) > 0 && <Button variant="secondary" onClick={() => setPaying(true)}><Wallet className="h-4 w-4" />Record payment</Button>}
          {can('purchases.manage') && <Button variant="secondary" onClick={() => setInvoiceEdit(true)}>Edit invoice details</Button>}
          {can('purchases.manage') && !po.receipts.length && !po.payments.length && po.status !== 'CANCELLED' && <Button variant="danger" onClick={() => setCancelling(true)}><Ban className="h-4 w-4" />Cancel</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Supplier invoice total" value={money(po.invoiceTotal)} />
        <Stat label="Paid" value={money(po.amountPaid)} />
        <Stat label="Outstanding" value={money(po.balance)} tone={toNum(po.balance) > 0 ? 'red' : 'green'} />
        <Stat label="Units accepted" value={`${po.items.reduce((a, i) => a + i.qtyReceived, 0)} / ${po.items.reduce((a, i) => a + i.qtyOrdered, 0)}`} />
      </div>
      <Card title="Items">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Product</th><th className="th text-right">Ordered</th><th className="th text-right">Accepted</th><th className="th text-right">Damaged</th><th className="th text-right">Missing</th><th className="th text-right">Unit cost</th><th className="th text-right">Line</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {po.items.map((i) => (
                <tr key={i.id}>
                  <td className="td">{i.product.name}<div className="text-xs text-slate-500">{i.product.sku}</div></td>
                  <td className="td num">{i.qtyOrdered}</td><td className="td num font-semibold text-emerald-700">{i.qtyReceived}</td>
                  <td className="td num text-red-700">{i.qtyDamaged || '-'}</td><td className="td num text-amber-700">{i.qtyMissing || '-'}</td>
                  <td className="td num">{money(i.unitCost)}</td><td className="td num">{money(toNum(i.unitCost) * i.qtyOrdered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Goods received">
          {po.receipts.length ? <ul className="divide-y divide-slate-100 text-sm">{po.receipts.map((r) => (
            <li key={r.id} className="px-4 py-2.5"><b>{r.receiptNumber}</b> · {dateTime(r.receivedAt)}{toNum(r.additionalCost) > 0 && ` · extra cost ${money(r.additionalCost)}`}
              <div className="text-xs text-slate-500">{r.items.map((it) => { const pi = po.items.find((x) => x.id === it.purchaseItemId); return `${pi?.product.name}: ${it.qtyAccepted} accepted${it.qtyDamaged ? `, ${it.qtyDamaged} damaged` : ''}${it.qtyMissing ? `, ${it.qtyMissing} missing` : ''} @ ${money(it.landedUnitCost)}`; }).join(' · ')}</div>
              {r.notes && <div className="text-xs">{r.notes}</div>}
            </li>
          ))}</ul> : <p className="p-4 text-sm text-slate-500">Nothing received yet. Stock is unchanged.</p>}
        </Card>
        <Card title="Payments to supplier">
          {po.payments.length ? <ul className="divide-y divide-slate-100 text-sm">{po.payments.map((p) => (
            <li key={p.id} className="flex justify-between px-4 py-2.5"><span>{dateTime(p.paidAt)} · {METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span><b className="tabular-nums">{money(p.amount)}</b></li>
          ))}</ul> : <p className="p-4 text-sm text-slate-500">No payments recorded.</p>}
        </Card>
      </div>
      {po.notes && <Card title="Notes"><p className="whitespace-pre-line p-4 text-sm">{po.notes}</p></Card>}

      {receiving && <ReceiveModal po={po} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); refresh(); }} />}
      {paying && <PayModal po={po} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh(); }} />}
      {invoiceEdit && <InvoiceModal po={po} onClose={() => setInvoiceEdit(false)} onDone={() => { setInvoiceEdit(false); refresh(); }} />}
      <Confirm open={cancelling} onClose={() => setCancelling(false)} danger title="Cancel this purchase?" message="The order is kept but marked cancelled. Nothing was received or paid, so stock and balances are unaffected." confirmLabel="Cancel purchase"
        onConfirm={() => { setCancelling(false); act(() => api.post(`/purchases/${po.id}/cancel`), 'Purchase cancelled'); }} />
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const open = po.items.map((i) => ({ i, left: i.qtyOrdered - i.qtyReceived - i.qtyDamaged - i.qtyMissing })).filter((x) => x.left > 0);
  const [rows, setRows] = useState(() => Object.fromEntries(open.map(({ i, left }) => [i.id, { rec: String(left), dmg: '0', miss: '0' }])));
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/purchases/${po.id}/receive`, {
        additionalCost: toNum(extra), notes: notes || undefined,
        items: open.map(({ i }) => ({ purchaseItemId: i.id, qtyReceived: parseInt(rows[i.id].rec || '0', 10), qtyDamaged: parseInt(rows[i.id].dmg || '0', 10), qtyMissing: parseInt(rows[i.id].miss || '0', 10) })),
      });
      toast('Goods received. Accepted units were added to stock.');
      onDone();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const set = (id: number, k: 'rec' | 'dmg' | 'miss', v: string) => setRows({ ...rows, [id]: { ...rows[id], [k]: v } });
  return (
    <Modal open onClose={onClose} title="Receive goods" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Confirm receipt</Button></>}>
      <p className="mb-3 text-sm text-slate-600"><b>Delivered</b> includes damaged units. Only delivered minus damaged is added to saleable stock. <b>Missing</b> closes units the supplier will not deliver.</p>
      <div className="space-y-3">
        {open.map(({ i, left }) => (
          <div key={i.id} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium">{i.product.name} <span className="text-xs text-slate-500">{left} outstanding</span></p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Input label="Delivered" type="number" min={0} max={left} value={rows[i.id].rec} onChange={(e) => set(i.id, 'rec', e.target.value)} />
              <Input label="Of which damaged" type="number" min={0} value={rows[i.id].dmg} onChange={(e) => set(i.id, 'dmg', e.target.value)} />
              <Input label="Missing" type="number" min={0} value={rows[i.id].miss} onChange={(e) => set(i.id, 'miss', e.target.value)} />
            </div>
            <p className="mt-1 text-xs text-emerald-700">Adds {Math.max(0, toNum(rows[i.id].rec) - toNum(rows[i.id].dmg))} to stock</p>
          </div>
        ))}
        <Input label="Freight / delivery / other cost for this delivery" type="number" min={0} step="0.01" value={extra} onChange={(e) => setExtra(e.target.value)} hint="Spread over accepted units by value and included in their cost" />
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function PayModal({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(toNum(po.balance).toFixed(2));
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/purchases/${po.id}/payments`, { amount: toNum(amount), method, reference: reference || undefined }); toast('Payment recorded'); onDone(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Pay ${po.supplier.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save payment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">Outstanding: <b>{money(po.balance)}</b></p>
        <Input label="Amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>{['CASH', 'BANK_TRANSFER', 'CARD', 'QR'].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
    </Modal>
  );
}

function InvoiceModal({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [no, setNo] = useState(po.supplierInvoiceNo ?? '');
  const [total, setTotal] = useState(String(toNum(po.invoiceTotal)));
  const [notes, setNotes] = useState(po.notes ?? '');
  const submit = async () => {
    try { await api.put(`/purchases/${po.id}/invoice`, { supplierInvoiceNo: no, invoiceTotal: toNum(total), notes }); toast('Saved'); onDone(); }
    catch (e) { toast(errorText(e), 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Supplier invoice details" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Input label="Supplier invoice number" value={no} onChange={(e) => setNo(e.target.value)} />
        <Input label="Invoice total" type="number" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}
