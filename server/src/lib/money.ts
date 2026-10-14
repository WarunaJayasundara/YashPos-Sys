// Money helpers: all arithmetic is done in integer cents to avoid float drift.
type DecimalLike = { toString(): string } | number | string | null | undefined;

export function toCents(v: DecimalLike): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v.toString());
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${String(v)}`);
  return Math.round(n * 100);
}

export function fromCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(Math.round(c));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function num(v: DecimalLike): number {
  if (v === null || v === undefined || v === '') return 0;
  return typeof v === 'number' ? v : Number(v.toString());
}

// Split `total` cents across `weights` proportionally; remainders go to the largest weights so the parts sum exactly.
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(r));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) parts[order[k].i] += 1;
  return parts;
}
