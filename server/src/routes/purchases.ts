import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, dateRange } from '../db.js';
import { ah, parse, badRequest, conflict, notFound, idParam } from '../lib/http.js';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { fromCents, toCents } from '../lib/money.js';
import { createPurchase, purchaseInclude, purchaseInputSchema, receiveGoods, receiveInputSchema } from '../services/purchases.js';

export const purchasesRouter = Router();

purchasesRouter.get('/', requirePerm('purchases.view'), ah(async (req, res) => {
  const q = parse(z.object({
    from: z.string().optional(), to: z.string().optional(), supplierId: z.coerce.number().int().optional(),
    status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(), q: z.string().optional(),
  }), req.query);
  const where: Prisma.PurchaseOrderWhereInput = {};
  if (q.from || q.to) {
    const r = dateRange(q.from, q.to ?? q.from);
    where.purchaseDate = { gte: new Date(`${r.from}T00:00:00Z`), lte: new Date(`${r.to}T00:00:00Z`) };
  }
  if (q.supplierId) where.supplierId = q.supplierId;
  if (q.status) where.status = q.status;
  if (q.q) where.OR = [{ poNumber: { contains: q.q } }, { supplierInvoiceNo: { contains: q.q } }];
  const rows = await prisma.purchaseOrder.findMany({
    where, orderBy: { id: 'desc' }, take: 300,
    include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
  });
  res.json(rows.map((p) => ({ ...p, balance: fromCents(toCents(p.invoiceTotal) - toCents(p.amountPaid)) })));
}));

purchasesRouter.get('/:id', requirePerm('purchases.view'), ah(async (req, res) => {
  const p = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: purchaseInclude });
  if (!p) throw notFound('Purchase not found');
  res.json({ ...p, balance: fromCents(toCents(p.invoiceTotal) - toCents(p.amountPaid)) });
}));

purchasesRouter.post('/', requirePerm('purchases.manage'), ah(async (req, res) => {
  res.status(201).json(await createPurchase(req, parse(purchaseInputSchema, req.body)));
}));

purchasesRouter.post('/:id/order', requirePerm('purchases.manage'), ah(async (req, res) => {
  const r = await prisma.purchaseOrder.updateMany({ where: { id: idParam(req), status: 'DRAFT' }, data: { status: 'ORDERED' } });
  if (!r.count) throw conflict('Only draft purchases can be marked as ordered');
  await audit(req, 'purchase.order', 'purchase', req.params.id);
  res.json({ ok: true });
}));

purchasesRouter.post('/:id/receive', requirePerm('purchases.manage'), ah(async (req, res) => {
  res.json(await receiveGoods(req, idParam(req), parse(receiveInputSchema, req.body)));
}));

purchasesRouter.put('/:id/invoice', requirePerm('purchases.manage'), ah(async (req, res) => {
  const body = parse(z.object({ supplierInvoiceNo: z.string().max(60).optional(), invoiceTotal: z.coerce.number().min(0).optional(), notes: z.string().max(2000).optional() }), req.body);
  const po = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) } });
  if (!po) throw notFound();
  if (body.invoiceTotal !== undefined && toCents(body.invoiceTotal) < toCents(po.amountPaid)) throw badRequest('Invoice total cannot be less than the amount already paid');
  const updated = await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { ...body, invoiceTotal: body.invoiceTotal === undefined ? undefined : fromCents(toCents(body.invoiceTotal)) },
  });
  await audit(req, 'purchase.update_invoice', 'purchase', po.id, body);
  res.json(updated);
}));

purchasesRouter.post('/:id/cancel', requirePerm('purchases.manage'), ah(async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: idParam(req) }, include: { receipts: true, payments: true } });
  if (!po) throw notFound();
  if (po.receipts.length || po.payments.length) throw conflict('Purchases with receipts or payments cannot be cancelled');
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'CANCELLED' } });
  await audit(req, 'purchase.cancel', 'purchase', po.id);
  res.json({ ok: true });
}));

purchasesRouter.post('/:id/payments', requirePerm('purchases.pay'), ah(async (req, res) => {
  const body = parse(z.object({
    amount: z.coerce.number().positive(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR']), reference: z.string().max(80).optional(),
    paidAt: z.string().datetime().optional(),
  }), req.body);
  const id = idParam(req);
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ invoiceTotal: string; amountPaid: string; supplierId: number; status: string }[]>`
      SELECT invoiceTotal, amountPaid, supplierId, status FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound();
    const po = rows[0];
    if (po.status === 'CANCELLED') throw conflict('Cannot pay a cancelled purchase');
    const outstanding = toCents(po.invoiceTotal) - toCents(po.amountPaid);
    const amt = toCents(body.amount);
    if (amt > outstanding) throw badRequest(`Payment exceeds the outstanding balance of ${fromCents(outstanding)}`);
    const pay = await tx.supplierPayment.create({
      data: { supplierId: Number(po.supplierId), purchaseOrderId: id, amount: fromCents(amt), method: body.method, reference: body.reference, paidAt: body.paidAt ? new Date(body.paidAt) : new Date(), recordedById: req.user!.id },
    });
    await tx.purchaseOrder.update({ where: { id }, data: { amountPaid: fromCents(toCents(po.amountPaid) + amt) } });
    await audit(req, 'purchase.payment', 'purchase', id, { amount: fromCents(amt), method: body.method }, tx);
    return pay;
  });
  res.status(201).json(result);
}));
