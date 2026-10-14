import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, nextSequence, getSettings, localToday, localDayStart, addDays } from '../db.js';
import { badRequest, conflict, notFound, HttpError } from '../lib/http.js';
import { allocate, fromCents, toCents } from '../lib/money.js';
import { resolveApproval } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { applyMovement } from './inventory.js';

const money = z.coerce.number().finite().min(0).max(100_000_000);
export const approvalSchema = z.object({ username: z.string().min(1), password: z.string().min(1) }).optional();

export const saleInputSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().min(1).max(10_000),
        unitPrice: money.optional(),
        lineDiscount: money.default(0),
        serialNumber: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(200),
  billDiscount: money.default(0),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT']),
        amount: money.refine((v) => v > 0, 'Amount must be positive'),
        reference: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(10),
  customer: z
    .object({ id: z.number().int().positive().optional(), name: z.string().max(120).optional(), phone: z.string().max(30).optional() })
    .optional(),
  notes: z.string().max(255).optional(),
  offlineCreatedAt: z.string().datetime().optional(),
  approval: approvalSchema,
});
export type SaleInput = z.infer<typeof saleInputSchema>;

export const saleInclude = {
  items: true,
  payments: true,
  customer: true,
  returns: { include: { items: true, refunds: true } },
} satisfies Prisma.SaleInclude;

/**
 * Creates a sale. Totals are always recomputed from server-side product data; the client
 * only proposes quantities, prices and discounts. Idempotent on clientRequestId.
 */
export async function createSale(req: Request, input: SaleInput) {
  const user = req.user!;
  const existing = await prisma.sale.findUnique({ where: { clientRequestId: input.clientRequestId }, include: saleInclude });
  if (existing) return { sale: existing, duplicate: true };

  const ids = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const settings = await getSettings();

  // ---- price and discount rules ----
  let needsOverride: string | null = null;
  const lines = input.items.map((it) => {
    const p = byId.get(it.productId);
    if (!p) throw badRequest(`Product ${it.productId} does not exist`);
    if (!p.isActive) throw badRequest(`${p.name} is inactive and cannot be sold`);
    const list = toCents(p.sellingPrice);
    const unit = it.unitPrice === undefined ? list : toCents(it.unitPrice);
    const gross = unit * it.qty;
    const lineDisc = toCents(it.lineDiscount);
    if (lineDisc > gross) throw badRequest(`Discount on ${p.name} exceeds the line amount`);
    const lineTotal = gross - lineDisc;
    if (lineTotal < toCents(p.minSellingPrice) * it.qty) needsOverride ??= `Selling ${p.name} below its minimum price`;
    return { it, p, list, unit, lineDisc, lineTotal };
  });

  const listTotal = lines.reduce((a, l) => a + l.list * l.it.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.unit * l.it.qty, 0);
  const lineDiscount = lines.reduce((a, l) => a + l.lineDisc, 0);
  const afterLines = subtotal - lineDiscount;
  const billDiscount = toCents(input.billDiscount);
  if (billDiscount > afterLines) throw badRequest('Bill discount exceeds the bill amount');
  const net = afterLines - billDiscount;
  const totalDiscount = listTotal - net;
  if (listTotal > 0 && totalDiscount > 0 && (totalDiscount * 100) / listTotal > user.maxDiscountPercent + 1e-9) {
    needsOverride ??= `A discount of ${((totalDiscount * 100) / listTotal).toFixed(1)}% (your limit is ${user.maxDiscountPercent}%)`;
  }
  const approvedBy = needsOverride ? await resolveApproval(req, 'discounts.override', input.approval, needsOverride) : null;

  const taxRate = Number(settings.taxRate);
  const tax = Math.round((net * taxRate) / 100);
  const total = net + tax;

  // ---- payments ----
  let cash = 0, nonCash = 0, credit = 0;
  for (const pm of input.payments) {
    const c = toCents(pm.amount);
    if (pm.method === 'CASH') cash += c;
    else if (pm.method === 'CREDIT') credit += c;
    else nonCash += c;
  }
  if (nonCash + credit > total) throw badRequest('Card/transfer/QR/credit payments exceed the bill total');
  const cashDue = total - nonCash - credit;
  if (cash < cashDue) throw new HttpError(422, `Payment is short by ${fromCents(cashDue - cash)}`, 'PAYMENT_SHORT');
  if (cash > 0 && cashDue === 0 && nonCash + credit === total) throw badRequest('Cash entered but nothing is left to pay in cash');
  const change = cash - cashDue;
  if (credit > 0 && !input.customer?.id && !input.customer?.phone) throw badRequest('Credit sales need a registered customer (phone number)');

  const allocBill = allocate(billDiscount, lines.map((l) => l.lineTotal));

  try {
    const saleId = await prisma.$transaction(
      async (tx) => {
        // customer: optional, matched by id or phone
        let customerId: number | null = null;
        if (input.customer?.id) {
          const c = await tx.customer.findUnique({ where: { id: input.customer.id } });
          if (!c) throw badRequest('Customer not found');
          customerId = c.id;
        } else if (input.customer?.phone) {
          const phone = input.customer.phone.trim();
          const c = await tx.customer.upsert({
            where: { phone },
            update: {},
            create: { phone, name: input.customer.name?.trim() || 'Walk-in customer' },
          });
          customerId = c.id;
        }

        const year = new Date().getFullYear();
        const seq = await nextSequence(tx, `INV-${year}`);
        const invoiceNumber = `${settings.invoicePrefix}-${year}-${String(seq).padStart(6, '0')}`;

        const sale = await tx.sale.create({
          data: {
            invoiceNumber,
            clientRequestId: input.clientRequestId,
            customerId,
            customerName: input.customer?.name?.trim() || null,
            customerPhone: input.customer?.phone?.trim() || null,
            cashierId: user.id,
            cashierName: user.fullName,
            subtotal: fromCents(subtotal),
            lineDiscount: fromCents(lineDiscount),
            billDiscount: fromCents(billDiscount),
            taxRate: taxRate.toFixed(2),
            taxAmount: fromCents(tax),
            total: fromCents(total),
            totalCost: '0',
            amountPaid: fromCents(total - credit),
            amountTendered: fromCents(cash),
            changeDue: fromCents(change),
            balanceDue: fromCents(credit),
            discountApprovedById: approvedBy,
            notes: input.notes,
            offlineCreatedAt: input.offlineCreatedAt ? new Date(input.offlineCreatedAt) : null,
          },
        });

        let totalCost = 0;
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const { unitCost } = await applyMovement(tx, {
            productId: l.p.id,
            qtyChange: -l.it.qty,
            type: 'SALE',
            userId: user.id,
            refType: 'SALE',
            refId: sale.id,
          });
          totalCost += Math.round(unitCost * l.it.qty * 100);
          const item = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: l.p.id,
              productName: l.p.name,
              sku: l.p.sku,
              qty: l.it.qty,
              listPrice: fromCents(l.list),
              unitPrice: fromCents(l.unit),
              lineDiscount: fromCents(l.lineDisc),
              lineTotal: fromCents(l.lineTotal),
              allocatedBillDiscount: fromCents(allocBill[i]),
              unitCost: unitCost.toFixed(4),
              serialNumber: l.it.serialNumber || null,
              warrantyMonths: l.p.warrantyMonths,
            },
          });
          if (l.p.warrantyMonths > 0) {
            const start = new Date();
            const end = new Date(start);
            end.setMonth(end.getMonth() + l.p.warrantyMonths);
            await tx.warranty.create({
              data: { saleId: sale.id, saleItemId: item.id, productId: l.p.id, serialNumber: l.it.serialNumber || null, startsAt: start, expiresAt: end },
            });
          }
        }

        const pays: Prisma.PaymentCreateManyInput[] = [];
        for (const pm of input.payments) {
          if (pm.method === 'CASH') continue;
          pays.push({ saleId: sale.id, method: pm.method, amount: fromCents(toCents(pm.amount)), reference: pm.reference });
        }
        if (cashDue > 0) pays.push({ saleId: sale.id, method: 'CASH', amount: fromCents(cashDue) });
        await tx.payment.createMany({ data: pays });
        await tx.sale.update({ where: { id: sale.id }, data: { totalCost: fromCents(totalCost) } });
        await audit(req, 'sale.create', 'sale', sale.id, { invoiceNumber, total: fromCents(total), approvedBy }, tx);
        return sale.id;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
    return { sale, duplicate: false };
  } catch (e) {
    // A concurrent duplicate submit lost the race on the unique key: return the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('clientRequestId')) {
      const s = await prisma.sale.findUnique({ where: { clientRequestId: input.clientRequestId }, include: saleInclude });
      if (s) return { sale: s, duplicate: true };
    }
    throw e;
  }
}

