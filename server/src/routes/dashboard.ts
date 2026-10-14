import { Router } from 'express';
import { prisma, dateRange, localToday, TZ_SQL } from '../db.js';
import { ah } from '../lib/http.js';
import { can, requirePerm } from '../lib/auth.js';
import { Prisma } from '@prisma/client';

export const dashboardRouter = Router();
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const LOCAL = Prisma.raw(`CONVERT_TZ(s.createdAt, '+00:00', '${TZ_SQL}')`);

/** Net sales (ex tax), COGS and profit for a window, with returns netted on their own date. */
async function totals(gte: Date, lt: Date) {
  const [s] = await prisma.$queryRaw<{ c: unknown; total: unknown; tax: unknown; cost: unknown }[]>`
    SELECT COUNT(*) c, SUM(total) total, SUM(taxAmount) tax, SUM(totalCost) cost FROM sales WHERE status <> 'VOIDED' AND createdAt >= ${gte} AND createdAt < ${lt}`;
  const [r] = await prisma.$queryRaw<{ refundTotal: unknown; refundNet: unknown; costBack: unknown }[]>`
    SELECT SUM(ri.refundAmount) refundNet, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack,
      (SELECT SUM(refundTotal) FROM returns WHERE createdAt >= ${gte} AND createdAt < ${lt}) refundTotal
    FROM return_items ri JOIN returns rt ON rt.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId
    WHERE rt.createdAt >= ${gte} AND rt.createdAt < ${lt}`;
  const revenue = n(s.total) - n(r.refundTotal);
  const netSales = n(s.total) - n(s.tax) - n(r.refundNet);
  const cogs = n(s.cost) - n(r.costBack);
  return { sales: n(s.c), revenue, netSales, cogs, grossProfit: netSales - cogs, refunds: n(r.refundTotal), avgBill: n(s.c) ? n(s.total) / n(s.c) : 0 };
}

