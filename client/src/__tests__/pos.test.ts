import { describe, expect, it } from 'vitest';
import { matchProducts } from '../pages/PosPage';
import type { CatalogItem } from '../lib/offline';

const item = (id: number, name: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id, sku: `SKU-${id}`, barcode: null, name, category: 'Cables', categoryId: 1, compatibility: null, color: null, connectorType: null,
  sellingPrice: '100', minSellingPrice: '90', qtyAvailable: 5, warrantyMonths: 0, imageUrl: null, ...extra,
});

const catalog = [
  item(1, 'Privacy Tempered Glass iPhone 14/15'),
  item(2, 'Tempered Glass iPhone 15 (Full cover)'),
  item(3, 'Type-C Fast Charger 20W', { barcode: '4006381333931', brand: 'Baseus', compatibility: 'Galaxy A15' }),
  item(4, 'USB-A to Lightning Cable 1m', { connectorType: 'Lightning' }),
];

describe('POS product search', () => {
  it('an exact barcode or SKU wins (scanner input)', () => {
    expect(matchProducts(catalog, '4006381333931')[0].id).toBe(3);
    expect(matchProducts(catalog, 'sku-4')[0].id).toBe(4);
  });
  it('matches every word across name, brand, compatibility and connector', () => {
    expect(matchProducts(catalog, 'baseus a15').map((p) => p.id)).toEqual([3]);
    expect(matchProducts(catalog, 'lightning').map((p) => p.id)).toEqual([4]);
  });
  it('ranks names that start with the search first', () => {
    expect(matchProducts(catalog, 'tempered iphone 15')[0].id).toBe(2);
  });
  it('returns nothing for an empty search', () => {
    expect(matchProducts(catalog, '  ')).toEqual([]);
  });
});
