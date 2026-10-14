import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, 'BAD_REQUEST', details);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND');
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m, 'FORBIDDEN');
export const conflict = (m: string, code = 'CONFLICT', details?: unknown) => new HttpError(409, m, code, details);

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(422, 'Validation failed', 'VALIDATION', r.error.flatten());
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ error: { code: 'VALIDATION', message: 'Validation failed', details: err.flatten() } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string | string[] | undefined) ?? '';
      return res.status(409).json({ error: { code: 'DUPLICATE', message: `Duplicate value for ${String(target)}` } });
    }
    if (err.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    if (err.code === 'P2003') return res.status(409).json({ error: { code: 'IN_USE', message: 'Record is referenced by other data' } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Unexpected server error' } });
}
