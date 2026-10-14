type Num = number | string | null | undefined;

export const toNum = (v: Num) => (v === null || v === undefined || v === '' ? 0 : Number(v));

export const money = (v: Num, cur = 'Rs.') =>
  `${cur} ${toNum(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const plain = (v: Num) => toNum(v).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const int = (v: Num) => toNum(v).toLocaleString('en-LK');

const TZ = 'Asia/Colombo';
export const dateTime = (d: string | Date) => new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dateOnly = (d: string | Date) => new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });

/** Today in Sri Lanka as YYYY-MM-DD. */
export const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() + 330 * 60_000 - n * 86400_000).toISOString().slice(0, 10);
export const monthStart = () => `${today().slice(0, 8)}01`;

export const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', QR: 'QR', CREDIT: 'On account' };

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
