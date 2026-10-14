import { describe, expect, it } from 'vitest';
import { ensureUser, H, login, makeProduct, sale, uid } from './helpers.js';
import { prisma, localToday, addDays } from '../src/db.js';

describe('returns, refunds and voids', () => {
  it('partial return restocks at original cost and refunds the net price paid', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ qtyOnHand: 10, avgCost: 1200, sellingPrice: 1800 });
    const s = (await owner.post('/api/sales').set(H).send({ ...sale(p.id, 3), billDiscount: 300 })).body.sale; // 5400 - 300 = 5100
    const r = await owner.post('/api/returns').set(H).send({ saleId: s.id, reason: 'Customer changed mind', items: [{ saleItemId: s.items[0].id, qty: 1, restock: true }] });
    expect(r.status).toBe(201);
    expect(r.body.refundTotal).toBe('1700'); // 5100 / 3
    expect(r.body.costReversed).toBe('1200');
    const prod = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(prod.qtyOnHand).toBe(8);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PARTIALLY_RETURNED');
    // the original invoice is preserved
    expect((await owner.get(`/api/sales/${s.id}`)).body.total).toBe('5100');
  });

  it('repeated partial returns refund exactly the line total, and over-returns are refused', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ qtyOnHand: 10, sellingPrice: 1000, minSellingPrice: 100 });
    const s = (await owner.post('/api/sales').set(H).send({ ...sale(p.id, 3), billDiscount: 100 })).body.sale; // 2900
    const line = s.items[0].id;
    const refunds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await owner.post('/api/returns').set(H).send({ saleId: s.id, reason: 'Faulty batch', items: [{ saleItemId: line, qty: 1, restock: true }] });
      refunds.push(Number(r.body.refundTotal));
    }
    expect(refunds.reduce((a, b) => a + b, 0)).toBe(2900);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('RETURNED');
    const more = await owner.post('/api/returns').set(H).send({ saleId: s.id, reason: 'Again', items: [{ saleItemId: line, qty: 1, restock: true }] });
    expect(more.status).toBe(409);
  });

  it('damaged returns are written off, not restocked', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ qtyOnHand: 5 });
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    await owner.post('/api/returns').set(H).send({ saleId: s.id, reason: 'Broken on arrival', items: [{ saleItemId: s.items[0].id, qty: 1, restock: false }] }).expect(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(4);
    expect(await prisma.stockMovement.count({ where: { productId: p.id, type: 'DAMAGED' } })).toBe(1);
  });

  it('cashier returns need supervisor approval', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct();
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    const body = { saleId: s.id, reason: 'Wrong model', items: [{ saleItemId: s.items[0].id, qty: 1, restock: true }] };
    expect((await cashier.post('/api/returns').set(H).send(body)).body.error.code).toBe('APPROVAL_REQUIRED');
    expect((await cashier.post('/api/returns').set(H).send({ ...body, approval: { username: 'owner', password: 'Owner@12345' } })).status).toBe(201);
  });

  it('void restores stock and marks the sale; it cannot be voided twice', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ qtyOnHand: 4 });
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 2))).body.sale;
    const v = await owner.post(`/api/sales/${s.id}/void`).set(H).send({ reason: 'Keyed wrong item' });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('VOIDED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(4);
    expect((await owner.post(`/api/sales/${s.id}/void`).set(H).send({ reason: 'again' })).status).toBe(409);
  });
});

describe('profit and reports', () => {
  it('gross profit = net revenue - cost of goods sold, with returns and discounts', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cat = await prisma.category.create({ data: { name: `Profit cat ${uid().slice(0, 6)}` } });
    const p = await makeProduct({ categoryId: cat.id, qtyOnHand: 20, avgCost: 1200, sellingPrice: 1800, minSellingPrice: 1000 });
    const s = (await owner.post('/api/sales').set(H).send({ ...sale(p.id, 5), billDiscount: 500 })).body.sale; // 9000 - 500 = 8500, cost 6000
    await owner.post('/api/returns').set(H).send({ saleId: s.id, reason: 'Return one', items: [{ saleItemId: s.items[0].id, qty: 1, restock: true }] }).expect(201); // -1700 revenue, -1200 cost
    const today = localToday();
    const rep = (await owner.get('/api/reports/profit-by-category').query({ from: today, to: today, categoryId: cat.id })).body;
    const row = rep.rows[0];
    expect(row.qtySold).toBe(5);
    expect(row.qtyReturned).toBe(1);
    expect(row.netSales).toBe('6800.00');
    expect(row.cogs).toBe('4800.00');
    expect(row.grossProfit).toBe('2000.00');
    expect(row.discounts).toBe('500.00');
  });

  it('date filters include today and exclude other days', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct();
    await owner.post('/api/sales').set(H).send(sale(p.id, 1)).expect(201);
    const today = localToday();
    const yesterday = addDays(today, -1);
    const t = (await owner.get('/api/reports/sales-by-product').query({ from: today, to: today, productId: p.id })).body;
    const y = (await owner.get('/api/reports/sales-by-product').query({ from: yesterday, to: yesterday, productId: p.id })).body;
    expect(t.rows).toHaveLength(1);
    expect(y.rows).toHaveLength(0);
    expect((await owner.get('/api/reports/daily-sales').query({ from: today, to: yesterday })).status).toBe(400);
  });

  it('net profit subtracts operating expenses; cash closing ignores non-cash payments', async () => {
    const owner = await login('owner', 'Owner@12345');
    const today = localToday();
    const before = (await owner.get('/api/cash/summary').query({ date: today })).body;
    const p = await makeProduct({ sellingPrice: 2000, minSellingPrice: 1000, qtyOnHand: 5 });
    await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CARD', amount: 2000 }] }).expect(201);
    await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CASH', amount: 2000 }] }).expect(201);
    await owner.post('/api/expenses').set(H).send({ category: 'Transport', description: 'Courier', amount: 300, expenseDate: today, method: 'CASH', paidFromDrawer: true }).expect(201);
    const after = (await owner.get('/api/cash/summary').query({ date: today })).body;
    expect(Number(after.cashSales) - Number(before.cashSales)).toBe(2000);
    expect(Number(after.cashExpenses) - Number(before.cashExpenses)).toBe(300);
    const expected = Number(after.expectedBeforeFloat) + 5000;
    const c = await owner.post('/api/cash/close').set(H).send({ date: today, openingFloat: 5000, countedCash: expected - 100 });
    expect(c.status).toBe(201);
    expect(c.body.difference).toBe('-100');
    expect((await owner.post('/api/cash/close').set(H).send({ date: today, openingFloat: 0, countedCash: 0 })).status).toBe(409);
    const np = (await owner.get('/api/reports/net-profit').query({ from: today, to: today })).body.rows;
    const line = (l: string) => Number(np.find((r: { line: string }) => r.line.startsWith(l)).amount);
    expect(line('Net profit')).toBeCloseTo(line('Gross profit') + line('Stock written off') + line('Total operating expenses'), 2);
  });

  it('exports CSV only for users allowed to export', async () => {
    const owner = await login('owner', 'Owner@12345');
    const csv = await owner.get('/api/reports/inventory-valuation').query({ format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Cost value');
  });
});
