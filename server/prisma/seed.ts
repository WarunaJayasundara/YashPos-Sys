// Seeds permissions, roles, settings and the owner account. With SEED_DEMO=1 (default in development)
// it also adds clearly-labelled demo catalogue data and sample sales for trying the system.
import 'dotenv/config';
import type { Request } from 'express';
import { prisma } from '../src/db.js';
import { hashPassword, loadAuthUser } from '../src/lib/auth.js';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/lib/permissions.js';
import { applyMovement } from '../src/services/inventory.js';
import { createPurchase, receiveGoods } from '../src/services/purchases.js';
import { createSale } from '../src/services/sales.js';

const isProd = process.env.NODE_ENV === 'production';
const demo = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : !isProd;

async function seedAccessControl() {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, name: r.name, maxDiscountPercent: r.maxDiscountPercent.toFixed(2), isSystem: true },
    });
    // admin always holds every permission; other roles only get defaults the first time
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (r.code === 'admin' || existing === 0) {
      await prisma.rolePermission.createMany({
        data: r.permissions.map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })),
        skipDuplicates: true,
      });
    }
  }
}

async function seedUsers() {
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (isProd ? '' : 'Owner@12345');
  if (!adminPassword) throw new Error('Set SEED_ADMIN_PASSWORD to create the owner account in production');
  const accounts = [{ username: 'owner', fullName: 'Shop Owner', role: 'admin', password: adminPassword }];
  if (demo) {
    accounts.push(
      { username: 'manager', fullName: 'Demo Manager', role: 'manager', password: 'Manager@12345' },
      { username: 'cashier', fullName: 'Demo Cashier', role: 'cashier', password: 'Cashier@12345' },
    );
  }
  for (const a of accounts) {
    const exists = await prisma.user.findUnique({ where: { username: a.username } });
    if (!exists) {
      await prisma.user.create({ data: { username: a.username, fullName: a.fullName, roleId: roles.get(a.role)!, passwordHash: await hashPassword(a.password) } });
      console.log(`  created user "${a.username}" (${a.role})`);
    }
  }
}

const fakeReq = async (username: string) => ({ user: (await loadAuthUser((await prisma.user.findUniqueOrThrow({ where: { username } })).id))!, ip: 'seed', get: () => undefined }) as unknown as Request;

