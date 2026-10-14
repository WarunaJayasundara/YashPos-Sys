import { describe, expect, it } from 'vitest';
import { H, login, makeProduct } from './helpers.js';
import { prisma } from '../src/db.js';
import { validBarcode } from '../src/routes/products.js';

describe('products', () => {
  it('creates a product with opening stock recorded as a movement', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cat = await prisma.category.upsert({ where: { name: 'Chargers' }, update: {}, create: { name: 'Chargers' } });
    const r = await owner.post('/api/products').set(H).send({
      sku: 'chg-test-1', name: 'Type-C Fast Charger', categoryId: cat.id, purchasePrice: 1200, sellingPrice: 1800, minSellingPrice: 1600, openingStock: 20,
    });
    expect(r.status).toBe(201);
    expect(r.body.sku).toBe('CHG-TEST-1');
    expect(r.body.qtyOnHand).toBe(20);
    expect(r.body.unitProfit).toBe('600.00');
    const m = await prisma.stockMovement.findFirstOrThrow({ where: { productId: r.body.id } });
    expect(m.type).toBe('OPENING');
    expect(m.qtyChange).toBe(20);
  });

  it('rejects duplicate SKUs, invalid barcodes, negative prices and min > selling', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cat = await prisma.category.findFirstOrThrow();
    const base = { name: 'X product', categoryId: cat.id, sellingPrice: 100, minSellingPrice: 90 };
    expect((await owner.post('/api/products').set(H).send({ ...base, sku: 'CHG-TEST-1' })).status).toBe(409);
    expect((await owner.post('/api/products').set(H).send({ ...base, sku: 'BC-1', barcode: '4006381333932' })).status).toBe(422);
    expect((await owner.post('/api/products').set(H).send({ ...base, sku: 'NEG-1', sellingPrice: -5 })).status).toBe(422);
    expect((await owner.post('/api/products').set(H).send({ ...base, sku: 'MIN-1', minSellingPrice: 150 })).status).toBe(422);
    expect((await owner.post('/api/products').set(H).send({ ...base, sku: 'BC-2', barcode: '4006381333931' })).status).toBe(201);
  });

  it('validates EAN-13 check digits', () => {
    expect(validBarcode('4006381333931')).toBe(true);
    expect(validBarcode('4006381333932')).toBe(false);
    expect(validBarcode('ABC-123')).toBe(true);
  });

  it('records price history when the selling price changes', async () => {
    const owner = await login('owner', 'Owner@12345');
    const p = await makeProduct();
    await owner.put(`/api/products/${p.id}`).set(H).send({ sellingPrice: 1900, priceChangeReason: 'Supplier increase' }).expect(200);
    const h = await prisma.priceHistory.findMany({ where: { productId: p.id } });
    expect(h).toHaveLength(1);
    expect(Number(h[0].oldValue)).toBe(1800);
    expect(Number(h[0].newValue)).toBe(1900);
  });

  it('manager selling-price changes need owner approval', async () => {
    const { ensureUser } = await import('./helpers.js');
    const manager = await ensureUser('t_manager', 'manager');
    const p = await makeProduct();
    const r = await manager.put(`/api/products/${p.id}`).set(H).send({ sellingPrice: 2000 });
    expect(r.body.error.code).toBe('APPROVAL_REQUIRED');
    const ok = await manager.put(`/api/products/${p.id}`).set(H).send({ sellingPrice: 2000, approval: { username: 'owner', password: 'Owner@12345' } });
    expect(ok.status).toBe(200);
    expect(ok.body.sellingPrice).toBe('2000');
    // non-price edits need no approval
    expect((await manager.put(`/api/products/${p.id}`).set(H).send({ compatibility: 'iPhone 15' })).status).toBe(200);
  });

  it('filters low and out of stock', async () => {
    const owner = await login('owner', 'Owner@12345');
    const out = await makeProduct({ qtyOnHand: 0 });
    const low = await makeProduct({ qtyOnHand: 2, reorderLevel: 5 });
    const outIds = (await owner.get('/api/products').query({ status: 'OUT', pageSize: 500 })).body.data.map((p: { id: number }) => p.id);
    const lowIds = (await owner.get('/api/products').query({ status: 'LOW', pageSize: 500 })).body.data.map((p: { id: number }) => p.id);
    expect(outIds).toContain(out.id);
    expect(lowIds).toContain(low.id);
    expect(lowIds).not.toContain(out.id);
  });
});

