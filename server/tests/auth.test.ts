import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, ensureUser, H, login, makeProduct } from './helpers.js';
import { prisma } from '../src/db.js';

describe('authentication', () => {
  it('rejects a wrong password and records the attempt', async () => {
    const r = await request(app).post('/api/auth/login').set(H).send({ username: 'owner', password: 'nope' });
    expect(r.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.login_failed' } })).toBeGreaterThan(0);
  });

  it('signs in with an httpOnly SameSite=Strict cookie and returns permissions', async () => {
    const r = await request(app).post('/api/auth/login').set(H).send({ username: 'owner', password: 'Owner@12345' });
    expect(r.status).toBe(200);
    expect(r.body.user.permissions).toContain('reports.financial');
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('answers malformed ids and unknown records with 4xx, never 500', async () => {
    const owner = await login('owner', 'Owner@12345');
    for (const url of ['/api/sales/abc', '/api/products/xyz', '/api/purchases/1.5', '/api/sales/abc/invoice.pdf', '/api/customers/-']) {
      const r = await owner.get(url);
      expect(r.status, url).toBeGreaterThanOrEqual(400);
      expect(r.status, url).toBeLessThan(500);
    }
    expect((await owner.get('/api/sales/999999')).status).toBe(404);
    expect((await owner.get('/api/purchases/1.5')).status).toBe(404);
    expect((await owner.get('/api/products/0')).status).toBe(404);
    expect((await owner.get('/api/nope')).status).toBe(404);
  });

  it('requires a session for API routes', async () => {
    expect((await request(app).get('/api/products')).status).toBe(401);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const agent = await login('owner', 'Owner@12345');
    const r = await agent.post('/api/categories').send({ name: 'No header' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF');
  });

  it('logout invalidates the session server-side', async () => {
    const agent = await login('owner', 'Owner@12345');
    await agent.post('/api/auth/logout').set(H).expect(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(app).post('/api/auth/login').set(H).send({ username: 'ratelimit', password: 'x' })).status);
    }
    expect(statuses).toContain(429);
  });
});

describe('role-based access (enforced by the API)', () => {
  it('cashier never receives buying price, cost or margin', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    const p = await makeProduct();
    const list = await cashier.get('/api/products').query({ q: p.sku });
    expect(list.status).toBe(200);
    const row = list.body.data[0];
    expect(row.sellingPrice).toBeDefined();
    expect(row.purchasePrice).toBeUndefined();
    expect(row.avgCost).toBeUndefined();
    expect(row.marginPercent).toBeUndefined();
    const one = await cashier.get(`/api/products/${p.id}`);
    expect(one.body.avgCost).toBeUndefined();
    expect(one.body.lifetime).toBeUndefined();
  });

  it('cashier cannot open financial reports, staff management, or settings changes', async () => {
    const cashier = await ensureUser('t_cashier', 'cashier');
    expect((await cashier.get('/api/reports/net-profit')).status).toBe(403);
    expect((await cashier.get('/api/reports/profit-by-product')).status).toBe(403);
    expect((await cashier.get('/api/users')).status).toBe(403);
    expect((await cashier.put('/api/settings').set(H).send({ shopName: 'Hacked' })).status).toBe(403);
    expect((await cashier.post('/api/products').set(H).send({})).status).toBe(403);
    expect((await cashier.get('/api/audit-logs')).status).toBe(403);
  });

  it('manager sees cost but not owner-only financial reports by default', async () => {
    const manager = await ensureUser('t_manager', 'manager');
    const p = await makeProduct();
    const one = await manager.get(`/api/products/${p.id}`);
    expect(one.body.avgCost).toBeDefined();
    expect((await manager.get('/api/reports/net-profit')).status).toBe(403);
    expect((await manager.get('/api/users')).status).toBe(403);
    const dash = await manager.get('/api/dashboard');
    expect(dash.body.period.grossProfit).toBeUndefined();
  });

  it('changing a role removes the staff member\'s sessions', async () => {
    const owner = await login('owner', 'Owner@12345');
    const cashier = await ensureUser('t_demote', 'cashier');
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 't_demote' } });
    const mgr = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
    await owner.put(`/api/users/${u.id}`).set(H).send({ roleId: mgr.id }).expect(200);
    expect((await cashier.get('/api/auth/me')).status).toBe(401);
  });
});
