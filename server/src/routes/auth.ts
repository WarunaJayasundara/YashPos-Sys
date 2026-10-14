import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah, parse, HttpError } from '../lib/http.js';
import { createSession, destroySession, hashPassword, loadAuthUser, requireAuth, verifyCredentials, type AuthUser } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import bcrypt from 'bcryptjs';

export const authRouter = Router();

const limited = { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } };
// per account (one mistyping cashier does not lock out the others) plus a looser per-IP cap
const accountLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: Number(process.env.LOGIN_RATE_LIMIT ?? 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username ?? '').toLowerCase()}`,
  message: limited,
});
const ipLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 100, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: limited });
const loginLimiter = [ipLimiter, accountLimiter];

export const publicUser = (u: AuthUser) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.roleCode,
  roleName: u.roleName,
  maxDiscountPercent: u.maxDiscountPercent,
  permissions: [...u.permissions].sort(),
});

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { username, password } = parse(z.object({ username: z.string().min(1).max(50), password: z.string().min(1).max(200) }), req.body);
    const userId = await verifyCredentials(username, password);
    if (!userId) {
      await audit(req, 'auth.login_failed', 'user', null, { username });
      throw new HttpError(401, 'Incorrect username or password', 'BAD_CREDENTIALS');
    }
    await createSession(res, req, userId);
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    const user = (await loadAuthUser(userId))!;
    req.user = user;
    await audit(req, 'auth.login', 'user', userId);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    if (req.user) await audit(req, 'auth.logout', 'user', req.user.id);
    await destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post(
  '/change-password',
  requireAuth,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }),
      req.body,
    );
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(currentPassword, u.passwordHash))) throw new HttpError(400, 'Current password is incorrect', 'BAD_CREDENTIALS');
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(newPassword) } });
    await prisma.session.deleteMany({ where: { userId: u.id, NOT: { id: req.sessionId } } });
    await audit(req, 'auth.change_password', 'user', u.id);
    res.json({ ok: true });
  }),
);
