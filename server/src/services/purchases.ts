import type { Request } from 'express';
import { z } from 'zod';
import { prisma, nextSequence } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { allocate, fromCents, toCents } from '../lib/money.js';
import { audit } from '../lib/audit.js';
import { applyMovement } from './inventory.js';

const money = z.coerce.number().finite().min(0).max(100_000_000);

export const purchaseInputSchema = z.object({
  supplierId: z.number().int().positive(),
  supplierInvoiceNo: z.string().max(60).optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
  invoiceTotal: money.optional(),
  status: z.enum(['DRAFT', 'ORDERED']).default('ORDERED'),
  items: z
    .array(z.object({ productId: z.number().int().positive(), qtyOrdered: z.number().int().min(1).max(100_000), unitCost: money }))
    .min(1),
});

export const receiveInputSchema = z.object({
  additionalCost: money.default(0),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: z.number().int().positive(),
        qtyReceived: z.number().int().min(0),
        qtyDamaged: z.number().int().min(0).default(0),
        qtyMissing: z.number().int().min(0).default(0),
      }),
    )
    .min(1),
});

export async function createPurchase(req: Request, input: z.infer<typeof purchaseInputSchema>) {
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw badRequest('Supplier not found');
  const pids = [...new Set(input.items.map((i) => i.productId))];
  if (pids.length !== input.items.length) throw badRequest('Each product may appear once per purchase');
  const count = await prisma.product.count({ where: { id: { in: pids } } });
  if (count !== pids.length) throw badRequest('One or more products do not exist');
  const computed = input.items.reduce((a, i) => a + toCents(i.unitCost) * i.qtyOrdered, 0);
  return prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const seq = await nextSequence(tx, `PO-${year}`);
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber: `PO-${year}-${String(seq).padStart(5, '0')}`,
        supplierId: input.supplierId,
        supplierInvoiceNo: input.supplierInvoiceNo,
        purchaseDate: new Date(`${input.purchaseDate}T00:00:00Z`),
        notes: input.notes,
        status: input.status,
        invoiceTotal: fromCents(input.invoiceTotal === undefined ? computed : toCents(input.invoiceTotal)),
        createdById: req.user!.id,
        items: { create: input.items.map((i) => ({ productId: i.productId, qtyOrdered: i.qtyOrdered, unitCost: fromCents(toCents(i.unitCost)) })) },
      },
      include: { items: true },
    });
    await audit(req, 'purchase.create', 'purchase', po.id, { poNumber: po.poNumber, total: po.invoiceTotal }, tx);
    return po;
  });
}

/** Stock only increases here: accepted = received - damaged. Extra costs are allocated by value (landed cost). */
export async function receiveGoods(req: Request, purchaseId: number, input: z.infer<typeof receiveInputSchema>) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseId }, include: { items: { include: { product: true } } } });
  if (!po) throw notFound('Purchase not found');
  if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict(`Cannot receive against a ${po.status.toLowerCase()} purchase`);
  const byId = new Map(po.items.map((i) => [i.id, i]));
  const lines = input.items.map((r) => {
    const pi = byId.get(r.purchaseItemId);
    if (!pi) throw badRequest('Line does not belong to this purchase');
    if (r.qtyDamaged > r.qtyReceived) throw badRequest(`Damaged quantity of ${pi.product.name} exceeds quantity received`);
    const settled = pi.qtyReceived + pi.qtyDamaged + pi.qtyMissing;
    if (settled + r.qtyReceived + r.qtyMissing > pi.qtyOrdered) {
      throw badRequest(`${pi.product.name}: only ${pi.qtyOrdered - settled} unit(s) are still outstanding`);
    }
    return { r, pi, accepted: r.qtyReceived - r.qtyDamaged };
  });
  if (lines.every((l) => l.r.qtyReceived === 0 && l.r.qtyMissing === 0)) throw badRequest('Nothing to receive');

  const extra = allocate(toCents(input.additionalCost), lines.map((l) => l.accepted * toCents(l.pi.unitCost)));

  await prisma.$transaction(async (tx) => {
    const year = new Date().getFullYear();
    const seq = await nextSequence(tx, `GRN-${year}`);
    const grn = await tx.goodsReceipt.create({
      data: {
        receiptNumber: `GRN-${year}-${String(seq).padStart(5, '0')}`,
        purchaseOrderId: po.id,
        additionalCost: fromCents(toCents(input.additionalCost)),
        notes: input.notes,
        receivedById: req.user!.id,
      },
    });
    for (let i = 0; i < lines.length; i++) {
      const { r, pi, accepted } = lines[i];
      const base = Number(pi.unitCost);
      const landed = accepted > 0 ? base + extra[i] / 100 / accepted : base;
      await tx.goodsReceiptItem.create({
        data: {
          goodsReceiptId: grn.id, purchaseItemId: pi.id, qtyReceived: r.qtyReceived, qtyDamaged: r.qtyDamaged,
          qtyMissing: r.qtyMissing, qtyAccepted: accepted, landedUnitCost: landed.toFixed(4),
        },
      });
      await tx.purchaseItem.update({
        where: { id: pi.id },
        data: { qtyReceived: { increment: accepted }, qtyDamaged: { increment: r.qtyDamaged }, qtyMissing: { increment: r.qtyMissing } },
      });
      if (accepted > 0) {
        await applyMovement(tx, {
          productId: pi.productId, qtyChange: accepted, type: 'PURCHASE_RECEIPT', unitCost: landed, updateAverage: true,
          userId: req.user!.id, refType: 'GRN', refId: grn.id, reason: po.poNumber,
        });
        if (toCents(pi.product.purchasePrice) !== toCents(pi.unitCost)) {
          await tx.priceHistory.create({
            data: { productId: pi.productId, field: 'purchasePrice', oldValue: pi.product.purchasePrice, newValue: pi.unitCost, changedById: req.user!.id, reason: po.poNumber },
          });
          await tx.product.update({ where: { id: pi.productId }, data: { purchasePrice: pi.unitCost, supplierId: po.supplierId } });
        }
      }
    }
    const items = await tx.purchaseItem.findMany({ where: { purchaseOrderId: po.id } });
    const done = items.every((i) => i.qtyReceived + i.qtyDamaged + i.qtyMissing >= i.qtyOrdered);
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    await audit(req, 'purchase.receive', 'purchase', po.id, { grn: grn.receiptNumber, lines: input.items, additionalCost: input.additionalCost }, tx);
  });
  return prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: purchaseInclude });
}

export const purchaseInclude = {
  supplier: true,
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
  receipts: { include: { items: true }, orderBy: { receivedAt: 'asc' as const } },
  payments: { orderBy: { paidAt: 'asc' as const } },
};
