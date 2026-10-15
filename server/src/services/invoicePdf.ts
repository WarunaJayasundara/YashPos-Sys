import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import type { Writable } from 'node:stream';
import type { BusinessSettings, Prisma } from '@prisma/client';
import type { saleInclude } from './sales.js';

type SaleFull = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

const money = (v: { toString(): string } | number, cur: string) =>
  `${cur} ${Number(v.toString()).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD: Record<string, string> = { CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', QR: 'QR payment', CREDIT: 'On account' };

/** A4 PDF invoice from the stored sale snapshot. */
export function renderInvoicePdf(s: SaleFull, st: BusinessSettings, out: Writable) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${s.invoiceNumber}`, Author: st.shopName } });
  doc.pipe(out);
  const cur = st.currency;
  const left = 48, right = 547;

  if (st.logoUrl?.startsWith('/uploads/')) {
    const file = path.resolve('uploads', path.basename(st.logoUrl));
    if (fs.existsSync(file) && /\.(png|jpe?g)$/i.test(file)) doc.image(file, left, 44, { fit: [64, 64] });
  }
  const tx = st.logoUrl ? left + 76 : left;
  doc.font('Helvetica-Bold').fontSize(20).text(st.shopName, tx, 48);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  if (st.address) doc.text(st.address, tx);
  if (st.phone) doc.text(`Tel: ${st.phone}`, tx);
  if (st.email) doc.text(st.email, tx);
  if (st.taxRegNo) doc.text(`${st.taxLabel} Reg. No: ${st.taxRegNo}`, tx);

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text(s.status === 'VOIDED' ? 'INVOICE (VOID)' : 'INVOICE', 350, 48, { width: right - 350, align: 'right' });
  doc.font('Helvetica').fontSize(9);
  const meta = [
    ['Invoice No', s.invoiceNumber],
    ['Date', s.createdAt.toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })],
    ['Cashier', s.cashierName],
  ];
  if (s.customerName || s.customerPhone) meta.push(['Customer', [s.customerName, s.customerPhone].filter(Boolean).join(' / ')]);
  let y = 72;
  for (const [k, v] of meta) { doc.text(`${k}: ${v}`, 300, y, { width: right - 300, align: 'right' }); y += 13; }

  y = Math.max(y, doc.y) + 18;
  const cols = [left, left + 230, left + 300, left + 380, left + 440];
  doc.rect(left, y - 4, right - left, 18).fill('#eef1f6').fillColor('#000').font('Helvetica-Bold');
  ['Item', 'Qty', 'Unit price', 'Discount', 'Amount'].forEach((h, i) =>
    doc.text(h, cols[i], y, { width: i === 0 ? 225 : (cols[i + 1] ?? right) - cols[i], align: i === 0 ? 'left' : 'right' }));
  y += 20;
  doc.font('Helvetica');
  for (const it of s.items) {
    if (y > 720) { doc.addPage(); y = 48; }
    doc.fontSize(9).text(it.productName, cols[0], y, { width: 225 });
    const h = doc.heightOfString(it.productName, { width: 225 });
    doc.fontSize(7).fillColor('#666').text(`SKU ${it.sku}${it.serialNumber ? `  S/N ${it.serialNumber}` : ''}${it.warrantyMonths ? `  Warranty ${it.warrantyMonths} mo` : ''}`, cols[0], y + h, { width: 225 });
    doc.fillColor('#000').fontSize(9);
    doc.text(String(it.qty), cols[1], y, { width: 70, align: 'right' });
    doc.text(money(it.unitPrice, cur), cols[2], y, { width: 80, align: 'right' });
    doc.text(Number(it.lineDiscount) ? money(it.lineDiscount, cur) : '-', cols[3], y, { width: 60, align: 'right' });
    doc.text(money(it.lineTotal, cur), cols[4], y, { width: right - cols[4], align: 'right' });
    y += h + 14;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor('#e3e6ea').stroke();
  }

  const totals: [string, string, boolean?][] = [['Subtotal', money(Number(s.subtotal) - Number(s.lineDiscount), cur)]];
  if (Number(s.billDiscount)) totals.push(['Bill discount', `- ${money(s.billDiscount, cur)}`]);
  if (Number(s.taxAmount)) totals.push([`${st.taxLabel} (${Number(s.taxRate)}%)`, money(s.taxAmount, cur)]);
  totals.push(['Grand total', money(s.total, cur), true]);
  for (const p of s.payments) totals.push([`Paid - ${METHOD[p.method]}`, money(p.amount, cur)]);
  if (Number(s.amountTendered)) totals.push(['Cash received', money(s.amountTendered, cur)], ['Change', money(s.changeDue, cur)]);
  if (Number(s.balanceDue)) totals.push(['Balance due', money(s.balanceDue, cur), true]);
  y += 6;
  for (const [k, v, bold] of totals) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
    doc.text(k, 330, y, { width: 110, align: 'right' });
    doc.text(v, 440, y, { width: right - 440, align: 'right' });
    y += bold ? 17 : 13;
  }
  for (const r of s.returns) {
    doc.font('Helvetica').fontSize(8).fillColor('#a00').text(`Returned ${r.returnNumber} on ${r.createdAt.toLocaleDateString('en-GB')}: refund ${money(r.refundTotal, cur)}`, left, y + 4);
    y += 12;
  }
  doc.fillColor('#000');
  y += 24;
  if (s.notes) { doc.font('Helvetica-Bold').fontSize(9).text('Note: ', left, y, { continued: true }).font('Helvetica').text(s.notes, { width: right - left }); y = doc.y + 10; }
  if (st.warrantyPolicy) { doc.font('Helvetica-Bold').fontSize(8).text('Warranty', left, y); doc.font('Helvetica').text(st.warrantyPolicy, left, doc.y, { width: right - left }); y = doc.y + 10; }
  doc.font('Helvetica').fontSize(9).text(st.receiptFooter, left, y, { width: right - left, align: 'center' });
  doc.end();
}
