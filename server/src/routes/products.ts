import { Router, type Request } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { Prisma, type Product } from '@prisma/client';
import { prisma, nextSequence, type Tx } from '../db.js';
import { ah, parse, badRequest, notFound } from '../lib/http.js';
import { can, requirePerm, resolveApproval } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { toCents, fromCents, num } from '../lib/money.js';
import { parseCsv, sendCsv, toCsv } from '../lib/csv.js';
import { applyMovement } from '../services/inventory.js';
import { approvalSchema } from '../services/sales.js';

export const productsRouter = Router();

/** EAN-8/UPC-A/EAN-13 must have a valid check digit; other codes (Code 128 etc.) just need safe characters. */
export function validBarcode(code: string) {
  if (/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) {
    const d = code.split('').map(Number);
    const check = d.pop()!;
    const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  return /^[A-Za-z0-9\-.]{4,40}$/.test(code);
}

const opt = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable();
const money = z.coerce.number().finite().min(0).max(100_000_000);

const productSchema = z
  .object({
    // optional: generated when left empty
    sku: opt(z.string().trim().max(40).refine((v) => v === '' || /^[A-Za-z0-9\-_.]{2,40}$/.test(v), 'SKU may contain letters, digits, - _ .')),
    barcode: opt(z.string().trim().max(40)),
    name: z.string().trim().min(2).max(160),
    description: opt(z.string().max(5000)),
    categoryId: opt(z.number().int().positive()),
    brandId: opt(z.number().int().positive()),
    supplierId: opt(z.number().int().positive()),
    variantGroup: opt(z.string().trim().max(60)),
    compatibility: opt(z.string().trim().max(255)),
    color: opt(z.string().trim().max(40)),
    size: opt(z.string().trim().max(40)),
    connectorType: opt(z.string().trim().max(40)),
    purchasePrice: money.default(0),
    sellingPrice: money,
    minSellingPrice: opt(money), // defaults to the selling price
    reorderLevel: z.number().int().min(0).max(100_000).default(5),
    maxStockLevel: opt(z.number().int().min(0).max(1_000_000)),
    warrantyMonths: z.number().int().min(0).max(120).default(0),
    imageUrl: opt(z.string().max(255)),
    isActive: z.boolean().default(true),
    openingStock: z.number().int().min(0).max(1_000_000).default(0),
  })
  .refine((p) => p.minSellingPrice == null || p.minSellingPrice <= p.sellingPrice, { message: 'Minimum price cannot exceed the selling price', path: ['minSellingPrice'] })
  .refine((p) => !p.barcode || validBarcode(p.barcode), { message: 'Barcode is not valid (check digit or characters)', path: ['barcode'] });

export function stockStatus(p: Pick<Product, 'qtyOnHand' | 'qtyReserved' | 'reorderLevel' | 'maxStockLevel'>) {
  const avail = p.qtyOnHand - p.qtyReserved;
  if (avail <= 0) return 'OUT';
  if (avail <= p.reorderLevel) return 'LOW';
  if (p.maxStockLevel != null && p.qtyOnHand > p.maxStockLevel) return 'OVER';
  return 'OK';
}

/** Next free automatic SKU, e.g. P-00042 (skips any taken by hand). */
export async function generateSku(tx: Tx) {
  for (;;) {
    const sku = `P-${String(await nextSequence(tx, 'SKU')).padStart(5, '0')}`;
    if (!(await tx.product.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
}

type ProductWithRels = Product & { category?: { name: string } | null; brand?: { name: string } | null; supplier?: { name: string } | null };

/** Strips cost and margin fields for users without products.view_cost. */
export function presentProduct(req: Request, p: ProductWithRels) {
  const base = {
    id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, description: p.description,
    categoryId: p.categoryId, category: p.category?.name, brandId: p.brandId, brand: p.brand?.name,
    variantGroup: p.variantGroup, compatibility: p.compatibility, color: p.color, size: p.size, connectorType: p.connectorType,
    sellingPrice: p.sellingPrice, minSellingPrice: p.minSellingPrice, qtyOnHand: p.qtyOnHand, qtyReserved: p.qtyReserved,
    qtyAvailable: p.qtyOnHand - p.qtyReserved, reorderLevel: p.reorderLevel, maxStockLevel: p.maxStockLevel,
    warrantyMonths: p.warrantyMonths, imageUrl: p.imageUrl, isActive: p.isActive, stockStatus: stockStatus(p),
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
  if (!can(req, 'products.view_cost')) return base;
  const sell = num(p.sellingPrice);
  const cost = num(p.avgCost);
  return {
    ...base,
    supplierId: p.supplierId, supplier: p.supplier?.name, purchasePrice: p.purchasePrice, avgCost: p.avgCost,
    unitProfit: fromCents(toCents(sell) - toCents(cost)),
    marginPercent: sell > 0 ? Number((((sell - cost) / sell) * 100).toFixed(1)) : null,
  };
}

const include = { category: { select: { name: true } }, brand: { select: { name: true } }, supplier: { select: { name: true } } };

const listQuery = z.object({
  q: z.string().max(100).optional(),
  categoryId: z.coerce.number().int().optional(),
  brandId: z.coerce.number().int().optional(),
  supplierId: z.coerce.number().int().optional(),
  status: z.enum(['LOW', 'OUT', 'OVER', 'OK']).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(['name', 'sku', 'qty', 'updated', 'price']).default('name'),
});

async function findProducts(q: z.infer<typeof listQuery>, all = false) {
  const where: Prisma.ProductWhereInput = {};
  if (q.active !== 'all') where.isActive = q.active === 'true';
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.brandId) where.brandId = q.brandId;
  if (q.supplierId) where.supplierId = q.supplierId;
  if (q.q) {
    const s = q.q.trim();
    where.OR = [
      { name: { contains: s } }, { sku: { contains: s } }, { barcode: s }, { compatibility: { contains: s } },
      { brand: { name: { contains: s } } }, { connectorType: { contains: s } }, { color: { contains: s } },
    ];
  }
  // stock status compares two columns, so resolve matching ids with SQL first
  if (q.status) {
    const cond = {
      OUT: Prisma.sql`qtyOnHand - qtyReserved <= 0`,
      LOW: Prisma.sql`qtyOnHand - qtyReserved > 0 AND qtyOnHand - qtyReserved <= reorderLevel`,
      OVER: Prisma.sql`maxStockLevel IS NOT NULL AND qtyOnHand > maxStockLevel AND qtyOnHand - qtyReserved > reorderLevel`,
      OK: Prisma.sql`qtyOnHand - qtyReserved > reorderLevel AND (maxStockLevel IS NULL OR qtyOnHand <= maxStockLevel)`,
    }[q.status];
    const ids = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM products WHERE ${cond}`;
    where.id = { in: ids.map((r) => r.id) };
  }
  const orderBy: Prisma.ProductOrderByWithRelationInput = {
    name: { name: 'asc' as const }, sku: { sku: 'asc' as const }, qty: { qtyOnHand: 'asc' as const },
    updated: { updatedAt: 'desc' as const }, price: { sellingPrice: 'asc' as const },
  }[q.sort];
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include, orderBy, ...(all ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }) }),
  ]);
  return { total, rows };
}

productsRouter.get(
  '/',
  requirePerm('products.view'),
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const { total, rows } = await findProducts(q);
    res.json({ total, page: q.page, pageSize: q.pageSize, data: rows.map((p) => presentProduct(req, p)) });
  }),
);

/** Lightweight catalogue for POS search and the offline cache: no cost fields, ever. */
productsRouter.get(
  '/catalog',
  requirePerm('products.view'),
  ah(async (_req, res) => {
    const rows = await prisma.product.findMany({ where: { isActive: true }, include: { brand: { select: { name: true } }, category: { select: { name: true } } }, orderBy: { name: 'asc' } });
    res.json({
      syncedAt: new Date().toISOString(),
      data: rows.map((p) => ({
        id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, brand: p.brand?.name, category: p.category?.name ?? null, categoryId: p.categoryId,
        compatibility: p.compatibility, color: p.color, connectorType: p.connectorType, sellingPrice: p.sellingPrice,
        minSellingPrice: p.minSellingPrice, qtyAvailable: p.qtyOnHand - p.qtyReserved, warrantyMonths: p.warrantyMonths, imageUrl: p.imageUrl,
      })),
    });
  }),
);

productsRouter.get(
  '/export',
  requirePerm('products.manage'),
  ah(async (req, res) => {
    const { rows } = await findProducts(parse(listQuery, req.query), true);
    const data = rows.map((p) => presentProduct(req, p)) as Record<string, unknown>[];
    const cols = ['sku', 'barcode', 'name', 'category', 'brand', 'compatibility', 'color', 'size', 'connectorType', 'sellingPrice', 'minSellingPrice', 'qtyOnHand', 'reorderLevel', 'warrantyMonths', 'isActive'];
    if (can(req, 'products.view_cost')) cols.splice(9, 0, 'supplier', 'purchasePrice', 'avgCost');
    sendCsv(res, 'products.csv', toCsv(data, cols.map((k) => ({ key: k, label: k }))));
  }),
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/**
 * CSV import. Columns: sku,name,category,brand,barcode,compatibility,color,size,connectorType,
 * purchasePrice,sellingPrice,minSellingPrice,reorderLevel,warrantyMonths,openingStock.
 * Only name and sellingPrice are required. Existing SKUs are updated (prices go through price history);
 * rows without a SKU get an automatic one. All-or-nothing.
 */
productsRouter.post(
  '/import',
  requirePerm('products.manage'),
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('Attach a CSV file');
    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (!rows.length) throw badRequest('The file has no data rows');
    if (rows.length > 5000) throw badRequest('Import at most 5000 rows at a time');
    const errors: { row: number; message: string }[] = [];
    const parsed = rows.map((r, i) => {
      const n = (k: string) => (r[k] === undefined || r[k] === '' ? undefined : Number(r[k]));
      const cand = {
        sku: r.sku || null, name: r.name, barcode: r.barcode || null, compatibility: r.compatibility || null, color: r.color || null,
        size: r.size || null, connectorType: r.connectorType || null, purchasePrice: n('purchasePrice') ?? 0,
        sellingPrice: n('sellingPrice'), minSellingPrice: n('minSellingPrice') ?? n('sellingPrice'),
        reorderLevel: n('reorderLevel') ?? 5, warrantyMonths: n('warrantyMonths') ?? 0, openingStock: n('openingStock') ?? 0,
      };
      const v = productSchema.safeParse(cand);
      if (!v.success) errors.push({ row: i + 2, message: v.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      return { r, v: v.success ? v.data : null };
    });
    const skus = parsed.map((p) => p.r.sku?.toUpperCase());
    skus.forEach((s, i) => { if (s && skus.indexOf(s) !== i) errors.push({ row: i + 2, message: `Duplicate SKU ${s} in file` }); });
    if (errors.length) return res.status(422).json({ error: { code: 'IMPORT_INVALID', message: `${errors.length} problem(s) found; nothing imported`, details: errors.slice(0, 100) } });

    let created = 0, updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const { r, v } of parsed) {
        const cat = r.category ? await tx.category.upsert({ where: { name: r.category }, update: {}, create: { name: r.category } }) : null;
        const brand = r.brand ? await tx.brand.upsert({ where: { name: r.brand }, update: {}, create: { name: r.brand } }) : null;
        const { openingStock, sku: rawSku, minSellingPrice, ...rest } = v!;
        const data = { ...rest, minSellingPrice: minSellingPrice ?? rest.sellingPrice };
        const sku = rawSku ? rawSku.toUpperCase() : null;
        const existing = sku ? await tx.product.findUnique({ where: { sku } }) : null;
        if (existing) {
          for (const f of ['sellingPrice', 'minSellingPrice'] as const) {
            if (toCents(existing[f]) !== toCents(data[f])) {
              await tx.priceHistory.create({ data: { productId: existing.id, field: f, oldValue: existing[f], newValue: String(data[f]), changedById: req.user!.id, reason: 'CSV import' } });
            }
          }
          await tx.product.update({ where: { id: existing.id }, data: { ...data, categoryId: cat?.id ?? null, brandId: brand?.id ?? null } });
          updated++;
        } else {
          const p = await tx.product.create({ data: { ...data, sku: sku ?? (await generateSku(tx)), categoryId: cat?.id ?? null, brandId: brand?.id ?? null, avgCost: String(data.purchasePrice) } });
          if (openingStock > 0) {
            await applyMovement(tx, { productId: p.id, qtyChange: openingStock, type: 'OPENING', unitCost: data.purchasePrice, updateAverage: true, userId: req.user!.id, reason: 'CSV import' });
          }
          created++;
        }
      }
      await audit(req, 'product.import', 'product', null, { created, updated }, tx);
    }, { timeout: 120_000 });
    res.json({ created, updated });
  }),
);

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: path.resolve('uploads'),
    filename: (_r, f, cb) => cb(null, `${crypto.randomUUID()}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(f.mimetype)),
});

productsRouter.post(
  '/upload-image',
  requirePerm('products.manage'),
  imageUpload.single('image'),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('Upload a PNG, JPG or WEBP image up to 3 MB');
    res.json({ url: `/uploads/${req.file.filename}` });
  }),
);

productsRouter.get(
  '/:id',
  requirePerm('products.view'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.product.findUnique({ where: { id }, include });
    if (!p) throw notFound('Product not found');
    const out: Record<string, unknown> = { ...presentProduct(req, p) };
    if (can(req, 'products.view_cost')) {
      const [sold, received, history] = await Promise.all([
        prisma.$queryRaw<{ qty: number | null; revenue: string | null; cogs: string | null }[]>`
          SELECT SUM(si.qty - si.qtyReturned) qty, SUM((si.lineTotal - si.allocatedBillDiscount) * (si.qty - si.qtyReturned) / si.qty) revenue,
                 SUM(si.unitCost * (si.qty - si.qtyReturned)) cogs
          FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = ${id} AND s.status <> 'VOIDED'`,
        prisma.$queryRaw<{ qty: number | null }[]>`SELECT SUM(qtyChange) qty FROM stock_movements WHERE productId = ${id} AND type = 'PURCHASE_RECEIPT'`,
        prisma.priceHistory.findMany({ where: { productId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      const revenue = num(sold[0]?.revenue), cogs = num(sold[0]?.cogs);
      out.lifetime = {
        unitsSold: Number(sold[0]?.qty ?? 0), unitsReceived: Number(received[0]?.qty ?? 0),
        netRevenue: revenue.toFixed(2), cogs: cogs.toFixed(2), grossProfit: (revenue - cogs).toFixed(2),
        potentialProfitOnStock: ((num(p.sellingPrice) - num(p.avgCost)) * p.qtyOnHand).toFixed(2),
      };
      out.priceHistory = history;
    }
    const variants = p.variantGroup
      ? await prisma.product.findMany({ where: { variantGroup: p.variantGroup, NOT: { id } }, select: { id: true, name: true, sku: true, color: true, size: true, qtyOnHand: true } })
      : [];
    out.variants = variants;
    res.json(out);
  }),
);

productsRouter.post(
  '/',
  requirePerm('products.manage'),
  ah(async (req, res) => {
    const { openingStock, sku, minSellingPrice, ...data } = parse(productSchema, req.body);
    const p = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          ...data,
          sku: sku ? sku.toUpperCase() : await generateSku(tx),
          minSellingPrice: minSellingPrice ?? data.sellingPrice,
          avgCost: String(data.purchasePrice),
        },
      });
      if (openingStock > 0) {
        await applyMovement(tx, { productId: p.id, qtyChange: openingStock, type: 'OPENING', unitCost: data.purchasePrice, updateAverage: true, userId: req.user!.id, reason: 'Opening stock' });
      }
      await audit(req, 'product.create', 'product', p.id, { sku: p.sku, openingStock }, tx);
      return tx.product.findUniqueOrThrow({ where: { id: p.id }, include });
    });
    res.status(201).json(presentProduct(req, p));
  }),
);

