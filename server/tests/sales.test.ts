import { describe, expect, it } from 'vitest';
import { ensureUser, H, login, makeProduct, sale, uid } from './helpers.js';
import { prisma } from '../src/db.js';

describe('POS sales', () => {
  it('computes totals on the server and ignores client-sent totals', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct({ sellingPrice: 1800 });
    const r = await cashier.post('/api/sales').set(H).send({ ...sale(p.id, 3), total: 1, subtotal: 1, payments: [{ method: 'CASH', amount: 6000 }] });
    expect(r.status).toBe(201);
    expect(r.body.sale.total).toBe('5400');
    expect(r.body.sale.changeDue).toBe('600');
    expect(r.body.sale.payments).toEqual([expect.objectContaining({ method: 'CASH', amount: '5400' })]);
    expect(r.body.sale.totalCost).toBeUndefined(); // hidden from cashier
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(17);
  });

  it('rejects zero/negative quantities, unknown products and insufficient stock without side effects', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct({ qtyOnHand: 2 });
    expect((await cashier.post('/api/sales').set(H).send(sale(p.id, 0))).status).toBe(422);
    expect((await cashier.post('/api/sales').set(H).send(sale(p.id, -1))).status).toBe(422);
    expect((await cashier.post('/api/sales').set(H).send(sale(999999, 1))).status).toBe(400);
    const r = await cashier.post('/api/sales').set(H).send(sale(p.id, 3));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(2);
    expect(await prisma.saleItem.count({ where: { productId: p.id } })).toBe(0);
  });

  it('a multi-line sale is all-or-nothing when one line lacks stock', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const a = await makeProduct({ qtyOnHand: 5 });
    const b = await makeProduct({ qtyOnHand: 1 });
    const r = await cashier.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 2 }], payments: [{ method: 'CASH', amount: 10000 }] });
    expect(r.status).toBe(409);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).qtyOnHand).toBe(5);
  });

  it('never oversells under concurrent sales of the last units', async () => {
    const p = await makeProduct({ qtyOnHand: 2 });
    const agents = await Promise.all([1, 2, 3, 4, 5].map(() => login('owner', 'Owner@12345')));
    const results = await Promise.all(agents.map((ag) => ag.post('/api/sales').set(H).send(sale(p.id, 1))));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(2);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(0);
  });

  it('repeated submission with the same clientRequestId creates one sale', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct({ qtyOnHand: 10 });
    const body = sale(p.id, 1);
    const [a, b] = await Promise.all([cashier.post('/api/sales').set(H).send(body), cashier.post('/api/sales').set(H).send(body)]);
    const c = await cashier.post('/api/sales').set(H).send(body);
    const ids = new Set([a.body.sale.id, b.body.sale.id, c.body.sale.id]);
    expect(ids.size).toBe(1);
    expect(c.body.duplicate).toBe(true);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(9);
  });

  it('issues unique, sequential invoice numbers', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ qtyOnHand: 30 });
    const res = await Promise.all(Array.from({ length: 8 }, () => owner.post('/api/sales').set(H).send(sale(p.id, 1))));
    const nums = res.map((r) => r.body.sale.invoiceNumber as string);
    expect(new Set(nums).size).toBe(8);
    const seq = nums.map((n) => Number(n.split('-').pop())).sort((x, y) => x - y);
    expect(seq[7] - seq[0]).toBe(7);
  });

  it('cashier discount above the role limit needs supervisor approval', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier'); // 5% limit
    await ensureUser('t_manager', 'manager', 'Manager!pw1');
    const p = await makeProduct({ sellingPrice: 1000, minSellingPrice: 800, qtyOnHand: 10 });
    const ok = await cashier.post('/api/sales').set(H).send({ ...sale(p.id, 1), billDiscount: 50 });
    expect(ok.status).toBe(201);
    const blocked = await cashier.post('/api/sales').set(H).send({ ...sale(p.id, 1), billDiscount: 100 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('APPROVAL_REQUIRED');
    const bad = await cashier.post('/api/sales').set(H).send({ ...sale(p.id, 1), billDiscount: 100, approval: { username: 't_cashier', password: 'Passw0rd!x' } });
    expect(bad.body.error.code).toBe('APPROVAL_INVALID');
    const approved = await cashier.post('/api/sales').set(H).send({ ...sale(p.id, 1), billDiscount: 100, approval: { username: 't_manager', password: 'Manager!pw1' } });
    expect(approved.status).toBe(201);
    expect(approved.body.sale.total).toBe('900');
    expect(approved.body.sale.discountApprovedById).not.toBeNull();
  });

  it('selling below minimum price needs approval; discounts cannot exceed the bill', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct({ sellingPrice: 1000, minSellingPrice: 990, qtyOnHand: 10 });
    const r = await cashier.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1, unitPrice: 980 }], payments: [{ method: 'CASH', amount: 1000 }] });
    expect(r.body.error.code).toBe('APPROVAL_REQUIRED');
    const owner = await login('owner', 'Owner@12345');
    const over = await owner.post('/api/sales').set(H).send({ ...sale(p.id, 1), billDiscount: 1500 });
    expect(over.status).toBe(400);
  });

  it('handles split payments, short payments and credit rules', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ sellingPrice: 5000, minSellingPrice: 4000, qtyOnHand: 10 });
    const split = await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CARD', amount: 3000, reference: 'AUTH1' }, { method: 'CASH', amount: 2500 }] });
    expect(split.status).toBe(201);
    expect(split.body.sale.changeDue).toBe('500');
    expect(split.body.sale.payments.map((x: { method: string; amount: string }) => `${x.method}:${x.amount}`).sort()).toEqual(['CARD:3000', 'CASH:2000']);
    const short = await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CASH', amount: 4999 }] });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('PAYMENT_SHORT');
    const overCard = await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CARD', amount: 6000 }] });
    expect(overCard.status).toBe(400);
    const creditNoCustomer = await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CREDIT', amount: 5000 }] });
    expect(creditNoCustomer.status).toBe(400);
    const credit = await owner.post('/api/sales').set(H).send({ clientRequestId: uid(), items: [{ productId: p.id, qty: 1 }], payments: [{ method: 'CASH', amount: 1000 }, { method: 'CREDIT', amount: 4000 }], customer: { name: 'Kamal', phone: '0771234567' } });
    expect(credit.status).toBe(201);
    expect(credit.body.sale.balanceDue).toBe('4000');
    const cust = (await owner.get(`/api/customers/${credit.body.sale.customerId}`)).body;
    expect(cust.balance).toBe('4000.00');
    await owner.post(`/api/customers/${cust.id}/payments`).set(H).send({ amount: 1500, method: 'CASH' }).expect(201);
    expect((await owner.get(`/api/customers/${cust.id}`)).body.balance).toBe('2500.00');
  });

  it('stores the cost at the time of sale; later purchases at a new price do not change it', async () => {
    const owner = await login('owner', 'Owner@12345');
    const s = await prisma.supplier.create({ data: { name: 'Cost supplier' } });
    const p = await makeProduct({ qtyOnHand: 5, avgCost: 1200, sellingPrice: 1800 });
    const first = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    expect(Number(first.items[0].unitCost)).toBe(1200);
    const po = (await owner.post('/api/purchases').set(H).send({ supplierId: s.id, purchaseDate: '2026-10-05', items: [{ productId: p.id, qtyOrdered: 4, unitCost: 1600 }] })).body;
    await owner.post(`/api/purchases/${po.id}/receive`).set(H).send({ items: [{ purchaseItemId: po.items[0].id, qtyReceived: 4 }] }).expect(200);
    // avg = (4*1200 + 4*1600)/8 = 1400
    const second = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    expect(Number(second.items[0].unitCost)).toBe(1400);
    const again = (await owner.get(`/api/sales/${first.id}`)).body;
    expect(Number(again.items[0].unitCost)).toBe(1200);
    expect(again.totalCost).toBe('1200');
  });

  it('cashier can open only their own sales', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct();
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    expect((await cashier.get(`/api/sales/${s.id}`)).status).toBe(403);
    const mine = (await cashier.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    expect((await cashier.get(`/api/sales/${mine.id}`)).status).toBe(200);
  });

  it('writes an audit log entry for every sale', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct();
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    const log = await prisma.auditLog.findFirst({ where: { action: 'sale.create', entityId: String(s.id) } });
    expect(log?.username).toBe('owner');
  });
});

describe('invoices and printing data', () => {
  it('receipt data is a snapshot: later price changes do not alter old invoices', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct({ sellingPrice: 1800, name: 'Snapshot charger' });
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 2))).body.sale;
    await owner.put(`/api/products/${p.id}`).set(H).send({ sellingPrice: 2500, name: 'Renamed charger' }).expect(200);
    const rec = (await owner.get(`/api/sales/${s.id}/receipt`)).body;
    expect(rec.sale.items[0].productName).toBe('Snapshot charger');
    expect(rec.sale.items[0].unitPrice).toBe('1800');
    expect(rec.sale.total).toBe('3600');
    expect(rec.sale.items[0].unitCost).toBeUndefined();
    expect(rec.settings.shopName).toBe('YASH MOBILE');
  });

  it('generates an A4 PDF invoice', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct();
    const s = (await owner.post('/api/sales').set(H).send(sale(p.id, 1))).body.sale;
    const pdf = await owner.get(`/api/sales/${s.id}/invoice.pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
