import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, parse, notFound } from '../lib/http.js';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

// Categories and brands share the same shape and rules.
function lookupRouter(model: 'category' | 'brand') {
  const r = Router();
  const delegate = () => (model === 'category' ? prisma.category : prisma.brand) as unknown as {
    findMany: (a: object) => Promise<unknown[]>;
    create: (a: object) => Promise<{ id: number }>;
    update: (a: object) => Promise<{ id: number }>;
    findUnique: (a: object) => Promise<unknown>;
  };
  const schema = z.object({ name: z.string().trim().min(2).max(80), isActive: z.boolean().optional() });

  r.get('/', requirePerm('products.view'), ah(async (_req, res) => {
    res.json(await delegate().findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } }));
  }));
  r.post('/', requirePerm('catalog.manage'), ah(async (req, res) => {
    const row = await delegate().create({ data: parse(schema, req.body) });
    await audit(req, `${model}.create`, model, row.id, req.body);
    res.status(201).json(row);
  }));
  r.put('/:id', requirePerm('catalog.manage'), ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await delegate().findUnique({ where: { id } }))) throw notFound();
    const row = await delegate().update({ where: { id }, data: parse(schema.partial(), req.body) });
    await audit(req, `${model}.update`, model, id, req.body);
    res.json(row);
  }));
  return r;
}

export const categoriesRouter = lookupRouter('category');
export const brandsRouter = lookupRouter('brand');

export const suppliersRouter = Router();
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactPerson: z.string().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(120).optional().nullable().or(z.literal('')),
  address: z.string().max(255).optional().nullable(),
  businessRegNo: z.string().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});

/** Balance = supplier invoice totals (non-cancelled) minus payments. */
async function supplierBalances() {
  const rows = await prisma.$queryRaw<{ supplierId: number; invoiced: string; paid: string }[]>`
    SELECT s.id supplierId,
      COALESCE((SELECT SUM(invoiceTotal) FROM purchase_orders po WHERE po.supplierId = s.id AND po.status NOT IN ('CANCELLED','DRAFT')), 0) invoiced,
      COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplierId = s.id), 0) paid
    FROM suppliers s`;
  return new Map(rows.map((r) => [Number(r.supplierId), { invoiced: Number(r.invoiced), paid: Number(r.paid), balance: Number(r.invoiced) - Number(r.paid) }]));
}

suppliersRouter.get('/', requirePerm('purchases.view', 'suppliers.manage'), ah(async (_req, res) => {
  const [rows, bal] = await Promise.all([prisma.supplier.findMany({ orderBy: { name: 'asc' } }), supplierBalances()]);
  res.json(rows.map((s) => ({ ...s, ...(bal.get(s.id) ?? { invoiced: 0, paid: 0, balance: 0 }) })));
}));

suppliersRouter.get('/:id', requirePerm('purchases.view', 'suppliers.manage'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const s = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchases: { orderBy: { purchaseDate: 'desc' }, take: 100 },
      payments: { orderBy: { paidAt: 'desc' }, take: 100 },
    },
  });
  if (!s) throw notFound('Supplier not found');
  const priceHistory = await prisma.$queryRaw<{ productId: number; name: string; sku: string; unitCost: string; purchaseDate: Date; poNumber: string }[]>`
    SELECT p.id productId, p.name, p.sku, pi.unitCost, po.purchaseDate, po.poNumber
    FROM purchase_items pi JOIN purchase_orders po ON po.id = pi.purchaseOrderId JOIN products p ON p.id = pi.productId
    WHERE po.supplierId = ${id} AND po.status <> 'CANCELLED' ORDER BY po.purchaseDate DESC LIMIT 200`;
  res.json({ ...s, ...((await supplierBalances()).get(id) ?? {}), priceHistory });
}));

suppliersRouter.post('/', requirePerm('suppliers.manage'), ah(async (req, res) => {
  const s = await prisma.supplier.create({ data: parse(supplierSchema, req.body) });
  await audit(req, 'supplier.create', 'supplier', s.id, { name: s.name });
  res.status(201).json(s);
}));

suppliersRouter.put('/:id', requirePerm('suppliers.manage'), ah(async (req, res) => {
  const s = await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: parse(supplierSchema.partial(), req.body) });
  await audit(req, 'supplier.update', 'supplier', s.id, req.body);
  res.json(s);
}));
