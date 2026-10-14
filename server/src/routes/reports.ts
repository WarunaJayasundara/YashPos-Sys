import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, dateRange, TZ_SQL, localToday, addDays } from '../db.js';
import { ah, parse, badRequest, forbidden, notFound } from '../lib/http.js';
import { can } from '../lib/auth.js';
import { sendCsv, toCsv } from '../lib/csv.js';
import type { PermissionCode } from '../lib/permissions.js';
import { cashSummary } from './money.js';

export const reportsRouter = Router();

const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  categoryId: z.coerce.number().int().optional(),
  brandId: z.coerce.number().int().optional(),
  productId: z.coerce.number().int().optional(),
  cashierId: z.coerce.number().int().optional(),
  supplierId: z.coerce.number().int().optional(),
  group: z.enum(['day', 'week', 'month']).default('day'),
  slowDays: z.coerce.number().int().min(7).max(365).default(60),
  format: z.enum(['json', 'csv']).default('json'),
});
type F = Omit<z.infer<typeof filterSchema>, 'from' | 'to'> & { from: string; to: string; gte: Date; lt: Date };

const EMPTY = Prisma.empty;
const LOCAL = (col: string) => Prisma.raw(`CONVERT_TZ(${col}, '+00:00', '${TZ_SQL}')`);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const r2 = (v: unknown) => n(v).toFixed(2);

function itemFilters(f: F) {
  return Prisma.sql`${f.categoryId ? Prisma.sql`AND p.categoryId = ${f.categoryId}` : EMPTY}
    ${f.brandId ? Prisma.sql`AND p.brandId = ${f.brandId}` : EMPTY}
    ${f.productId ? Prisma.sql`AND p.id = ${f.productId}` : EMPTY}
    ${f.cashierId ? Prisma.sql`AND s.cashierId = ${f.cashierId}` : EMPTY}`;
}

type Col = { key: string; label: string; money?: boolean };
interface Report { title: string; columns: Col[]; rows: Record<string, unknown>[]; summary?: Record<string, unknown> }
interface Def { title: string; perm: PermissionCode; run: (f: F, req: Request) => Promise<Omit<Report, 'title'>> }

/** Net sales by product over the period (sale date); returns netted by return date. */
async function productLines(f: F, groupBy: 'product' | 'category' | 'brand') {
  const key = { product: Prisma.raw('p.id'), category: Prisma.raw('p.categoryId'), brand: Prisma.raw('p.brandId') }[groupBy];
  const label = {
    product: Prisma.raw(`CONCAT(p.name, ' (', p.sku, ')')`),
    category: Prisma.raw("COALESCE((SELECT name FROM categories c WHERE c.id = p.categoryId), 'No category')"),
    brand: Prisma.raw(`COALESCE((SELECT name FROM brands b WHERE b.id = p.brandId), 'No brand')`),
  }[groupBy];
  const sold = await prisma.$queryRaw<{ k: number | null; label: string; qty: unknown; gross: unknown; disc: unknown; net: unknown; cogs: unknown }[]>`
    SELECT ${key} k, ${label} label, SUM(si.qty) qty, SUM(si.qty * si.listPrice) gross,
      SUM(si.qty * si.listPrice - si.lineTotal + si.allocatedBillDiscount) disc,
      SUM(si.lineTotal - si.allocatedBillDiscount) net, SUM(si.qty * si.unitCost) cogs
    FROM sale_items si JOIN sales s ON s.id = si.saleId JOIN products p ON p.id = si.productId
    WHERE s.status <> 'VOIDED' AND s.createdAt >= ${f.gte} AND s.createdAt < ${f.lt} ${itemFilters(f)}
    GROUP BY ${key}, label`;
  const ret = await prisma.$queryRaw<{ k: number | null; qty: unknown; refund: unknown; costBack: unknown }[]>`
    SELECT ${key} k, SUM(ri.qty) qty, SUM(ri.refundAmount) refund, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack
    FROM return_items ri JOIN returns r ON r.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId
      JOIN sales s ON s.id = si.saleId JOIN products p ON p.id = si.productId
    WHERE r.createdAt >= ${f.gte} AND r.createdAt < ${f.lt} ${itemFilters(f)}
    GROUP BY ${key}`;
  const rmap = new Map(ret.map((x) => [String(x.k), x]));
  const rows = sold.map((s) => {
    const r = rmap.get(String(s.k));
    rmap.delete(String(s.k));
    const net = n(s.net) - n(r?.refund);
    const cogs = n(s.cogs) - n(r?.costBack);
    return {
      label: s.label, qtySold: n(s.qty), qtyReturned: n(r?.qty), grossSales: r2(s.gross), discounts: r2(s.disc), returns: r2(r?.refund),
      netSales: net.toFixed(2), cogs: cogs.toFixed(2), grossProfit: (net - cogs).toFixed(2),
      marginPercent: net > 0 ? (((net - cogs) / net) * 100).toFixed(1) : '',
    };
  });
  return rows.sort((a, b) => Number(b.netSales) - Number(a.netSales));
}