dashboardRouter.get('/', requirePerm('dashboard.view'), ah(async (req, res) => {
  const fin = can(req, 'dashboard.financial');
  const today = dateRange(localToday());
  const range = dateRange(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
  const [t, p] = await Promise.all([totals(today.gte, today.lt), totals(range.gte, range.lt)]);

  const [stock] = await prisma.$queryRaw<{ units: unknown; cost: unknown; retail: unknown; low: unknown; out: unknown }[]>`
    SELECT SUM(GREATEST(qtyOnHand,0)) units, SUM(GREATEST(qtyOnHand,0) * avgCost) cost, SUM(GREATEST(qtyOnHand,0) * sellingPrice) retail,
      SUM(CASE WHEN qtyOnHand - qtyReserved > 0 AND qtyOnHand - qtyReserved <= reorderLevel THEN 1 ELSE 0 END) low,
      SUM(CASE WHEN qtyOnHand - qtyReserved <= 0 THEN 1 ELSE 0 END) \`out\`
    FROM products WHERE isActive = 1`;

  let expenses = 0, writeOff = 0;
  if (fin) {
    const [e] = await prisma.$queryRaw<{ v: unknown }[]>`
      SELECT SUM(amount) v FROM expenses WHERE expenseDate >= ${new Date(`${range.from}T00:00:00Z`)} AND expenseDate <= ${new Date(`${range.to}T00:00:00Z`)}`;
    const [w] = await prisma.$queryRaw<{ v: unknown }[]>`
      SELECT SUM(-qtyChange * unitCost) v FROM stock_movements WHERE type IN ('DAMAGED','LOST') AND createdAt >= ${range.gte} AND createdAt < ${range.lt}`;
    expenses = n(e.v);
    writeOff = n(w.v);
  }

  const series = await prisma.$queryRaw<{ d: Date | string; sales: unknown; total: unknown; profit: unknown }[]>`
    SELECT DATE(${LOCAL}) d, COUNT(*) sales, SUM(s.total) total, SUM(s.total - s.taxAmount - s.totalCost) profit
    FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ${range.gte} AND s.createdAt < ${range.lt} GROUP BY d ORDER BY d`;

  const best = await prisma.$queryRaw<{ id: number; name: string; qty: unknown; total: unknown }[]>`
    SELECT si.productId id, si.productName name, SUM(si.qty - si.qtyReturned) qty, SUM((si.lineTotal - si.allocatedBillDiscount) * (si.qty - si.qtyReturned) / si.qty) total
    FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE s.status <> 'VOIDED' AND s.createdAt >= ${range.gte} AND s.createdAt < ${range.lt}
    GROUP BY si.productId, si.productName ORDER BY qty DESC LIMIT 8`;

  const since = new Date(Date.now() - 60 * 86400_000);
  const slow = await prisma.$queryRaw<{ id: number; name: string; qtyOnHand: unknown; sold: unknown }[]>`
    SELECT p.id, p.name, p.qtyOnHand,
      COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED' AND s.createdAt >= ${since}), 0) sold
    FROM products p WHERE p.isActive = 1 AND p.qtyOnHand > 0 ORDER BY sold ASC, p.qtyOnHand DESC LIMIT 6`;

  const methods = await prisma.$queryRaw<{ method: string; v: unknown }[]>`
    SELECT p.method, SUM(p.amount) v FROM payments p JOIN sales s ON s.id = p.saleId
    WHERE s.status <> 'VOIDED' AND s.createdAt >= ${range.gte} AND s.createdAt < ${range.lt} GROUP BY p.method`;

  const [recentSales, recentPurchases, lowItems] = await Promise.all([
    prisma.sale.findMany({ orderBy: { id: 'desc' }, take: 8, select: { id: true, invoiceNumber: true, createdAt: true, total: true, status: true, cashierName: true } }),
    can(req, 'purchases.view')
      ? prisma.purchaseOrder.findMany({ orderBy: { id: 'desc' }, take: 5, select: { id: true, poNumber: true, purchaseDate: true, status: true, invoiceTotal: true, supplier: { select: { name: true } } } })
      : Promise.resolve([]),
    prisma.$queryRaw<{ id: number; name: string; sku: string; available: unknown; reorderLevel: number }[]>`
      SELECT id, name, sku, qtyOnHand - qtyReserved available, reorderLevel FROM products WHERE isActive = 1 AND qtyOnHand - qtyReserved <= reorderLevel ORDER BY available LIMIT 8`,
  ]);

  const money = (v: number) => v.toFixed(2);
  res.json({
    range: { from: range.from, to: range.to },
    today: { revenue: money(t.revenue), sales: t.sales, avgBill: money(t.avgBill), ...(fin ? { grossProfit: money(t.grossProfit) } : {}) },
    period: {
      revenue: money(p.revenue), sales: p.sales, avgBill: money(p.avgBill), refunds: money(p.refunds),
      ...(fin ? {
        netSales: money(p.netSales), cogs: money(p.cogs), grossProfit: money(p.grossProfit),
        grossMarginPercent: p.netSales ? Number(((p.grossProfit / p.netSales) * 100).toFixed(1)) : null,
        expenses: money(expenses), stockWrittenOff: money(writeOff), netProfit: money(p.grossProfit - writeOff - expenses),
      } : {}),
    },
    stock: {
      units: n(stock.units), lowCount: n(stock.low), outCount: n(stock.out), retailValue: money(n(stock.retail)),
      ...(fin ? { costValue: money(n(stock.cost)), potentialProfit: money(n(stock.retail) - n(stock.cost)) } : {}),
    },
    series: series.map((s) => ({
      date: s.d instanceof Date ? s.d.toISOString().slice(0, 10) : String(s.d), sales: n(s.sales), total: money(n(s.total)),
      ...(fin ? { profit: money(n(s.profit)) } : {}),
    })),
    bestSellers: best.map((b) => ({ id: b.id, name: b.name, qty: n(b.qty), total: money(n(b.total)) })),
    slowMovers: slow.map((s) => ({ id: s.id, name: s.name, qtyOnHand: n(s.qtyOnHand), soldLast60Days: n(s.sold) })),
    paymentMethods: methods.map((m) => ({ method: m.method, total: money(n(m.v)) })),
    recentSales, recentPurchases,
    lowStock: lowItems.map((l) => ({ ...l, available: n(l.available) })),
  });
}));
