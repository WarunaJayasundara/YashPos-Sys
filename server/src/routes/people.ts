import { Router } from 'express';
import { z } from 'zod';
import { prisma, dateRange } from '../db.js';
import { ah, parse, badRequest, notFound, conflict, idParam } from '../lib/http.js';
import { hashPassword, requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { fromCents, toCents } from '../lib/money.js';
import { ALL_PERMISSIONS, PERMISSIONS } from '../lib/permissions.js';

// ---------- customers ----------
export const customersRouter = Router();

/** Outstanding = credit given on sales - payments received - store-credit refunds. */
export async function customerBalance(customerId: number) {
  const rows = await prisma.$queryRaw<{ credit: string | null; paid: string | null; refunded: string | null }[]>`
    SELECT
      (SELECT SUM(balanceDue) FROM sales WHERE customerId = ${customerId} AND status <> 'VOIDED') credit,
      (SELECT SUM(amount) FROM customer_payments WHERE customerId = ${customerId}) paid,
      (SELECT SUM(rf.amount) FROM refunds rf JOIN returns r ON r.id = rf.returnId JOIN sales s ON s.id = r.saleId
        WHERE s.customerId = ${customerId} AND rf.method = 'CREDIT') refunded`;
  const r = rows[0];
  return fromCents(toCents(r.credit) - toCents(r.paid) - toCents(r.refunded));
}

const customerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[0-9+ -]{7,20}$/, 'Enter a valid phone number').optional().nullable(),
  email: z.string().email().max(120).optional().nullable().or(z.literal('')),
  notes: z.string().max(255).optional().nullable(),
});

customersRouter.get('/', requirePerm('customers.view'), ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const rows = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {},
    orderBy: { name: 'asc' }, take: 100, include: { _count: { select: { sales: true } } },
  });
  const out = await Promise.all(rows.map(async (c) => ({ ...c, balance: await customerBalance(c.id) })));
  res.json(out);
}));

customersRouter.get('/:id', requirePerm('customers.view'), ah(async (req, res) => {
  const id = idParam(req);
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      sales: { orderBy: { id: 'desc' }, take: 100, select: { id: true, invoiceNumber: true, createdAt: true, total: true, balanceDue: true, status: true } },
      payments: { orderBy: { id: 'desc' }, take: 100 },
    },
  });
  if (!c) throw notFound('Customer not found');
  res.json({ ...c, balance: await customerBalance(id) });
}));

customersRouter.post('/', requirePerm('customers.manage'), ah(async (req, res) => {
  const c = await prisma.customer.create({ data: parse(customerSchema, req.body) });
  await audit(req, 'customer.create', 'customer', c.id);
  res.status(201).json(c);
}));

customersRouter.put('/:id', requirePerm('customers.manage'), ah(async (req, res) => {
  const c = await prisma.customer.update({ where: { id: idParam(req) }, data: parse(customerSchema.partial(), req.body) });
  await audit(req, 'customer.update', 'customer', c.id);
  res.json(c);
}));

customersRouter.post('/:id/payments', requirePerm('customers.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const body = parse(z.object({ amount: z.coerce.number().positive(), method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR']), reference: z.string().max(80).optional() }), req.body);
  const bal = toCents(await customerBalance(id));
  if (toCents(body.amount) > bal) throw badRequest(`Payment exceeds the outstanding balance of ${fromCents(bal)}`);
  const p = await prisma.customerPayment.create({ data: { customerId: id, amount: fromCents(toCents(body.amount)), method: body.method, reference: body.reference, recordedById: req.user!.id } });
  await audit(req, 'customer.payment', 'customer', id, body);
  res.status(201).json(p);
}));

// ---------- warranties ----------
export const warrantiesRouter = Router();

warrantiesRouter.get('/', requirePerm('warranty.manage', 'sales.view_all'), ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.warranty.findMany({
    where: {
      ...(status ? (status === 'ACTIVE' ? { expiresAt: { gt: new Date() } } : { claimStatus: status }) : {}),
      ...(q ? { OR: [{ serialNumber: { contains: q } }, { sale: { invoiceNumber: { contains: q } } }, { sale: { customerPhone: { contains: q } } }] } : {}),
    },
    orderBy: { id: 'desc' }, take: 200,
    include: { product: { select: { name: true, sku: true } }, sale: { select: { invoiceNumber: true, customerName: true, customerPhone: true } } },
  });
  res.json(rows.map((w) => ({ ...w, isActive: w.expiresAt > new Date() })));
}));

warrantiesRouter.put('/:id', requirePerm('warranty.manage'), ah(async (req, res) => {
  const body = parse(z.object({
    claimStatus: z.enum(['NONE', 'OPEN', 'IN_REPAIR', 'REPLACED', 'REJECTED', 'CLOSED']).optional(),
    claimNotes: z.string().max(5000).optional(), resolution: z.string().max(5000).optional(), serialNumber: z.string().max(80).optional(),
  }), req.body);
  const w = await prisma.warranty.update({ where: { id: idParam(req) }, data: body });
  await audit(req, 'warranty.update', 'warranty', w.id, body);
  res.json(w);
}));