/** Void: same business day only, nothing returned yet. Restocks at the original cost. */
export async function voidSale(req: Request, saleId: number, reason: string, approval?: { username: string; password: string }) {
  const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } });
  if (!sale) throw notFound('Sale not found');
  if (sale.status !== 'COMPLETED') throw conflict(`Sale is ${sale.status.toLowerCase()} and cannot be voided`);
  const today = localToday();
  if (sale.createdAt < localDayStart(today) || sale.createdAt >= localDayStart(addDays(today, 1))) {
    throw conflict('Only sales from today can be voided. Use a return for older sales.', 'VOID_WINDOW');
  }
  const approvedBy = await resolveApproval(req, 'sales.void', approval, 'Voiding a sale');
  await prisma.$transaction(async (tx) => {
    const r = await tx.sale.updateMany({
      where: { id: saleId, status: 'COMPLETED' },
      data: { status: 'VOIDED', voidedAt: new Date(), voidedById: approvedBy, voidReason: reason },
    });
    if (r.count === 0) throw conflict('Sale was changed by someone else');
    for (const it of sale.items) {
      await applyMovement(tx, {
        productId: it.productId,
        qtyChange: it.qty,
        type: 'SALE_VOID',
        unitCost: Number(it.unitCost),
        updateAverage: true,
        userId: req.user!.id,
        refType: 'SALE',
        refId: sale.id,
        reason,
      });
    }
    await tx.warranty.deleteMany({ where: { saleId } });
    await audit(req, 'sale.void', 'sale', saleId, { invoiceNumber: sale.invoiceNumber, reason, approvedBy }, tx);
  });
  return prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleInclude });
}