const salesCols: Col[] = [
  { key: 'label', label: 'Name' }, { key: 'qtySold', label: 'Units sold' }, { key: 'qtyReturned', label: 'Units returned' },
  { key: 'grossSales', label: 'Gross sales', money: true }, { key: 'discounts', label: 'Discounts', money: true },
  { key: 'returns', label: 'Returns', money: true }, { key: 'netSales', label: 'Net sales', money: true },
];
const profitCols: Col[] = [...salesCols, { key: 'cogs', label: 'Cost of goods sold', money: true }, { key: 'grossProfit', label: 'Gross profit', money: true }, { key: 'marginPercent', label: 'Margin %' }];

function totalsOf(rows: Record<string, unknown>[], keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + n(r[k]), 0).toFixed(2)]));
}

async function periodSales(f: F, group: 'day' | 'week' | 'month') {
  const bucket = {
    day: Prisma.sql`DATE(${LOCAL('s.createdAt')})`,
    week: Prisma.sql`DATE_FORMAT(DATE_SUB(DATE(${LOCAL('s.createdAt')}), INTERVAL WEEKDAY(${LOCAL('s.createdAt')}) DAY), '%Y-%m-%d')`,
    month: Prisma.sql`DATE_FORMAT(${LOCAL('s.createdAt')}, '%Y-%m')`,
  }[group];
  const rbucket = {
    day: Prisma.sql`DATE(${LOCAL('r.createdAt')})`,
    week: Prisma.sql`DATE_FORMAT(DATE_SUB(DATE(${LOCAL('r.createdAt')}), INTERVAL WEEKDAY(${LOCAL('r.createdAt')}) DAY), '%Y-%m-%d')`,
    month: Prisma.sql`DATE_FORMAT(${LOCAL('r.createdAt')}, '%Y-%m')`,
  }[group];
  const cashier = f.cashierId ? Prisma.sql`AND s.cashierId = ${f.cashierId}` : EMPTY;
  const sales = await prisma.$queryRaw<{ b: unknown; invoices: unknown; gross: unknown; disc: unknown; tax: unknown; total: unknown; cost: unknown }[]>`
    SELECT ${bucket} b, COUNT(*) invoices, SUM(s.subtotal) gross, SUM(s.lineDiscount + s.billDiscount) disc, SUM(s.taxAmount) tax, SUM(s.total) total, SUM(s.totalCost) cost
    FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ${f.gte} AND s.createdAt < ${f.lt} ${cashier} GROUP BY b ORDER BY b`;
  const rets = await prisma.$queryRaw<{ b: unknown; refund: unknown; refundNet: unknown; costBack: unknown }[]>`
    SELECT ${rbucket} b, SUM(r.refundTotal) refund, SUM(r.refundNet) refundNet, SUM(r.costReversed) costBack
    FROM (SELECT r0.*, (SELECT SUM(refundAmount) FROM return_items WHERE returnId = r0.id) refundNet FROM returns r0) r
    JOIN sales s ON s.id = r.saleId WHERE r.createdAt >= ${f.gte} AND r.createdAt < ${f.lt} ${cashier} GROUP BY b`;
  const key = (b: unknown) => (b instanceof Date ? b.toISOString().slice(0, 10) : String(b));
  const rm = new Map(rets.map((r) => [key(r.b), r]));
  const buckets = new Set([...sales.map((s) => key(s.b)), ...rets.map((r) => key(r.b))]);
  const sm = new Map(sales.map((s) => [key(s.b), s]));
  return [...buckets].sort().map((b) => {
    const s = sm.get(b), r = rm.get(b);
    const invoices = n(s?.invoices);
    const netAfter = n(s?.total) - n(r?.refund);
    return {
      period: b, invoices, grossSales: r2(s?.gross), discounts: r2(s?.disc), tax: r2(s?.tax), salesTotal: r2(s?.total),
      returns: r2(r?.refund), netAfterReturns: netAfter.toFixed(2), averageBill: invoices ? (n(s?.total) / invoices).toFixed(2) : '0.00',
      cogs: (n(s?.cost) - n(r?.costBack)).toFixed(2),
      grossProfit: (n(s?.total) - n(s?.tax) - n(r?.refundNet) - (n(s?.cost) - n(r?.costBack))).toFixed(2),
    };
  });
}

