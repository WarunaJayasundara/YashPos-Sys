import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { HttpError, forbidden } from './http.js';
import type { PermissionCode } from './permissions.js';

export const SESSION_COOKIE = 'yash_sid';
const TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600_000;

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  maxDiscountPercent: number;
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export async function loadAuthUser(userId: number): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!u || !u.isActive) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    roleCode: u.role.code,
    roleName: u.role.name,
    maxDiscountPercent: Number(u.role.maxDiscountPercent),
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.code)),
  };
}

/** Checks a username/password pair. Returns the user id or null (constant-ish time). */
export async function verifyCredentials(username: string, password: string): Promise<number | null> {
  const u = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  const hash = u?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  return ok && u && u.isActive ? u.id : null;
}

export async function createSession(res: Response, req: Request, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + TTL_MS),
      userAgent: req.get('user-agent')?.slice(0, 255),
      ip: req.ip,
    },
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: TTL_MS,
    path: '/',
  });
}

export async function destroySession(req: Request, res: Response) {
  if (req.sessionId) await prisma.session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Attaches req.user when a valid session cookie is present. Sliding expiry. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const id = hashToken(token);
      const s = await prisma.session.findUnique({ where: { id } });
      if (s && s.expiresAt > new Date()) {
        const user = await loadAuthUser(s.userId);
        if (user) {
          req.user = user;
          req.sessionId = id;
          if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
            await prisma.session.update({ where: { id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) } });
          }
        }
      } else if (s) {
        await prisma.session.delete({ where: { id } }).catch(() => undefined);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** CSRF defence: state-changing requests must carry a custom header (browsers block it cross-site without CORS). */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'yash-pos') return next(new HttpError(403, 'Missing CSRF header', 'CSRF'));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in', 'UNAUTHENTICATED'));
  next();
}

export const can = (req: Request, p: PermissionCode) => !!req.user?.permissions.has(p);

export const requirePerm =
  (...perms: PermissionCode[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in', 'UNAUTHENTICATED'));
    if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden());
    next();
  };

export interface ApprovalInput {
  username: string;
  password: string;
}

/**
 * Supervisor override. If the current user holds `perm`, they approve their own action.
 * Otherwise a supervisor's credentials must be supplied; returns the approver's user id.
 */
export async function resolveApproval(req: Request, perm: PermissionCode, approval: ApprovalInput | undefined, what: string) {
  if (can(req, perm)) return req.user!.id;
  if (!approval?.username || !approval?.password) {
    throw new HttpError(403, `${what} needs supervisor approval`, 'APPROVAL_REQUIRED', { permission: perm });
  }
  const approverId = await verifyCredentials(approval.username, approval.password);
  const approver = approverId ? await loadAuthUser(approverId) : null;
  if (!approver || !approver.permissions.has(perm)) {
    throw new HttpError(403, 'Approver credentials are invalid or lack permission', 'APPROVAL_INVALID', { permission: perm });
  }
  return approver.id;
}
