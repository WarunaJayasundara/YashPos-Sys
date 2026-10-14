import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, type StockAdjustment } from '@prisma/client';
import { prisma, dateRange } from '../db.js';
import { ah, parse, badRequest, conflict, notFound } from '../lib/http.js';
import { can, requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { applyMovement } from '../services/inventory.js';

export const stockRouter = Router();

stockRouter.get('/movements', requirePerm('stock.view'), ah(async (req, res) => {
  const q = parse(z.object({
    from: z.string().optional(), to: z.string().optional(), productId: z.coerce.number().int().optional(),
    type: z.string().optional(), userId: z.coerce.number().int().optional(), limit: z.coerce.number().int().max(1000).default(300),
  }), req.query);
  const where: Prisma.StockMovementWhereInput = {};
  if (q.from || q.to) { const r = dateRange(q.from, q.to); where.createdAt = { gte: r.gte, lt: r.lt }; }
  if (q.productId) where.productId = q.productId;
  if (q.type) where.type = q.type as Prisma.EnumMovementTypeFilter['equals'];
  if (q.userId) where.userId = q.userId;
  const rows = await prisma.stockMovement.findMany({ where, orderBy: { id: 'desc' }, take: q.limit, include: { product: { select: { name: true, sku: true } } } });
  const users = new Map((await prisma.user.findMany({ select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const showCost = can(req, 'products.view_cost');
  res.json(rows.map((m) => ({ ...m, unitCost: showCost ? m.unitCost : undefined, user: users.get(m.userId) })));
}));

const adjustSchema = z.object({
  productId: z.number().int().positive(),
  type: z.enum(['DAMAGED', 'LOST', 'ADJUSTMENT', 'SUPPLIER_RETURN']),
  qtyChange: z.number().int().refine((n) => n !== 0, 'Quantity cannot be zero'),
  reason: z.string().trim().min(3).max(255),
});

async function apply(req: Request, a: StockAdjustment, approverId: number) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.stockAdjustment.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'APPROVED', approvedById: approverId, decidedAt: new Date() } });
    if (!r.count) throw conflict('Adjustment was already decided');
    await applyMovement(tx, { productId: a.productId, qtyChange: a.qtyChange, type: a.type, userId: approverId, refType: 'ADJUSTMENT', refId: a.id, reason: a.reason });
    await audit(req, 'stock.adjust_approve', 'stock_adjustment', a.id, { productId: a.productId, qtyChange: a.qtyChange, type: a.type }, tx);
  });
}

stockRouter.get('/adjustments', requirePerm('stock.adjust', 'stock.approve'), ah(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(await prisma.stockAdjustment.findMany({
    where: status ? { status } : {}, orderBy: { id: 'desc' }, take: 300, include: { product: { select: { name: true, sku: true, qtyOnHand: true } } },
  }));
}));

/** Requests an adjustment. Users with stock.approve apply it immediately; others wait for approval. */
stockRouter.post('/adjustments', requirePerm('stock.adjust'), ah(async (req, res) => {
  const body = parse(adjustSchema, req.body);
  if (body.type !== 'ADJUSTMENT' && body.qtyChange > 0) throw badRequest(`${body.type.toLowerCase().replace('_', ' ')} must reduce stock (use a negative quantity)`);
  if (!(await prisma.product.findUnique({ where: { id: body.productId } }))) throw notFound('Product not found');
  if (can(req, 'stock.approve')) {
    // request + apply in one transaction so a failed apply leaves nothing behind
    const id = await prisma.$transaction(async (tx) => {
      const a = await tx.stockAdjustment.create({ data: { ...body, status: 'APPROVED', requestedById: req.user!.id, approvedById: req.user!.id, decidedAt: new Date() } });
      await applyMovement(tx, { productId: a.productId, qtyChange: a.qtyChange, type: a.type, userId: req.user!.id, refType: 'ADJUSTMENT', refId: a.id, reason: a.reason });
      await audit(req, 'stock.adjust_approve', 'stock_adjustment', a.id, body, tx);
      return a.id;
    });
    return res.status(201).json(await prisma.stockAdjustment.findUnique({ where: { id } }));
  }
  const a = await prisma.stockAdjustment.create({ data: { ...body, status: 'PENDING', requestedById: req.user!.id } });
  await audit(req, 'stock.adjust_request', 'stock_adjustment', a.id, body);
  res.status(201).json(a);
}));

stockRouter.post('/adjustments/:id/decide', requirePerm('stock.approve'), ah(async (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const a = await prisma.stockAdjustment.findUnique({ where: { id: Number(req.params.id) } });
  if (!a) throw notFound();
  if (a.status !== 'PENDING') throw conflict('Adjustment was already decided');
  if (approve) await apply(req, a, req.user!.id);
  else {
    await prisma.stockAdjustment.update({ where: { id: a.id }, data: { status: 'REJECTED', approvedById: req.user!.id, decidedAt: new Date() } });
    await audit(req, 'stock.adjust_reject', 'stock_adjustment', a.id);
  }
  res.json(await prisma.stockAdjustment.findUnique({ where: { id: a.id } }));
}));