const periodCols = (financial: boolean): Col[] => [
  { key: 'period', label: 'Period' }, { key: 'invoices', label: 'Invoices' }, { key: 'grossSales', label: 'Gross sales', money: true },
  { key: 'discounts', label: 'Discounts', money: true }, { key: 'tax', label: 'Tax', money: true }, { key: 'salesTotal', label: 'Sales total', money: true },
  { key: 'returns', label: 'Refunds', money: true }, { key: 'netAfterReturns', label: 'Net after refunds', money: true }, { key: 'averageBill', label: 'Average bill', money: true },
  ...(financial ? [{ key: 'cogs', label: 'COGS', money: true }, { key: 'grossProfit', label: 'Gross profit (ex tax)', money: true }] : []),
];

export const REPORTS: Record<string, Def> = {
  'daily-sales': {
    title: 'Daily sales', perm: 'reports.sales',
    run: async (f, req) => {
      const rows = await periodSales(f, 'day');
      return { columns: periodCols(can(req, 'reports.financial')), rows, summary: totalsOf(rows, ['invoices', 'salesTotal', 'returns', 'netAfterReturns']) };
    },
  },
  'period-sales': {
    title: 'Weekly / monthly sales', perm: 'reports.sales',
    run: async (f, req) => {
      const rows = await periodSales(f, f.group);
      return { columns: periodCols(can(req, 'reports.financial')), rows, summary: totalsOf(rows, ['invoices', 'salesTotal', 'returns', 'netAfterReturns']) };
    },
  },
  'sales-by-product': {
    title: 'Sales by product', perm: 'reports.sales',
    run: async (f) => { const rows = await productLines(f, 'product'); return { columns: salesCols, rows, summary: totalsOf(rows, ['qtySold', 'netSales']) }; },
  },
  'sales-by-category': {
    title: 'Sales by category', perm: 'reports.sales',
    run: async (f) => { const rows = await productLines(f, 'category'); return { columns: salesCols, rows, summary: totalsOf(rows, ['qtySold', 'netSales']) }; },
  },
  'sales-by-brand': {
    title: 'Sales by brand', perm: 'reports.sales',
    run: async (f) => { const rows = await productLines(f, 'brand'); return { columns: salesCols, rows, summary: totalsOf(rows, ['qtySold', 'netSales']) }; },
  },
  'sales-by-cashier': {
    title: 'Sales by cashier', perm: 'reports.sales',
    run: async (f) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.cashierName cashier, COUNT(*) invoices, SUM(s.total) total, SUM(s.lineDiscount + s.billDiscount) discounts,
          SUM(CASE WHEN s.status = 'VOIDED' THEN 1 ELSE 0 END) voided
        FROM sales s WHERE s.createdAt >= ${f.gte} AND s.createdAt < ${f.lt} AND s.status <> 'VOIDED'
          ${f.cashierId ? Prisma.sql`AND s.cashierId = ${f.cashierId}` : EMPTY}
        GROUP BY s.cashierId, s.cashierName ORDER BY total DESC`;
      const voids = await prisma.$queryRaw<{ cashier: string; c: unknown }[]>`
        SELECT cashierName cashier, COUNT(*) c FROM sales WHERE status = 'VOIDED' AND createdAt >= ${f.gte} AND createdAt < ${f.lt} GROUP BY cashierName`;
      const vm = new Map(voids.map((v) => [v.cashier, n(v.c)]));
      const out = rows.map((r) => ({ cashier: r.cashier, invoices: n(r.invoices), total: r2(r.total), discounts: r2(r.discounts), voided: vm.get(String(r.cashier)) ?? 0, averageBill: n(r.invoices) ? (n(r.total) / n(r.invoices)).toFixed(2) : '0.00' }));
      return { columns: [{ key: 'cashier', label: 'Cashier' }, { key: 'invoices', label: 'Invoices' }, { key: 'total', label: 'Sales total', money: true }, { key: 'averageBill', label: 'Average bill', money: true }, { key: 'discounts', label: 'Discounts given', money: true }, { key: 'voided', label: 'Voided sales' }], rows: out };
    },
  },
  'profit-by-product': {
    title: 'Gross profit by product', perm: 'reports.financial',
    run: async (f) => { const rows = await productLines(f, 'product'); return { columns: profitCols, rows, summary: totalsOf(rows, ['netSales', 'cogs', 'grossProfit']) }; },
  },
  'profit-by-category': {
    title: 'Gross profit by category', perm: 'reports.financial',
    run: async (f) => { const rows = await productLines(f, 'category'); return { columns: profitCols, rows, summary: totalsOf(rows, ['netSales', 'cogs', 'grossProfit']) }; },
  },
  purchases: {
    title: 'Purchase history', perm: 'purchases.view',
    run: async (f) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT po.poNumber, DATE_FORMAT(po.purchaseDate, '%Y-%m-%d') purchaseDate, su.name supplier, po.supplierInvoiceNo, po.status,
          po.invoiceTotal, po.amountPaid, po.invoiceTotal - po.amountPaid balance,
          (SELECT SUM(qtyOrdered) FROM purchase_items WHERE purchaseOrderId = po.id) unitsOrdered,
          (SELECT SUM(qtyReceived) FROM purchase_items WHERE purchaseOrderId = po.id) unitsAccepted,
          (SELECT SUM(qtyDamaged) FROM purchase_items WHERE purchaseOrderId = po.id) unitsDamaged
        FROM purchase_orders po JOIN suppliers su ON su.id = po.supplierId
        WHERE po.purchaseDate >= ${new Date(`${f.from}T00:00:00Z`)} AND po.purchaseDate <= ${new Date(`${f.to}T00:00:00Z`)}
          ${f.supplierId ? Prisma.sql`AND po.supplierId = ${f.supplierId}` : EMPTY}
        ORDER BY po.purchaseDate DESC`;
      const out = rows.map((r) => ({ ...r, invoiceTotal: r2(r.invoiceTotal), amountPaid: r2(r.amountPaid), balance: r2(r.balance), unitsOrdered: n(r.unitsOrdered), unitsAccepted: n(r.unitsAccepted), unitsDamaged: n(r.unitsDamaged) }));
      return {
        columns: [{ key: 'poNumber', label: 'PO' }, { key: 'purchaseDate', label: 'Date' }, { key: 'supplier', label: 'Supplier' }, { key: 'supplierInvoiceNo', label: 'Supplier invoice' }, { key: 'status', label: 'Status' }, { key: 'unitsOrdered', label: 'Ordered' }, { key: 'unitsAccepted', label: 'Accepted' }, { key: 'unitsDamaged', label: 'Damaged' }, { key: 'invoiceTotal', label: 'Invoice total', money: true }, { key: 'amountPaid', label: 'Paid', money: true }, { key: 'balance', label: 'Balance', money: true }],
        rows: out, summary: totalsOf(out, ['invoiceTotal', 'amountPaid', 'balance']),
      };
    },
  },
  'supplier-balances': {
    title: 'Supplier balances', perm: 'reports.financial',
    run: async () => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.name supplier, s.phone,
          COALESCE((SELECT SUM(invoiceTotal) FROM purchase_orders po WHERE po.supplierId = s.id AND po.status NOT IN ('CANCELLED','DRAFT')), 0) invoiced,
          COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplierId = s.id), 0) paid
        FROM suppliers s ORDER BY s.name`;
      const out = rows.map((r) => ({ supplier: r.supplier, phone: r.phone, invoiced: r2(r.invoiced), paid: r2(r.paid), balance: (n(r.invoiced) - n(r.paid)).toFixed(2) }));
      return { columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'invoiced', label: 'Invoiced', money: true }, { key: 'paid', label: 'Paid', money: true }, { key: 'balance', label: 'Outstanding', money: true }], rows: out, summary: totalsOf(out, ['invoiced', 'paid', 'balance']) };
    },
  },
  'inventory-valuation': {
    title: 'Current inventory and valuation', perm: 'reports.inventory',
    run: async (f, req) => {
      const fin = can(req, 'reports.financial');
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT p.sku, p.name, COALESCE(c.name, 'No category') category, COALESCE(b.name, '') brand, p.qtyOnHand, p.reorderLevel, p.avgCost, p.sellingPrice,
          p.qtyOnHand * p.avgCost costValue, p.qtyOnHand * p.sellingPrice retailValue
        FROM products p LEFT JOIN categories c ON c.id = p.categoryId LEFT JOIN brands b ON b.id = p.brandId
        WHERE p.isActive = 1 ${f.categoryId ? Prisma.sql`AND p.categoryId = ${f.categoryId}` : EMPTY} ${f.brandId ? Prisma.sql`AND p.brandId = ${f.brandId}` : EMPTY}
        ORDER BY c.name, p.name`;
      const out = rows.map((r) => ({
        sku: r.sku, name: r.name, category: r.category, brand: r.brand, qtyOnHand: n(r.qtyOnHand), sellingPrice: r2(r.sellingPrice), retailValue: r2(r.retailValue),
        ...(fin ? { avgCost: n(r.avgCost).toFixed(2), costValue: r2(r.costValue), potentialProfit: (n(r.retailValue) - n(r.costValue)).toFixed(2) } : {}),
      }));
      const cols: Col[] = [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' }, { key: 'brand', label: 'Brand' }, { key: 'qtyOnHand', label: 'On hand' }, { key: 'sellingPrice', label: 'Selling price', money: true }, { key: 'retailValue', label: 'Retail value', money: true }];
      if (fin) cols.push({ key: 'avgCost', label: 'Avg cost', money: true }, { key: 'costValue', label: 'Cost value', money: true }, { key: 'potentialProfit', label: 'Potential profit', money: true });
      return { columns: cols, rows: out, summary: totalsOf(out, fin ? ['qtyOnHand', 'retailValue', 'costValue', 'potentialProfit'] : ['qtyOnHand', 'retailValue']) };
    },
  },
  'low-stock': {
    title: 'Low and out of stock', perm: 'reports.inventory',
    run: async () => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT p.sku, p.name, COALESCE(c.name, 'No category') category, p.qtyOnHand - p.qtyReserved available, p.reorderLevel,
          CASE WHEN p.qtyOnHand - p.qtyReserved <= 0 THEN 'OUT' ELSE 'LOW' END status,
          (SELECT name FROM suppliers s WHERE s.id = p.supplierId) supplier
        FROM products p LEFT JOIN categories c ON c.id = p.categoryId
        WHERE p.isActive = 1 AND p.qtyOnHand - p.qtyReserved <= p.reorderLevel ORDER BY available, p.name`;
      return { columns: [{ key: 'status', label: 'Status' }, { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' }, { key: 'available', label: 'Available' }, { key: 'reorderLevel', label: 'Reorder level' }, { key: 'supplier', label: 'Supplier' }], rows: rows.map((r) => ({ ...r, available: n(r.available), reorderLevel: n(r.reorderLevel) })) };
    },
  },
  'stock-movements': {
    title: 'Stock movement history', perm: 'reports.inventory',
    run: async (f) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT DATE_FORMAT(${LOCAL('m.createdAt')}, '%Y-%m-%d %H:%i') time, p.sku, p.name, m.type, m.qtyChange, m.qtyAfter, m.refType, m.refId, m.reason, u.fullName user
        FROM stock_movements m JOIN products p ON p.id = m.productId JOIN users u ON u.id = m.userId
        WHERE m.createdAt >= ${f.gte} AND m.createdAt < ${f.lt} ${f.productId ? Prisma.sql`AND m.productId = ${f.productId}` : EMPTY}
          ${f.categoryId ? Prisma.sql`AND p.categoryId = ${f.categoryId}` : EMPTY}
        ORDER BY m.id DESC LIMIT 5000`;
      return { columns: ['time', 'sku', 'name', 'type', 'qtyChange', 'qtyAfter', 'refType', 'refId', 'reason', 'user'].map((k) => ({ key: k, label: k === 'qtyChange' ? 'Change' : k === 'qtyAfter' ? 'Balance' : k[0].toUpperCase() + k.slice(1) })), rows: rows.map((r) => ({ ...r, qtyChange: n(r.qtyChange), qtyAfter: n(r.qtyAfter), refId: r.refId === null ? '' : n(r.refId) })) };
    },
  },
  adjustments: {
    title: 'Damaged and adjusted inventory', perm: 'reports.inventory',
    run: async (f, req) => {
      const fin = can(req, 'reports.financial');
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT DATE_FORMAT(${LOCAL('m.createdAt')}, '%Y-%m-%d %H:%i') time, p.sku, p.name, m.type, m.qtyChange, m.unitCost, -m.qtyChange * m.unitCost costLost, m.reason, u.fullName user
        FROM stock_movements m JOIN products p ON p.id = m.productId JOIN users u ON u.id = m.userId
        WHERE m.type IN ('DAMAGED','LOST','ADJUSTMENT','SUPPLIER_RETURN') AND m.createdAt >= ${f.gte} AND m.createdAt < ${f.lt}
        ORDER BY m.id DESC`;
      const out = rows.map((r) => ({ time: r.time, sku: r.sku, name: r.name, type: r.type, qtyChange: n(r.qtyChange), reason: r.reason, user: r.user, ...(fin ? { costImpact: r2(r.costLost) } : {}) }));
      const cols: Col[] = [{ key: 'time', label: 'Time' }, { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'type', label: 'Type' }, { key: 'qtyChange', label: 'Qty' }, { key: 'reason', label: 'Reason' }, { key: 'user', label: 'By' }];
      if (fin) cols.push({ key: 'costImpact', label: 'Cost written off', money: true });
      return { columns: cols, rows: out, summary: fin ? totalsOf(out, ['costImpact']) : undefined };
    },
  },
  returns: {
    title: 'Returns, refunds and cancelled sales', perm: 'reports.sales',
    run: async (f) => {
      const rets = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT DATE_FORMAT(${LOCAL('r.createdAt')}, '%Y-%m-%d %H:%i') time, 'RETURN' kind, r.returnNumber ref, s.invoiceNumber invoice, r.type detail, r.reason,
          r.refundTotal amount, (SELECT GROUP_CONCAT(DISTINCT method) FROM refunds WHERE returnId = r.id) method
        FROM returns r JOIN sales s ON s.id = r.saleId WHERE r.createdAt >= ${f.gte} AND r.createdAt < ${f.lt}`;
      const voids = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT DATE_FORMAT(${LOCAL('s.voidedAt')}, '%Y-%m-%d %H:%i') time, 'VOID' kind, s.invoiceNumber ref, s.invoiceNumber invoice, 'Voided' detail, s.voidReason reason, s.total amount, '' method
        FROM sales s WHERE s.status = 'VOIDED' AND s.voidedAt >= ${f.gte} AND s.voidedAt < ${f.lt}`;
      const rows: Record<string, unknown>[] = [...rets, ...voids].map((r): Record<string, unknown> => ({ ...r, amount: r2(r.amount) })).sort((a, b) => String(b.time).localeCompare(String(a.time)));
      return { columns: [{ key: 'time', label: 'Time' }, { key: 'kind', label: 'Kind' }, { key: 'ref', label: 'Reference' }, { key: 'invoice', label: 'Original invoice' }, { key: 'detail', label: 'Type' }, { key: 'reason', label: 'Reason' }, { key: 'method', label: 'Refund method' }, { key: 'amount', label: 'Amount', money: true }], rows, summary: totalsOf(rows, ['amount']) };
    },
  },
  discounts: {
    title: 'Discounts given', perm: 'reports.sales',
    run: async (f) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT DATE_FORMAT(${LOCAL('s.createdAt')}, '%Y-%m-%d %H:%i') time, s.invoiceNumber, s.cashierName cashier,
          (SELECT SUM(qty * listPrice) FROM sale_items WHERE saleId = s.id) listTotal,
          (SELECT SUM(qty * listPrice) FROM sale_items WHERE saleId = s.id) - s.subtotal + s.lineDiscount + s.billDiscount discount,
          (SELECT fullName FROM users WHERE id = s.discountApprovedById) approvedBy
        FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ${f.gte} AND s.createdAt < ${f.lt}
          ${f.cashierId ? Prisma.sql`AND s.cashierId = ${f.cashierId}` : EMPTY}
        HAVING discount > 0 ORDER BY s.id DESC`;
      const out = rows.map((r) => ({ ...r, listTotal: r2(r.listTotal), discount: r2(r.discount), percent: n(r.listTotal) ? ((n(r.discount) / n(r.listTotal)) * 100).toFixed(1) : '', approvedBy: r.approvedBy ?? '' }));
      return { columns: [{ key: 'time', label: 'Time' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'cashier', label: 'Cashier' }, { key: 'listTotal', label: 'List price total', money: true }, { key: 'discount', label: 'Discount', money: true }, { key: 'percent', label: '%' }, { key: 'approvedBy', label: 'Approved by' }], rows: out, summary: totalsOf(out, ['discount']) };
    },
  },
  'net-profit': {
    title: 'Expenses and net profit', perm: 'reports.financial',
    run: async (f) => {
      const [s] = await prisma.$queryRaw<{ net: unknown; cogs: unknown; tax: unknown }[]>`
        SELECT SUM(total - taxAmount) net, SUM(totalCost) cogs, SUM(taxAmount) tax FROM sales WHERE status <> 'VOIDED' AND createdAt >= ${f.gte} AND createdAt < ${f.lt}`;
      const [r] = await prisma.$queryRaw<{ refundNet: unknown; costBack: unknown }[]>`
        SELECT SUM(ri.refundAmount) refundNet, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack
        FROM return_items ri JOIN returns rt ON rt.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId
        WHERE rt.createdAt >= ${f.gte} AND rt.createdAt < ${f.lt}`;
      const [w] = await prisma.$queryRaw<{ v: unknown }[]>`
        SELECT SUM(-m.qtyChange * m.unitCost) v FROM stock_movements m WHERE m.type IN ('DAMAGED','LOST') AND m.createdAt >= ${f.gte} AND m.createdAt < ${f.lt}`;
      const exp = await prisma.$queryRaw<{ category: string; v: unknown }[]>`
        SELECT category, SUM(amount) v FROM expenses WHERE expenseDate >= ${new Date(`${f.from}T00:00:00Z`)} AND expenseDate <= ${new Date(`${f.to}T00:00:00Z`)} GROUP BY category ORDER BY v DESC`;
      const netSales = n(s?.net) - n(r?.refundNet);
      const cogs = n(s?.cogs) - n(r?.costBack);
      const gross = netSales - cogs;
      const writeOff = n(w?.v);
      const opex = exp.reduce((a, e) => a + n(e.v), 0);
      const rows = [
        { line: 'Net sales revenue (after discounts and returns, excluding tax)', amount: netSales.toFixed(2) },
        { line: 'Cost of goods sold', amount: (-cogs).toFixed(2) },
        { line: 'Gross profit', amount: gross.toFixed(2) },
        { line: 'Gross margin %', amount: netSales ? ((gross / netSales) * 100).toFixed(1) : '' },
        { line: 'Stock written off (damaged / lost)', amount: (-writeOff).toFixed(2) },
        ...exp.map((e) => ({ line: `Expense: ${e.category}`, amount: (-n(e.v)).toFixed(2) })),
        { line: 'Total operating expenses', amount: (-opex).toFixed(2) },
        { line: 'Net profit', amount: (gross - writeOff - opex).toFixed(2) },
        { line: 'Tax collected (not revenue)', amount: r2(s?.tax) },
      ];
      return { columns: [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount', money: true }], rows };
    },
  },
  'cash-reconciliation': {
    title: 'Cashier closing and payment reconciliation', perm: 'cash.close',
    run: async (f) => {
      const rows: Record<string, unknown>[] = [];
      for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
        const s = await cashSummary(d);
        const c = await prisma.cashClosing.findUnique({ where: { businessDate: new Date(`${d}T00:00:00Z`) } });
        rows.push({
          date: d, cashSales: fromC(s.cashSales), cashCollections: fromC(s.cashCollections), cashRefunds: fromC(s.cashRefunds), cashExpenses: fromC(s.cashExpenses),
          card: s.nonCashTotals.CARD ?? '0.00', bank: s.nonCashTotals.BANK_TRANSFER ?? '0.00', qr: s.nonCashTotals.QR ?? '0.00', credit: s.nonCashTotals.CREDIT ?? '0.00',
          expected: c ? c.expectedCash : '', counted: c ? c.countedCash : '', difference: c ? c.difference : 'not closed',
        });
        if (rows.length > 92) break;
      }
      return { columns: [{ key: 'date', label: 'Date' }, { key: 'cashSales', label: 'Cash sales', money: true }, { key: 'cashCollections', label: 'Credit collected', money: true }, { key: 'cashRefunds', label: 'Cash refunds', money: true }, { key: 'cashExpenses', label: 'Drawer expenses', money: true }, { key: 'card', label: 'Card', money: true }, { key: 'bank', label: 'Bank transfer', money: true }, { key: 'qr', label: 'QR', money: true }, { key: 'credit', label: 'On account', money: true }, { key: 'expected', label: 'Expected cash', money: true }, { key: 'counted', label: 'Counted', money: true }, { key: 'difference', label: 'Difference', money: true }], rows };
    },
  },
  'best-sellers': {
    title: 'Best-selling products', perm: 'reports.sales',
    run: async (f) => {
      const rows = (await productLines(f, 'product')).sort((a, b) => b.qtySold - a.qtySold).slice(0, 50);
      return { columns: salesCols, rows };
    },
  },
  'slow-moving': {
    title: 'Slow-moving products', perm: 'reports.inventory',
    run: async (f) => {
      const since = new Date(Date.now() - f.slowDays * 86400_000);
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT p.sku, p.name, p.qtyOnHand,
          COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED' AND s.createdAt >= ${since}), 0) soldInWindow,
          (SELECT DATE_FORMAT(MAX(s.createdAt), '%Y-%m-%d') FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED') lastSold
        FROM products p WHERE p.isActive = 1 AND p.qtyOnHand > 0
        HAVING soldInWindow <= GREATEST(1, p.qtyOnHand * 0.1) ORDER BY soldInWindow, p.qtyOnHand DESC LIMIT 200`;
      return { columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'qtyOnHand', label: 'On hand' }, { key: 'soldInWindow', label: `Sold in last ${f.slowDays} days` }, { key: 'lastSold', label: 'Last sold' }], rows: rows.map((r) => ({ ...r, qtyOnHand: n(r.qtyOnHand), soldInWindow: n(r.soldInWindow), lastSold: r.lastSold ?? 'never' })) };
    },
  },
};

const fromC = (c: number) => (c / 100).toFixed(2);

reportsRouter.get('/', (req, res) => {
  res.json(Object.entries(REPORTS).filter(([, d]) => can(req, d.perm)).map(([key, d]) => ({ key, title: d.title })));
});

reportsRouter.get('/:key', ah(async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw notFound('Unknown report');
  if (!can(req, def.perm)) throw forbidden();
  const q = parse(filterSchema, req.query);
  const range = dateRange(q.from ?? localToday(), q.to ?? q.from ?? localToday());
  if (range.from > range.to) throw badRequest('"From" must be on or before "to"');
  const f: F = { ...q, ...range };
  const out = await def.run(f, req);
  if (q.format === 'csv') {
    if (!can(req, 'reports.export')) throw forbidden('You may view but not export reports');
    return sendCsv(res, `${req.params.key}_${range.from}_${range.to}.csv`, toCsv(out.rows, out.columns));
  }
  res.json({ key: req.params.key, title: def.title, from: range.from, to: range.to, ...out });
}));

