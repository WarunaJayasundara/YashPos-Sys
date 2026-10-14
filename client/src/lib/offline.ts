import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { api, ApiError } from './api';

export interface CatalogItem {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  brand?: string;
  category: string;
  categoryId: number;
  compatibility: string | null;
  color: string | null;
  connectorType: string | null;
  sellingPrice: string;
  minSellingPrice: string;
  qtyAvailable: number;
  warrantyMonths: number;
  imageUrl: string | null;
}

export type PendingStatus = 'PENDING' | 'SYNCING' | 'CONFLICT';

export interface PendingSale {
  clientRequestId: string;
  payload: Record<string, unknown>;
  username: string;
  createdAt: string;
  status: PendingStatus;
  error?: string;
  total: number;
  summary: string;
}

interface PosDB extends DBSchema {
  catalog: { key: number; value: CatalogItem };
  meta: { key: string; value: { key: string; value: string } };
  pending: { key: string; value: PendingSale };
}

let dbp: Promise<IDBPDatabase<PosDB>> | null = null;
const db = () =>
  (dbp ??= openDB<PosDB>('yash-pos', 1, {
    upgrade(d) {
      d.createObjectStore('catalog', { keyPath: 'id' });
      d.createObjectStore('meta', { keyPath: 'key' });
      d.createObjectStore('pending', { keyPath: 'clientRequestId' });
    },
  }));

/** Caches the cost-free product catalogue for offline lookup. */
export async function syncCatalog() {
  const r = await api.get<{ syncedAt: string; data: CatalogItem[] }>('/products/catalog');
  const d = await db();
  const tx = d.transaction(['catalog', 'meta'], 'readwrite');
  await tx.objectStore('catalog').clear();
  for (const p of r.data) await tx.objectStore('catalog').put(p);
  await tx.objectStore('meta').put({ key: 'catalogSyncedAt', value: r.syncedAt });
  await tx.done;
  // re-apply local reservations from sales still waiting to sync
  for (const s of await listPending()) await reserveLocally(s.payload, -1);
  return r.syncedAt;
}

export async function getCatalog() {
  return (await db()).getAll('catalog');
}

export async function lastSyncedAt() {
  return (await (await db()).get('meta', 'catalogSyncedAt'))?.value ?? null;
}

async function reserveLocally(payload: Record<string, unknown>, sign: 1 | -1) {
  const d = await db();
  for (const it of (payload.items as { productId: number; qty: number }[]) ?? []) {
    const p = await d.get('catalog', it.productId);
    if (p) await d.put('catalog', { ...p, qtyAvailable: p.qtyAvailable + sign * it.qty });
  }
}

/** Stores a sale for later. It is NOT a completed sale until the server accepts it. */
export async function queueSale(s: Omit<PendingSale, 'status' | 'createdAt'>) {
  const d = await db();
  await d.put('pending', { ...s, status: 'PENDING', createdAt: new Date().toISOString() });
  await reserveLocally(s.payload, -1);
  window.dispatchEvent(new Event('yash:pending-changed'));
}

export async function listPending() {
  return (await (await db()).getAll('pending')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function discardPending(id: string) {
  const d = await db();
  const s = await d.get('pending', id);
  if (s) {
    await d.delete('pending', id);
    await reserveLocally(s.payload, 1);
  }
  window.dispatchEvent(new Event('yash:pending-changed'));
}

let syncing = false;

/**
 * Sends queued sales one by one. The server is idempotent on clientRequestId, so a retry after a
 * lost response cannot create a second sale. Stock conflicts are kept for manual reconciliation.
 */
export async function syncPending(currentUsername: string) {
  if (syncing) return { synced: 0, conflicts: 0 };
  syncing = true;
  let synced = 0, conflicts = 0;
  try {
    const d = await db();
    for (const s of await listPending()) {
      if (s.status === 'CONFLICT' || s.username !== currentUsername) continue;
      await d.put('pending', { ...s, status: 'SYNCING' });
      try {
        await api.post('/sales', s.payload);
        await d.delete('pending', s.clientRequestId);
        synced++;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 401)) {
          await d.put('pending', { ...s, status: 'PENDING', error: e.status === 401 ? 'Sign in again to sync' : 'Waiting for connection' });
          break;
        }
        await d.put('pending', { ...s, status: 'CONFLICT', error: e instanceof Error ? e.message : 'Rejected by server' });
        conflicts++;
      }
    }
  } finally {
    syncing = false;
    window.dispatchEvent(new Event('yash:pending-changed'));
  }
  if (synced) await syncCatalog().catch(() => undefined);
  return { synced, conflicts };
}

export async function retryConflict(id: string) {
  const d = await db();
  const s = await d.get('pending', id);
  if (s) await d.put('pending', { ...s, status: 'PENDING', error: undefined });
}

/** On sign-out: drop the cached catalogue. Unsynced sales are kept (they are money). */
export async function clearSensitiveCache() {
  try {
    const d = await db();
    await d.clear('catalog');
    await d.delete('meta', 'catalogSyncedAt');
  } catch {
    /* IndexedDB unavailable */
  }
}
