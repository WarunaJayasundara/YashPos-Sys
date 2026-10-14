import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, dateRange, getSettings } from '../db.js';
import { ah, parse, forbidden, notFound, idParam } from '../lib/http.js';
import { can, requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { createSale, saleInclude, saleInputSchema, voidSale, approvalSchema } from '../services/sales.js';
import { createReturn, returnInputSchema } from '../services/returns.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';

export const salesRouter = Router();

type SaleFull = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

/** Cost and profit on a sale are owner data. */
export function presentSale(req: Request, s: SaleFull) {
  const showCost = can(req, 'products.view_cost');
  return {
    ...s,
    totalCost: showCost ? s.totalCost : undefined,
    items: s.items.map((i) => (showCost ? i : { ...i, unitCost: undefined })),
    returns: s.returns.map((r) => (showCost ? r : { ...r, costReversed: undefined })),
  };
}

async function loadVisibleSale(req: Request, id: number) {
  const s = await prisma.sale.findUnique({ where: { id }, include: saleInclude });
  if (!s) throw notFound('Sale not found');
  if (!can(req, 'sales.view_all') && s.cashierId !== req.user!.id) throw forbidden('You can only open your own sales');
  return s;
}

salesRouter.post('/', requirePerm('sales.create'), ah(async (req, res) => {
  const input = parse(saleInputSchema, req.body);
  const { sale, duplicate } = await createSale(req, input);
  res.status(duplicate ? 200 : 201).json({ duplicate, sale: presentSale(req, sale) });
}));

salesRouter.get('/', requirePerm('sales.view_own', 'sales.view_all'), ah(async (req, res) => {
  const q = parse(z.object({
    from: z.string().optional(), to: z.string().optional(), q: z.string().max(60).optional(),
    status: z.enum(['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED']).optional(), cashierId: z.coerce.number().int().optional(),
    method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT']).optional(), limit: z.coerce.number().int().max(500).default(100),
  }), req.query);
  const where: Prisma.SaleWhereInput = {};
  if (q.q) {
    where.OR = [{ invoiceNumber: { contains: q.q } }, { customerPhone: { contains: q.q } }, { customerName: { contains: q.q } }];
  } else {
    const r = dateRange(q.from, q.to);
    where.createdAt = { gte: r.gte, lt: r.lt };
  }
  if (q.status) where.status = q.status;
  if (q.method) where.payments = { some: { method: q.method } };
  if (!can(req, 'sales.view_all')) where.cashierId = req.user!.id;
  else if (q.cashierId) where.cashierId = q.cashierId;
  const rows = await prisma.sale.findMany({
    where, orderBy: { id: 'desc' }, take: q.limit,
    select: {
      id: true, invoiceNumber: true, status: true, createdAt: true, cashierName: true, customerName: true, customerPhone: true,
      total: true, balanceDue: true, payments: { select: { method: true, amount: true } }, _count: { select: { items: true } },
    },
  });
  res.json(rows);
}));

salesRouter.get('/:id', requirePerm('sales.view_own', 'sales.view_all'), ah(async (req, res) => {
  res.json(presentSale(req, await loadVisibleSale(req, idParam(req))));
}));

/** Data for the printable receipt (thermal or A4). Always the stored snapshot, never current prices. */
salesRouter.get('/:id/receipt', requirePerm('sales.view_own', 'sales.view_all', 'sales.create'), ah(async (req, res) => {
  const s = await loadVisibleSale(req, idParam(req));
  const settings = await getSettings();
  const out = presentSale(req, s);
  res.json({ sale: { ...out, totalCost: undefined, items: out.items.map((i) => ({ ...i, unitCost: undefined })) }, settings });
}));

salesRouter.get('/:id/invoice.pdf', requirePerm('sales.view_own', 'sales.view_all'), ah(async (req, res) => {
  const s = await loadVisibleSale(req, idParam(req));
  const settings = await getSettings();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${s.invoiceNumber}.pdf"`);
  await audit(req, 'sale.pdf', 'sale', s.id);
  renderInvoicePdf(s, settings, res);
}));

salesRouter.post('/:id/reprint', requirePerm('sales.view_own', 'sales.view_all'), ah(async (req, res) => {
  const s = await loadVisibleSale(req, idParam(req));
  await audit(req, 'sale.reprint', 'sale', s.id, { invoiceNumber: s.invoiceNumber });
  res.json({ ok: true });
}));

salesRouter.post('/:id/void', requirePerm('sales.create', 'sales.void'), ah(async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(255), approval: approvalSchema }), req.body);
  const s = await loadVisibleSale(req, idParam(req));
  res.json(presentSale(req, await voidSale(req, s.id, body.reason, body.approval)));
}));

export const returnsRouter = Router();

returnsRouter.post('/', requirePerm('returns.create', 'returns.approve'), ah(async (req, res) => {
  // any cashier may process a return: customers often come back to a different cashier
  res.status(201).json(await createReturn(req, parse(returnInputSchema, req.body)));
}));

/** Finds the original sale for a return by its invoice number. */
returnsRouter.get('/lookup', requirePerm('returns.create', 'returns.approve'), ah(async (req, res) => {
  const invoice = String(req.query.invoice ?? '').trim();
  const s = await prisma.sale.findUnique({ where: { invoiceNumber: invoice }, include: saleInclude });
  if (!s) throw notFound('No sale with that invoice number');
  res.json(presentSale(req, s));
}));

returnsRouter.get('/', requirePerm('returns.create', 'returns.approve', 'reports.sales'), ah(async (req, res) => {
  const q = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
  const r = dateRange(q.from, q.to);
  res.json(await prisma.return.findMany({
    where: { createdAt: { gte: r.gte, lt: r.lt } }, orderBy: { id: 'desc' },
    include: { sale: { select: { invoiceNumber: true } }, refunds: true, items: { include: { saleItem: { select: { productName: true, sku: true } } } } },
  }));
}));
