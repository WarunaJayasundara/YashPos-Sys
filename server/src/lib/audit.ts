import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';

export async function audit(
  req: Request | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details?: unknown,
  tx: Tx = prisma,
) {
  await tx.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      username: req?.user?.username ?? null,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      details: details === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue),
      ip: req?.ip ?? null,
    },
  });
}