async function seedDemo() {
  if ((await prisma.product.count()) > 0) {
    console.log('  products already exist; skipping demo data');
    return;
  }
  console.log('  adding DEMO catalogue and sample transactions (not real business data)');
  await prisma.businessSettings.update({
    where: { id: 1 },
    data: { address: 'No. 00, Main Street, Colombo (demo address)', phone: '011 000 0000', warrantyPolicy: 'Warranty covers manufacturing defects only. Physical or water damage is not covered. Bring this receipt for any claim.' },
  });
  const cats = ['Phone cases & covers', 'Screen protectors', 'Chargers & adapters', 'Cables', 'Earphones & headphones', 'Bluetooth accessories', 'Power banks', 'Holders & stands', 'Memory cards & storage', 'Smartwatch accessories'];
  const catId = new Map<string, number>();
  for (const c of cats) catId.set(c, (await prisma.category.create({ data: { name: c } })).id);
  const brands = ['Anker', 'Baseus', 'Samsung', 'Apple', 'JBL', 'SanDisk', 'Remax', 'Joyroom', 'Generic'];
  const brandId = new Map<string, number>();
  for (const b of brands) brandId.set(b, (await prisma.brand.create({ data: { name: b } })).id);
  const s1 = await prisma.supplier.create({ data: { name: 'Demo Accessories Wholesale (Pvt) Ltd', contactPerson: 'Sales desk', phone: '077 000 0001', address: 'Pettah, Colombo 11 (demo)' } });
  const s2 = await prisma.supplier.create({ data: { name: 'Demo Electronics Importers', phone: '077 000 0002', address: 'Colombo 10 (demo)' } });

  type P = [sku: string, name: string, cat: string, brand: string, cost: number, sell: number, min: number, qty: number, warranty: number, extra?: Record<string, string>];
  const products: P[] = [
    ['CHG-TC20', 'Type-C Fast Charger 20W', 'Chargers & adapters', 'Baseus', 1200, 1800, 1550, 20, 6, { connectorType: 'USB-C', compatibility: 'Android, iPhone 15' }],
    ['CHG-TC45', 'Type-C Super Fast Charger 45W', 'Chargers & adapters', 'Samsung', 3900, 5500, 4900, 10, 12, { connectorType: 'USB-C', compatibility: 'Samsung Galaxy S22-S24' }],
    ['CHG-CAR', 'Dual Port Car Charger', 'Chargers & adapters', 'Remax', 650, 1100, 900, 15, 3],
    ['CBL-TC1M', 'Type-C to Type-C Cable 1m', 'Cables', 'Anker', 450, 850, 700, 40, 6, { connectorType: 'USB-C', size: '1m' }],
    ['CBL-TC2M', 'Type-C to Type-C Cable 2m', 'Cables', 'Anker', 600, 1100, 900, 25, 6, { connectorType: 'USB-C', size: '2m' }],
    ['CBL-LTN1M', 'USB-A to Lightning Cable 1m', 'Cables', 'Joyroom', 500, 950, 800, 30, 6, { connectorType: 'Lightning', compatibility: 'iPhone 6-14' }],
    ['CBL-MICRO', 'Micro USB Cable 1m', 'Cables', 'Generic', 150, 350, 280, 50, 0, { connectorType: 'Micro USB' }],
    ['CS-A15-BLK', 'Silicone Case Galaxy A15 - Black', 'Phone cases & covers', 'Generic', 350, 900, 700, 12, 0, { color: 'Black', compatibility: 'Samsung Galaxy A15', variantGroup: 'CS-A15' }],
    ['CS-A15-BLU', 'Silicone Case Galaxy A15 - Blue', 'Phone cases & covers', 'Generic', 350, 900, 700, 8, 0, { color: 'Blue', compatibility: 'Samsung Galaxy A15', variantGroup: 'CS-A15' }],
    ['CS-IP15-CLR', 'Clear Shockproof Case iPhone 15', 'Phone cases & covers', 'Joyroom', 450, 1200, 950, 15, 0, { color: 'Clear', compatibility: 'iPhone 15' }],
    ['CS-RN13-FLP', 'Flip Cover Redmi Note 13', 'Phone cases & covers', 'Generic', 400, 1100, 850, 3, 0, { color: 'Black', compatibility: 'Redmi Note 13' }],
    ['TG-A15', 'Tempered Glass Galaxy A15', 'Screen protectors', 'Generic', 120, 500, 350, 40, 0, { compatibility: 'Samsung Galaxy A15' }],
    ['TG-IP15', 'Tempered Glass iPhone 15 (Full cover)', 'Screen protectors', 'Remax', 200, 750, 550, 30, 0, { compatibility: 'iPhone 15' }],
    ['TG-PRIV', 'Privacy Tempered Glass iPhone 14/15', 'Screen protectors', 'Joyroom', 450, 1300, 1000, 2, 0, { compatibility: 'iPhone 14, iPhone 15' }],
    ['EAR-WIRED', 'Wired Earphones 3.5mm with Mic', 'Earphones & headphones', 'Generic', 250, 650, 500, 25, 1],
    ['EAR-TWS-JBL', 'JBL Wave Buds TWS Earbuds', 'Bluetooth accessories', 'JBL', 9500, 13500, 12500, 5, 12],
    ['EAR-TWS-BAS', 'Baseus Bowie E3 TWS Earbuds', 'Bluetooth accessories', 'Baseus', 4200, 6500, 5800, 8, 6],
    ['HP-JBL-T520', 'JBL Tune 520BT Headphones', 'Earphones & headphones', 'JBL', 11500, 16500, 15000, 4, 12],
    ['PB-10K', 'Power Bank 10000mAh 22.5W', 'Power banks', 'Baseus', 3800, 5900, 5200, 10, 12],
    ['PB-20K', 'Power Bank 20000mAh PD', 'Power banks', 'Anker', 7200, 10500, 9500, 0, 18],
    ['HLD-CAR', 'Magnetic Car Phone Holder', 'Holders & stands', 'Baseus', 900, 1650, 1400, 12, 0],
    ['HLD-DESK', 'Foldable Desk Phone Stand', 'Holders & stands', 'Generic', 300, 750, 600, 20, 0],
    ['SD-64', 'SanDisk Ultra microSD 64GB', 'Memory cards & storage', 'SanDisk', 1900, 2800, 2500, 15, 60],
    ['SD-128', 'SanDisk Ultra microSD 128GB', 'Memory cards & storage', 'SanDisk', 3100, 4400, 3900, 10, 60],
    ['OTG-TC', 'USB-A to Type-C OTG Adapter', 'Cables', 'Generic', 120, 400, 300, 30, 0, { connectorType: 'USB-C' }],
    ['SW-STRAP', 'Silicone Strap for Smartwatch 22mm', 'Smartwatch accessories', 'Generic', 300, 900, 700, 18, 0, { size: '22mm' }],
    ['SW-CHG', 'Smartwatch Magnetic Charging Cable', 'Smartwatch accessories', 'Generic', 400, 1000, 800, 6, 1],
  ];

  const owner = await fakeReq('owner');
  const created: { id: number; qty: number; cost: number; supplier: number }[] = [];
  for (const [sku, name, cat, brand, cost, sell, min, qty, warranty, extra] of products) {
    const p = await prisma.product.create({
      data: {
        sku, name, categoryId: catId.get(cat)!, brandId: brandId.get(brand), supplierId: created.length % 2 ? s2.id : s1.id,
        purchasePrice: cost, avgCost: cost, sellingPrice: sell, minSellingPrice: min, warrantyMonths: warranty, reorderLevel: 5,
        maxStockLevel: 60, ...(extra ?? {}),
      },
    });
    created.push({ id: p.id, qty, cost, supplier: p.supplierId! });
  }
  // opening stock for half, a received purchase order for the rest, so both paths appear in history
  const viaPo = created.filter((_, i) => i % 2 === 1 && created[i].qty > 0);
  for (const c of created.filter((x) => !viaPo.includes(x) && x.qty > 0)) {
    await prisma.$transaction((tx) => applyMovement(tx, { productId: c.id, qtyChange: c.qty, type: 'OPENING', unitCost: c.cost, updateAverage: true, userId: owner.user!.id, reason: 'Opening stock (demo)' }));
  }
  const day = new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10);
  const po = await createPurchase(owner, {
    supplierId: s2.id, supplierInvoiceNo: 'DEMO-INV-1001', purchaseDate: day, status: 'ORDERED',
    items: viaPo.map((c) => ({ productId: c.id, qtyOrdered: c.qty, unitCost: c.cost })),
  });
  await receiveGoods(owner, po.id, { additionalCost: 0, items: po.items.map((i) => ({ purchaseItemId: i.id, qtyReceived: i.qtyOrdered, qtyDamaged: 0, qtyMissing: 0 })) });
  await prisma.supplierPayment.create({ data: { supplierId: s2.id, purchaseOrderId: po.id, amount: (Number(po.invoiceTotal) / 2).toFixed(2), method: 'BANK_TRANSFER', reference: 'DEMO', recordedById: owner.user!.id } });
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { amountPaid: (Number(po.invoiceTotal) / 2).toFixed(2) } });

  // a few weeks of demo sales; timestamps are back-dated after creation
  const cashier = await fakeReq('cashier');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sellable = await prisma.product.findMany({ where: { qtyOnHand: { gt: 3 } } });
  for (let d = 28; d >= 1; d--) {
    const count = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const p = sellable[Math.floor(rand() * sellable.length)];
      const fresh = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
      if (fresh.qtyOnHand < 2) continue;
      const total = Number(fresh.sellingPrice);
      const method = rand() < 0.65 ? 'CASH' : rand() < 0.5 ? 'CARD' : 'QR';
      const { sale } = await createSale(cashier, {
        clientRequestId: `seed-${d}-${k}-${p.id}`, items: [{ productId: p.id, qty: 1, lineDiscount: 0 }], billDiscount: 0,
        payments: [{ method, amount: method === 'CASH' ? Math.ceil(total / 500) * 500 : total }],
      });
      const when = new Date(Date.now() - d * 86400_000 + (k + 1) * 3600_000 * 1.5);
      await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: when } });
      await prisma.payment.updateMany({ where: { saleId: sale.id }, data: { createdAt: when } });
      await prisma.stockMovement.updateMany({ where: { refType: 'SALE', refId: sale.id }, data: { createdAt: when } });
    }
  }
  const month = new Date().toISOString().slice(0, 8);
  await prisma.expense.createMany({
    data: [
      { category: 'Rent', description: 'Shop rent (demo)', amount: 45000, expenseDate: new Date(`${month}01T00:00:00Z`), method: 'BANK_TRANSFER', recordedById: owner.user!.id },
      { category: 'Electricity', description: 'CEB bill (demo)', amount: 6200, expenseDate: new Date(`${month}05T00:00:00Z`), method: 'CASH', recordedById: owner.user!.id },
    ],
  });
}

async function main() {
  console.log('Seeding YASH MOBILE POS...');
  await seedAccessControl();
  await prisma.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await seedUsers();
  if (demo) await seedDemo();
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
