import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

// Sri Lanka has no DST; business days are counted in local time.
export const TZ_OFFSET_MINUTES = Number(process.env.TZ_OFFSET_MINUTES ?? 330);
export const TZ_SQL = (() => {
  const m = Math.abs(TZ_OFFSET_MINUTES);
  return `${TZ_OFFSET_MINUTES < 0 ? '-' : '+'}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
})();

/** Start of a local business day (YYYY-MM-DD) as a UTC Date. */
export function localDayStart(day: string): Date {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d) - TZ_OFFSET_MINUTES * 60_000);
}

export function localToday(now = new Date()): string {
  return new Date(now.getTime() + TZ_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive local date range -> [gte, lt) UTC bounds. Defaults to today. */
export function dateRange(from?: string, to?: string) {
  const f = from || localToday();
  const t = to || f;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error('Dates must be YYYY-MM-DD');
  return { from: f, to: t, gte: localDayStart(f), lt: localDayStart(addDays(t, 1)) };
}

/** Next number in a gap-free sequence; runs inside the caller's transaction (row lock held until commit). */
export async function nextSequence(tx: Tx, key: string): Promise<number> {
  await tx.$executeRaw`INSERT INTO document_sequences (\`key\`, value) VALUES (${key}, 1) ON DUPLICATE KEY UPDATE value = value + 1`;
  const rows = await tx.$queryRaw<{ value: number }[]>`SELECT value FROM document_sequences WHERE \`key\` = ${key}`;
  return Number(rows[0].value);
}

export async function getSettings(tx: Tx | PrismaClient = prisma) {
  return tx.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