describe('purchases and goods receiving', () => {
  it('does not change stock when a purchase order is created', async () => {
    const owner = await login('owner', 'Owner@12345');
    const s = await prisma.supplier.create({ data: { name: 'Test supplier' } });
    const p = await makeProduct({ qtyOnHand: 0, avgCost: 0, purchasePrice: 0 });
    const po = await owner.post('/api/purchases').set(H).send({ supplierId: s.id, purchaseDate: '2026-10-01', items: [{ productId: p.id, qtyOrdered: 10, unitCost: 1000 }] });
    expect(po.status).toBe(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(0);
  });

  it('adds only accepted units, allocates freight, and keeps a weighted average cost', async () => {
    const owner = await login('owner', 'Owner@12345');
    const s = await prisma.supplier.create({ data: { name: 'Freight supplier' } });
    const p = await makeProduct({ qtyOnHand: 10, avgCost: 1000, purchasePrice: 1000 });
    const po = (await owner.post('/api/purchases').set(H).send({ supplierId: s.id, purchaseDate: '2026-10-02', invoiceTotal: 24000, items: [{ productId: p.id, qtyOrdered: 20, unitCost: 1200 }] })).body;
    const item = po.items[0];
    // partial delivery: 12 delivered, 2 damaged, Rs. 1,000 freight
    const r1 = await owner.post(`/api/purchases/${po.id}/receive`).set(H).send({ additionalCost: 1000, items: [{ purchaseItemId: item.id, qtyReceived: 12, qtyDamaged: 2 }] });
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('PARTIALLY_RECEIVED');
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.qtyOnHand).toBe(20); // 10 + 10 accepted
    // landed = 1200 + 1000/10 = 1300; avg = (10*1000 + 10*1300)/20 = 1150
    expect(Number(after.avgCost)).toBeCloseTo(1150, 4);
    expect(Number(after.purchasePrice)).toBe(1200);

    // over-receiving is refused: 20 ordered, 12 settled, 8 outstanding
    const over = await owner.post(`/api/purchases/${po.id}/receive`).set(H).send({ items: [{ purchaseItemId: item.id, qtyReceived: 9 }] });
    expect(over.status).toBe(400);
    const r2 = await owner.post(`/api/purchases/${po.id}/receive`).set(H).send({ items: [{ purchaseItemId: item.id, qtyReceived: 7, qtyMissing: 1 }] });
    expect(r2.body.status).toBe('RECEIVED');
  });

  it('tracks supplier payments and refuses overpayment', async () => {
    const owner = await login('owner', 'Owner@12345');
    const s = await prisma.supplier.create({ data: { name: 'Paid supplier' } });
    const p = await makeProduct();
    const po = (await owner.post('/api/purchases').set(H).send({ supplierId: s.id, purchaseDate: '2026-10-03', items: [{ productId: p.id, qtyOrdered: 5, unitCost: 1000 }] })).body;
    await owner.post(`/api/purchases/${po.id}/payments`).set(H).send({ amount: 2000, method: 'CASH' }).expect(201);
    expect((await owner.post(`/api/purchases/${po.id}/payments`).set(H).send({ amount: 3500, method: 'CASH' })).status).toBe(400);
    const sup = (await owner.get(`/api/suppliers/${s.id}`)).body;
    expect(sup.balance).toBe(3000);
  });
});

describe('stock adjustments', () => {
  it('cashier cannot adjust; manager adjustments apply immediately and are audited', async () => {
    const { ensureUser } = await import('./helpers.js');
    const cashier = await ensureUser('t_cashier', 'cashier');
    const manager = await ensureUser('t_manager', 'manager');
    const p = await makeProduct({ qtyOnHand: 10 });
    expect((await cashier.post('/api/stock/adjustments').set(H).send({ productId: p.id, type: 'DAMAGED', qtyChange: -1, reason: 'Dropped' })).status).toBe(403);
    const r = await manager.post('/api/stock/adjustments').set(H).send({ productId: p.id, type: 'DAMAGED', qtyChange: -2, reason: 'Cracked in display' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('APPROVED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyOnHand).toBe(8);
    expect(await prisma.auditLog.count({ where: { action: 'stock.adjust_approve', entityId: String(r.body.id) } })).toBe(1);
    // cannot write off more than is in stock
    expect((await manager.post('/api/stock/adjustments').set(H).send({ productId: p.id, type: 'LOST', qtyChange: -50, reason: 'Stolen' })).status).toBe(409);
  });
});
