import type { Request } from 'express';
import { z } from 'zod';
import { prisma, nextSequence } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { fromCents, toCents } from '../lib/money.js';
import { resolveApproval } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { applyMovement } from './inventory.js';
import { approvalSchema } from './sales.js';

export const returnInputSchema = z.object({
  saleId: z.number().int().positive(),
  items: z
    .array(z.object({ saleItemId: z.number().int().positive(), qty: z.number().int().min(1), restock: z.boolean() }))
    .min(1),
  reason: z.string().min(3).max(255),
  type: z.enum(['REFUND', 'EXCHANGE']).default('REFUND'),
  refundMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT']).default('CASH'),
  approval: approvalSchema,
});
export type ReturnInput = z.infer<typeof returnInputSchema>;

/** Refund for units [before, before+n) of a line, so repeated partial returns sum exactly to the line's net. */
function refundSlice(lineNetCents: number, lineQty: number, before: number, n: number) {
  return Math.round((lineNetCents * (before + n)) / lineQty) - Math.round((lineNetCents * before) / lineQty);
}

export async function createReturn(req: Request, input: ReturnInput) {
  const sale = await prisma.sale.findUnique({ where: { id: input.saleId }, include: { items: true } });
  if (!sale) throw notFound('Sale not found');
  if (sale.status === 'VOIDED' || sale.status === 'RETURNED') throw conflict(`Sale is already ${sale.status.toLowerCase()}`);
  if (input.refundMethod === 'CREDIT' && !sale.customerId) throw badRequest('Store credit refunds need a customer on the sale');
  const approvedBy = await resolveApproval(req, 'returns.approve', input.approval, 'A return/refund');

  const itemsById = new Map(sale.items.map((i) => [i.id, i]));
  const seen = new Set<number>();
  for (const r of input.items) {
    const si = itemsById.get(r.saleItemId);
    if (!si) throw badRequest('Item does not belong to this sale');
    if (seen.has(r.saleItemId)) throw badRequest('Each sale line may appear once per return');
    seen.add(r.saleItemId);
    if (r.qty > si.qty - si.qtyReturned) throw badRequest(`Only ${si.qty - si.qtyReturned} of ${si.productName} can still be returned`);
  }
  const taxRate = Number(sale.taxRate);

  const id = await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const seq = await nextSequence(tx, `RET-${year}`);
    const ret = await tx.return.create({
      data: {
        returnNumber: `RT-${year}-${String(seq).padStart(5, '0')}`,
        saleId: sale.id,
        reason: input.reason,
        type: input.type,
        refundTotal: '0',
        costReversed: '0',
        processedById: req.user!.id,
        approvedById: approvedBy,
      },
    });
    let refundNet = 0, costReversed = 0;
    for (const r of input.items) {
      const si = itemsById.get(r.saleItemId)!;
      // conditional increment guards against two returns of the same units at once
      const ok = await tx.$executeRaw`
        UPDATE sale_items SET qtyReturned = qtyReturned + ${r.qty} WHERE id = ${si.id} AND qtyReturned + ${r.qty} <= qty`;
      if (ok === 0) throw conflict(`${si.productName} was already returned`);
      const fresh = await tx.saleItem.findUniqueOrThrow({ where: { id: si.id } });
      const before = fresh.qtyReturned - r.qty;
      const lineNet = toCents(si.lineTotal) - toCents(si.allocatedBillDiscount);
      const amount = refundSlice(lineNet, si.qty, before, r.qty);
      refundNet += amount;
      await tx.returnItem.create({ data: { returnId: ret.id, saleItemId: si.id, qty: r.qty, restock: r.restock, refundAmount: fromCents(amount) } });
      const unitCost = Number(si.unitCost);
      await applyMovement(tx, {
        productId: si.productId, qtyChange: r.qty, type: 'CUSTOMER_RETURN', unitCost, updateAverage: true,
        userId: req.user!.id, refType: 'RETURN', refId: ret.id, reason: input.reason,
      });
      if (r.restock) {
        costReversed += Math.round(unitCost * r.qty * 100);
      } else {
        await applyMovement(tx, {
          productId: si.productId, qtyChange: -r.qty, type: 'DAMAGED', unitCost,
          userId: req.user!.id, refType: 'RETURN', refId: ret.id, reason: `Returned damaged: ${input.reason}`,
        });
      }
      if (fresh.qtyReturned >= fresh.qty) {
        await tx.warranty.updateMany({ where: { saleItemId: si.id }, data: { claimStatus: 'CLOSED', resolution: `Item returned (${ret.returnNumber})` } });
      }
    }
    const refundTax = Math.round((refundNet * taxRate) / 100);
    const refundTotal = refundNet + refundTax;
    await tx.return.update({ where: { id: ret.id }, data: { refundTotal: fromCents(refundTotal), costReversed: fromCents(costReversed) } });
    if (refundTotal > 0) await tx.refund.create({ data: { returnId: ret.id, method: input.refundMethod, amount: fromCents(refundTotal) } });

    const items = await tx.saleItem.findMany({ where: { saleId: sale.id } });
    const all = items.every((i) => i.qtyReturned >= i.qty);
    await tx.sale.update({ where: { id: sale.id }, data: { status: all ? 'RETURNED' : 'PARTIALLY_RETURNED' } });
    await audit(req, 'return.create', 'return', ret.id, { saleId: sale.id, invoice: sale.invoiceNumber, refundTotal: fromCents(refundTotal), approvedBy }, tx);
    return ret.id;
  });
  return prisma.return.findUniqueOrThrow({ where: { id }, include: { items: { include: { saleItem: true } }, refunds: true, sale: true } });
}
