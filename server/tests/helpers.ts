import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';

export const app = createApp();
export const H = { 'X-Requested-With': 'yash-pos' };

export async function login(username: string, password: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set(H).send({ username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}

export async function ensureUser(username: string, role: 'admin' | 'manager' | 'cashier', password = 'Passw0rd!x') {
  const r = await prisma.role.findUniqueOrThrow({ where: { code: role } });
  await prisma.user.upsert({
    where: { username },
    update: { roleId: r.id, isActive: true, passwordHash: await hashPassword(password) },
    create: { username, fullName: `Test ${username}`, roleId: r.id, passwordHash: await hashPassword(password) },
  });
  return login(username, password);
}

export const uid = () => crypto.randomUUID();

let n = 0;
export async function makeProduct(overrides: Record<string, unknown> = {}) {
  n++;
  const cat = await prisma.category.upsert({ where: { name: 'Test category' }, update: {}, create: { name: 'Test category' } });
  return prisma.product.create({
    data: {
      sku: `T-${Date.now()}-${n}`,
      name: `Test product ${n}`,
      categoryId: cat.id,
      purchasePrice: 1200,
      avgCost: 1200,
      sellingPrice: 1800,
      minSellingPrice: 1500,
      qtyOnHand: 20,
      ...overrides,
    },
  });
}

export const sale = (productId: number, qty = 1, extra: Record<string, unknown> = {}) => ({
  clientRequestId: uid(),
  items: [{ productId, qty }],
  payments: [{ method: 'CASH', amount: 1_000_000 }],
  ...extra,
});
