import { dateTime, METHOD_LABEL, plain, toNum } from '../lib/format';
import type { Sale, Settings } from '../lib/types';

const STATUS_NOTE: Record<string, string> = { VOIDED: '*** VOIDED ***', RETURNED: '*** RETURNED ***', PARTIALLY_RETURNED: '* partly returned *' };

/** Narrow thermal receipt (58 mm / 80 mm). Uses only the stored sale snapshot. */
export function Receipt({ sale, settings, width }: { sale: Sale; settings: Settings; width: '58' | '80' }) {
  const cur = settings.currency;
  const sub = toNum(sale.subtotal) - toNum(sale.lineDiscount);
  return (
    <div className={`receipt w${width}`} data-testid="receipt">
      <div className="center">
        {settings.logoUrl && <img src={settings.logoUrl} alt="" style={{ maxHeight: 48, margin: '0 auto 4px', filter: 'grayscale(1)' }} />}
        <div className="bold big">{settings.shopName}</div>
        {settings.address && <div>{settings.address}</div>}
        {settings.phone && <div>Tel: {settings.phone}</div>}
        {settings.taxRegNo && <div>{settings.taxLabel} Reg: {settings.taxRegNo}</div>}
      </div>
      <div className="rule" />
      <div className="row"><span>Invoice</span><span className="bold">{sale.invoiceNumber}</span></div>
      <div className="row"><span>Date</span><span>{dateTime(sale.createdAt)}</span></div>
      <div className="row"><span>Cashier</span><span>{sale.cashierName}</span></div>
      {(sale.customerName || sale.customerPhone) && <div className="row"><span>Customer</span><span>{[sale.customerName, sale.customerPhone].filter(Boolean).join(' ')}</span></div>}
      {STATUS_NOTE[sale.status] && <div className="center bold">{STATUS_NOTE[sale.status]}</div>}
      <div className="rule" />
      {sale.items.map((it) => (
        <div key={it.id} style={{ marginBottom: 3 }}>
          <div>{it.productName}</div>
          <div className="row">
            <span>{it.qty} x {plain(it.unitPrice)}{width === '80' ? `  ${it.sku}` : ''}</span>
            <span>{plain(toNum(it.unitPrice) * it.qty)}</span>
          </div>
          {toNum(it.lineDiscount) > 0 && <div className="row"><span>  Discount</span><span>-{plain(it.lineDiscount)}</span></div>}
          {it.serialNumber && <div>  S/N {it.serialNumber}</div>}
          {it.warrantyMonths > 0 && <div>  Warranty {it.warrantyMonths} month(s)</div>}
        </div>
      ))}
      <div className="rule" />
      <div className="row"><span>Subtotal</span><span>{plain(sub)}</span></div>
      {toNum(sale.billDiscount) > 0 && <div className="row"><span>Discount</span><span>-{plain(sale.billDiscount)}</span></div>}
      {toNum(sale.taxAmount) > 0 && <div className="row"><span>{settings.taxLabel} {toNum(sale.taxRate)}%</span><span>{plain(sale.taxAmount)}</span></div>}
      <div className="row bold big"><span>TOTAL {cur}</span><span>{plain(sale.total)}</span></div>
      <div className="rule" />
      {sale.payments.map((p) => <div key={p.id} className="row"><span>{METHOD_LABEL[p.method]}{p.reference ? ` (${p.reference})` : ''}</span><span>{plain(p.amount)}</span></div>)}
      {toNum(sale.amountTendered) > 0 && <>
        <div className="row"><span>Cash received</span><span>{plain(sale.amountTendered)}</span></div>
        <div className="row bold"><span>Change</span><span>{plain(sale.changeDue)}</span></div>
      </>}
      {toNum(sale.balanceDue) > 0 && <div className="row bold"><span>Balance due</span><span>{plain(sale.balanceDue)}</span></div>}
      {sale.returns.map((r) => <div key={r.id} className="row"><span>Returned {r.returnNumber}</span><span>-{plain(r.refundTotal)}</span></div>)}
      {sale.notes && <div style={{ marginTop: 3 }}>Note: {sale.notes}</div>}
      <div className="rule" />
      {settings.warrantyPolicy && sale.items.some((i) => i.warrantyMonths > 0) && <div style={{ fontSize: '0.85em', marginBottom: 4 }}>{settings.warrantyPolicy}</div>}
      <div className="center">{settings.receiptFooter}</div>
      <div className="center" style={{ fontSize: '0.8em', marginTop: 4 }}>{sale.items.reduce((a, i) => a + i.qty, 0)} item(s)</div>
    </div>
  );
}

