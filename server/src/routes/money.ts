import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, dateRange, localToday, getSettings } from '../db.js';
import { ah, parse, conflict, idParam } from '../lib/http.js';
import { requirePerm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { fromCents, toCents } from '../lib/money.js';

// ---------- expenses ----------
export const expensesRouter = Router();

export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Salaries', 'Transport', 'Packaging', 'Internet & phone', 'Repairs', 'Marketing', 'Other'];

const attachment = multer({
  storage: multer.diskStorage({
    destination: path.resolve('uploads'),
    filename: (_r, f, cb) => cb(null, `exp-${crypto.randomUUID()}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^(image\/(png|jpe?g|webp)|application\/pdf)$/.test(f.mimetype)),
});

expensesRouter.get('/categories', requirePerm('expenses.view', 'expenses.manage'), (_req, res) => res.json(EXPENSE_CATEGORIES));

expensesRouter.get('/', requirePerm('expenses.view'), ah(async (req, res) => {
  const q = parse(z.object({ from: z.string().optional(), to: z.string().optional(), category: z.string().optional() }), req.query);
  const r = dateRange(q.from, q.to);
  const rows = await prisma.expense.findMany({
    where: { expenseDate: { gte: new Date(`${r.from}T00:00:00Z`), lte: new Date(`${r.to}T00:00:00Z`) }, ...(q.category ? { category: q.category } : {}) },
    orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
  });
  res.json(rows);
}));

expensesRouter.post('/', requirePerm('expenses.manage'), attachment.single('attachment'), ah(async (req, res) => {
  const body = parse(z.object({
    category: z.string().trim().min(2).max(60),
    description: z.string().trim().min(2).max(255),
    amount: z.coerce.number().positive().max(100_000_000),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR']),
    reference: z.string().max(80).optional(),
    paidFromDrawer: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
  }), req.body);
  const e = await prisma.expense.create({
    data: {
      ...body, amount: fromCents(toCents(body.amount)), expenseDate: new Date(`${body.expenseDate}T00:00:00Z`),
      paidFromDrawer: body.method === 'CASH' && body.paidFromDrawer,
      attachmentUrl: req.file ? `/uploads/${req.file.filename}` : null, recordedById: req.user!.id,
    },
  });
  await audit(req, 'expense.create', 'expense', e.id, { category: e.category, amount: e.amount });
  res.status(201).json(e);
}));

expensesRouter.delete('/:id', requirePerm('expenses.manage'), ah(async (req, res) => {
  const e = await prisma.expense.findUniqueOrThrow({ where: { id: idParam(req) } });
  const closed = await prisma.cashClosing.findUnique({ where: { businessDate: e.expenseDate } });
  if (closed && e.paidFromDrawer) throw conflict('That day is already closed; record a correcting entry instead');
  await prisma.expense.delete({ where: { id: e.id } });
  await audit(req, 'expense.delete', 'expense', e.id, { category: e.category, amount: e.amount, description: e.description });
  res.json({ ok: true });
}));

// ---------- daily cash closing ----------
export const cashRouter = Router();

/** Expected drawer cash for a business day. Card, transfer and QR never count as drawer cash. */
export async function cashSummary(day: string) {
  const r = dateRange(day, day);
  const sum = async (q: Prisma.Sql) => toCents((await prisma.$queryRaw<{ v: string | null }[]>(q))[0]?.v);
  const [cashSales, cashCollections, cashRefunds, cashExpenses] = await Promise.all([
    sum(Prisma.sql`SELECT SUM(p.amount) v FROM payments p JOIN sales s ON s.id = p.saleId WHERE p.method = 'CASH' AND s.status <> 'VOIDED' AND s.createdAt >= ${r.gte} AND s.createdAt < ${r.lt}`),
    sum(Prisma.sql`SELECT SUM(amount) v FROM customer_payments WHERE method = 'CASH' AND createdAt >= ${r.gte} AND createdAt < ${r.lt}`),
    sum(Prisma.sql`SELECT SUM(amount) v FROM refunds WHERE method = 'CASH' AND createdAt >= ${r.gte} AND createdAt < ${r.lt}`),
    sum(Prisma.sql`SELECT SUM(amount) v FROM expenses WHERE paidFromDrawer = 1 AND expenseDate = ${new Date(`${day}T00:00:00Z`)}`),
  ]);
  const nonCash = await prisma.$queryRaw<{ method: string; v: string }[]>`
    SELECT p.method, SUM(p.amount) v FROM payments p JOIN sales s ON s.id = p.saleId
    WHERE p.method <> 'CASH' AND s.status <> 'VOIDED' AND s.createdAt >= ${r.gte} AND s.createdAt < ${r.lt} GROUP BY p.method`;
  return {
    cashSales, cashCollections, cashRefunds, cashExpenses,
    nonCashTotals: Object.fromEntries(nonCash.map((n) => [n.method, Number(n.v).toFixed(2)])),
  };
}

cashRouter.get('/summary', requirePerm('cash.close'), ah(async (req, res) => {
  const day = typeof req.query.date === 'string' ? req.query.date : localToday();
  const s = await cashSummary(day);
  const closing = await prisma.cashClosing.findUnique({ where: { businessDate: new Date(`${day}T00:00:00Z`) } });
  res.json({
    date: day,
    cashSales: fromCents(s.cashSales), cashCollections: fromCents(s.cashCollections),
    cashRefunds: fromCents(s.cashRefunds), cashExpenses: fromCents(s.cashExpenses),
    expectedBeforeFloat: fromCents(s.cashSales + s.cashCollections - s.cashRefunds - s.cashExpenses),
    nonCashTotals: s.nonCashTotals, closing,
  });
}));

cashRouter.post('/close', requirePerm('cash.close'), ah(async (req, res) => {
  const body = parse(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    openingFloat: z.coerce.number().min(0), countedCash: z.coerce.number().min(0), notes: z.string().max(255).optional(),
  }), req.body);
  const day = body.date ?? localToday();
  const s = await cashSummary(day);
  const expected = toCents(body.openingFloat) + s.cashSales + s.cashCollections - s.cashRefunds - s.cashExpenses;
  const counted = toCents(body.countedCash);
  const c = await prisma.cashClosing.create({
    data: {
      businessDate: new Date(`${day}T00:00:00Z`), openingFloat: fromCents(toCents(body.openingFloat)),
      cashSales: fromCents(s.cashSales), cashCollections: fromCents(s.cashCollections), cashRefunds: fromCents(s.cashRefunds),
      cashExpenses: fromCents(s.cashExpenses), expectedCash: fromCents(expected), countedCash: fromCents(counted),
      difference: fromCents(counted - expected), nonCashTotals: s.nonCashTotals, notes: body.notes, closedById: req.user!.id,
    },
  }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict(`${day} has already been closed`);
    throw e;
  });
  await audit(req, 'cash.close', 'cash_closing', c.id, { day, expected: c.expectedCash, counted: c.countedCash, difference: c.difference });
  res.status(201).json(c);
}));

cashRouter.get('/closings', requirePerm('cash.close', 'reports.financial'), ah(async (req, res) => {
  const r = dateRange(String(req.query.from ?? localToday()), String(req.query.to ?? req.query.from ?? localToday()));
  res.json(await prisma.cashClosing.findMany({
    where: { businessDate: { gte: new Date(`${r.from}T00:00:00Z`), lte: new Date(`${r.to}T00:00:00Z`) } }, orderBy: { businessDate: 'desc' },
  }));
}));

// ---------- business settings ----------
export const settingsRouter = Router();

settingsRouter.get('/', ah(async (_req, res) => res.json(await getSettings())));

const logoUpload = multer({
  storage: multer.diskStorage({ destination: path.resolve('uploads'), filename: (_r, f, cb) => cb(null, `logo-${Date.now()}${path.extname(f.originalname).toLowerCase()}`) }),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^image\/(png|jpe?g)$/.test(f.mimetype)),
});

settingsRouter.post('/logo', requirePerm('settings.manage'), logoUpload.single('logo'), ah(async (req, res) => {
  if (!req.file) throw conflict('Upload a PNG or JPG up to 1 MB', 'BAD_FILE');
  const s = await prisma.businessSettings.update({ where: { id: 1 }, data: { logoUrl: `/uploads/${req.file.filename}` } });
  await audit(req, 'settings.logo', 'settings', 1);
  res.json(s);
}));

settingsRouter.put('/', requirePerm('settings.manage'), ah(async (req, res) => {
  await getSettings();
  const body = parse(z.object({
    shopName: z.string().trim().min(2).max(120), address: z.string().max(255), phone: z.string().max(60), email: z.string().max(120),
    logoUrl: z.string().max(255).nullable(), receiptWidth: z.union([z.literal(58), z.literal(80)]),
    defaultPrintFormat: z.enum(['58', '80', 'A4']), receiptFooter: z.string().max(255), warrantyPolicy: z.string().max(3000),
    taxLabel: z.string().max(20), taxRate: z.coerce.number().min(0).max(50), taxRegNo: z.string().max(60),
    invoicePrefix: z.string().regex(/^[A-Z0-9]{1,10}$/, 'Up to 10 capital letters/digits'), currency: z.string().max(10), language: z.enum(['en', 'si']),
  }).partial(), req.body);
  const s = await prisma.businessSettings.update({ where: { id: 1 }, data: { ...body, taxRate: body.taxRate?.toFixed(2) } });
  await audit(req, 'settings.update', 'settings', 1, body);
  res.json(s);
}));
