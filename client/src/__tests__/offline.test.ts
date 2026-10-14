import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalog, listPending, queueSale, syncPending, discardPending } from '../lib/offline';

const product = { id: 7, sku: 'X', barcode: null, name: 'Cable', category: 'Cables', categoryId: 1, compatibility: null, color: null, connectorType: null, sellingPrice: '850', minSellingPrice: '700', qtyAvailable: 5, warrantyMonths: 0, imageUrl: null };

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown } | 'network') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }));
}

const sale = (id: string) => ({ clientRequestId: id, payload: { clientRequestId: id, items: [{ productId: 7, qty: 2 }] }, username: 'cashier', total: 1700, summary: '2 x Cable' });

beforeEach(async () => {
  for (const p of await listPending()) await discardPending(p.clientRequestId);
  mockFetch((url) => (url.includes('/products/catalog') ? { status: 200, body: { syncedAt: new Date().toISOString(), data: [product] } } : { status: 201, body: {} }));
  const { syncCatalog } = await import('../lib/offline');
  await syncCatalog();
});

describe('offline sales queue', () => {
  it('queued sales are pending, reduce local stock, and are removed once the server accepts them', async () => {
    await queueSale(sale('a1'));
    expect((await listPending()).map((p) => p.status)).toEqual(['PENDING']);
    expect((await getCatalog())[0].qtyAvailable).toBe(3);
    const posted: string[] = [];
    mockFetch((url, init) => {
      if (url.includes('/products/catalog')) return { status: 200, body: { syncedAt: new Date().toISOString(), data: [{ ...product, qtyAvailable: 3 }] } };
      posted.push(JSON.parse(String(init?.body)).clientRequestId);
      return { status: 201, body: { sale: { id: 1 } } };
    });
    const r = await syncPending('cashier');
    expect(r).toEqual({ synced: 1, conflicts: 0 });
    expect(posted).toEqual(['a1']); // the same idempotency key the POS generated
    expect(await listPending()).toHaveLength(0);
  });

  it('keeps a sale pending when the network is still down', async () => {
    await queueSale(sale('b1'));
    mockFetch(() => 'network');
    const r = await syncPending('cashier');
    expect(r.synced).toBe(0);
    const [p] = await listPending();
    expect(p.status).toBe('PENDING');
  });

  it('marks stock conflicts for reconciliation instead of dropping them', async () => {
    await queueSale(sale('c1'));
    mockFetch(() => ({ status: 409, body: { error: { code: 'INSUFFICIENT_STOCK', message: 'Not enough stock for Cable' } } }));
    const r = await syncPending('cashier');
    expect(r.conflicts).toBe(1);
    const [p] = await listPending();
    expect(p.status).toBe('CONFLICT');
    expect(p.error).toMatch(/Not enough stock/);
  });

  it('only the cashier who made the sale can sync it', async () => {
    await queueSale(sale('d1'));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await syncPending('someone-else');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('discarding a pending sale gives the stock back locally', async () => {
    await queueSale(sale('e1'));
    expect((await getCatalog())[0].qtyAvailable).toBe(3);
    await discardPending('e1');
    expect((await getCatalog())[0].qtyAvailable).toBe(5);
  });
});