productsRouter.put(
  '/:id',
  requirePerm('products.manage'),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw notFound('Product not found');
    const body = parse(productSchema.innerType().innerType().omit({ openingStock: true }).partial().extend({ priceChangeReason: z.string().max(200).optional(), approval: approvalSchema }), req.body);
    const { priceChangeReason, approval, sku, ...rest } = body;
    const data = { ...rest, ...(sku ? { sku: sku.toUpperCase() } : {}) };
    const sell = data.sellingPrice ?? num(existing.sellingPrice);
    if (data.minSellingPrice === null) data.minSellingPrice = sell; // cleared: no separate minimum
    const min = data.minSellingPrice ?? num(existing.minSellingPrice);
    if (min > sell) throw badRequest('Minimum price cannot exceed the selling price');
    if (data.barcode && !validBarcode(data.barcode)) throw badRequest('Barcode is not valid');
    const priceFields = (['sellingPrice', 'minSellingPrice', 'purchasePrice'] as const).filter(
      (f) => data[f] !== undefined && toCents(data[f]) !== toCents(existing[f]),
    );
    if (priceFields.some((f) => f !== 'purchasePrice') && !can(req, 'prices.change')) {
      await resolveApproval(req, 'prices.change', approval, 'Changing selling prices');
    }
    if (data.purchasePrice !== undefined && !can(req, 'products.view_cost')) delete data.purchasePrice;
    const p = await prisma.$transaction(async (tx) => {
      for (const f of priceFields) {
        await tx.priceHistory.create({ data: { productId: id, field: f, oldValue: existing[f], newValue: String(data[f]), changedById: req.user!.id, reason: priceChangeReason } });
      }
      const p = await tx.product.update({ where: { id }, data: { ...data, minSellingPrice: data.minSellingPrice ?? undefined }, include });
      await audit(req, 'product.update', 'product', id, { changed: Object.keys(data), priceFields }, tx);
      return p;
    });
    res.json(presentProduct(req, p));
  }),
);

productsRouter.get(
  '/:id/movements',
  requirePerm('stock.view'),
  ah(async (req, res) => {
    const rows = await prisma.stockMovement.findMany({ where: { productId: Number(req.params.id) }, orderBy: { id: 'desc' }, take: 200 });
    res.json(rows.map((m) => (can(req, 'products.view_cost') ? m : { ...m, unitCost: undefined })));
  }),
);