/** A4 invoice for customers who need a full document. */
export function A4Invoice({ sale, settings }: { sale: Sale; settings: Settings }) {
  const cur = settings.currency;
  return (
    <div className="a4 p-6" data-testid="a4-invoice">
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-4">
        <div className="flex items-start gap-3">
          {settings.logoUrl && <img src={settings.logoUrl} alt="" className="h-16 w-16 object-contain" />}
          <div>
            <h1 className="text-2xl font-extrabold tracking-wide">{settings.shopName}</h1>
            {settings.address && <p>{settings.address}</p>}
            <p>{[settings.phone && `Tel: ${settings.phone}`, settings.email].filter(Boolean).join(' · ')}</p>
            {settings.taxRegNo && <p>{settings.taxLabel} Reg. No: {settings.taxRegNo}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{sale.status === 'VOIDED' ? 'INVOICE (VOID)' : 'INVOICE'}</p>
          <p>No: <b>{sale.invoiceNumber}</b></p>
          <p>{dateTime(sale.createdAt)}</p>
          <p>Cashier: {sale.cashierName}</p>
        </div>
      </header>
      {(sale.customerName || sale.customerPhone) && <p className="mt-3"><b>Bill to:</b> {[sale.customerName, sale.customerPhone].filter(Boolean).join(' · ')}</p>}
      <table className="mt-4 w-full border-collapse">
        <thead><tr className="bg-slate-100 text-left">
          <th className="p-2">#</th><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit price</th><th className="p-2 text-right">Discount</th><th className="p-2 text-right">Amount</th>
        </tr></thead>
        <tbody>
          {sale.items.map((it, i) => (
            <tr key={it.id} className="border-b border-slate-200 align-top">
              <td className="p-2">{i + 1}</td>
              <td className="p-2">{it.productName}<div className="text-[10px] text-slate-500">SKU {it.sku}{it.serialNumber ? ` · S/N ${it.serialNumber}` : ''}{it.warrantyMonths ? ` · Warranty ${it.warrantyMonths} months` : ''}</div></td>
              <td className="p-2 text-right">{it.qty}</td>
              <td className="p-2 text-right">{plain(it.unitPrice)}</td>
              <td className="p-2 text-right">{toNum(it.lineDiscount) ? plain(it.lineDiscount) : '-'}</td>
              <td className="p-2 text-right">{plain(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-72 space-y-1">
        <Row k="Subtotal" v={plain(toNum(sale.subtotal) - toNum(sale.lineDiscount))} />
        {toNum(sale.billDiscount) > 0 && <Row k="Bill discount" v={`-${plain(sale.billDiscount)}`} />}
        {toNum(sale.taxAmount) > 0 && <Row k={`${settings.taxLabel} (${toNum(sale.taxRate)}%)`} v={plain(sale.taxAmount)} />}
        <Row k={`Grand total (${cur})`} v={plain(sale.total)} bold />
        {sale.payments.map((p) => <Row key={p.id} k={`Paid - ${METHOD_LABEL[p.method]}`} v={plain(p.amount)} />)}
        {toNum(sale.amountTendered) > 0 && <><Row k="Cash received" v={plain(sale.amountTendered)} /><Row k="Change" v={plain(sale.changeDue)} /></>}
        {toNum(sale.balanceDue) > 0 && <Row k="Balance due" v={plain(sale.balanceDue)} bold />}
        {sale.returns.map((r) => <Row key={r.id} k={`Returned ${r.returnNumber}`} v={`-${plain(r.refundTotal)}`} />)}
      </div>
      {sale.notes && <p className="mt-6"><b>Note:</b> {sale.notes}</p>}
      {settings.warrantyPolicy && <div className="mt-8 text-[11px] text-slate-600"><b>Warranty:</b> {settings.warrantyPolicy}</div>}
      <p className="mt-8 text-center">{settings.receiptFooter}</p>
    </div>
  );
}

const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <div className={`flex justify-between ${bold ? 'border-t border-slate-800 pt-1 text-base font-bold' : ''}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>
);