// ---------- staff, roles and permissions ----------
export const usersRouter = Router();

usersRouter.get('/', requirePerm('users.manage'), ah(async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { fullName: 'asc' }, select: { id: true, username: true, fullName: true, isActive: true, lastLoginAt: true, createdAt: true, role: { select: { id: true, code: true, name: true } } } });
  res.json(users);
}));

/** Minimal staff list (id + name) for report filters. */
usersRouter.get('/staff', requirePerm('reports.sales', 'sales.view_all', 'audit.view'), ah(async (_req, res) => {
  res.json(await prisma.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }));
}));

const userSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, '3-50 characters: letters, digits, . _ -'),
  fullName: z.string().trim().min(2).max(120),
  roleId: z.number().int().positive(),
  password: z.string().min(8).max(200),
  isActive: z.boolean().default(true),
});

usersRouter.post('/', requirePerm('users.manage'), ah(async (req, res) => {
  const { password, ...data } = parse(userSchema, req.body);
  const u = await prisma.user.create({ data: { ...data, passwordHash: await hashPassword(password) }, select: { id: true, username: true } });
  await audit(req, 'user.create', 'user', u.id, { username: u.username, roleId: data.roleId });
  res.status(201).json(u);
}));

usersRouter.put('/:id', requirePerm('users.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const { password, ...data } = parse(userSchema.partial(), req.body);
  if (id === req.user!.id && (data.isActive === false || data.roleId !== undefined)) throw badRequest('You cannot deactivate or change the role of your own account');
  const u = await prisma.user.update({
    where: { id },
    data: { ...data, ...(password ? { passwordHash: await hashPassword(password) } : {}) },
    select: { id: true, username: true, isActive: true },
  });
  if (password || data.isActive === false || data.roleId !== undefined) await prisma.session.deleteMany({ where: { userId: id } });
  await audit(req, 'user.update', 'user', id, { ...data, passwordChanged: !!password });
  res.json(u);
}));

export const rolesRouter = Router();

rolesRouter.get('/', requirePerm('users.manage'), ah(async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { id: 'asc' } });
  res.json({
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name, isSystem: r.isSystem, maxDiscountPercent: r.maxDiscountPercent, users: r._count.users, permissions: r.permissions.map((p) => p.permission.code) })),
    permissions: ALL_PERMISSIONS.map((code) => ({ code, description: PERMISSIONS[code] })),
  });
}));

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,40}$/),
  maxDiscountPercent: z.coerce.number().min(0).max(100),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
});

async function setRolePerms(roleId: number, codes: string[]) {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) }),
  ]);
}

rolesRouter.post('/', requirePerm('users.manage'), ah(async (req, res) => {
  const { permissions, ...data } = parse(roleSchema, req.body);
  const r = await prisma.role.create({ data: { ...data, maxDiscountPercent: data.maxDiscountPercent.toFixed(2) } });
  await setRolePerms(r.id, permissions);
  await audit(req, 'role.create', 'role', r.id, { ...data, permissions });
  res.status(201).json(r);
}));

rolesRouter.put('/:id', requirePerm('users.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound();
  const { permissions, ...data } = parse(roleSchema.partial(), req.body);
  if (role.code === 'admin' && permissions && !ALL_PERMISSIONS.every((p) => permissions.includes(p))) {
    throw conflict('The Admin / Owner role always keeps every permission');
  }
  await prisma.role.update({ where: { id }, data: { ...data, code: role.isSystem ? undefined : data.code, maxDiscountPercent: data.maxDiscountPercent?.toFixed(2) } });
  if (permissions) await setRolePerms(id, permissions);
  await audit(req, 'role.update', 'role', id, { ...data, permissions });
  res.json({ ok: true });
}));

// ---------- audit log ----------
export const auditRouter = Router();

auditRouter.get('/', requirePerm('audit.view'), ah(async (req, res) => {
  const q = parse(z.object({
    entity: z.string().optional(), action: z.string().optional(), userId: z.coerce.number().int().optional(),
    from: z.string().optional(), to: z.string().optional(), limit: z.coerce.number().int().max(1000).default(200),
  }), req.query);
  const r = q.from || q.to ? dateRange(q.from, q.to) : null;
  res.json(await prisma.auditLog.findMany({
    where: {
      ...(q.entity ? { entity: q.entity } : {}), ...(q.action ? { action: { contains: q.action } } : {}),
      ...(q.userId ? { userId: q.userId } : {}), ...(r ? { createdAt: { gte: r.gte, lt: r.lt } } : {}),
    },
    orderBy: { id: 'desc' }, take: q.limit,
  }));
}));

