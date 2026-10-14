import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, fieldErrors, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, toNum } from '../lib/format';
import type { Named, Product } from '../lib/types';
import { Button, Input, Select, Textarea } from './ui';
import { useToast } from './toast';
import { useApproval } from './Approval';
import { ApiError } from '../lib/api';

type Form = Record<string, string | boolean>;

const blank: Form = {
  sku: '', barcode: '', name: '', description: '', categoryId: '', brandId: '', supplierId: '', variantGroup: '', compatibility: '', color: '', size: '',
  connectorType: '', purchasePrice: '', sellingPrice: '', minSellingPrice: '', reorderLevel: '5', maxStockLevel: '', warrantyMonths: '0', imageUrl: '',
  isActive: true, openingStock: '0', priceChangeReason: '',
};

export function ProductForm({ product, onSaved, onCancel }: { product?: Product; onSaved: (p: Product) => void; onCancel: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { run, dialog } = useApproval();
  const showCost = can('products.view_cost');
  const [f, setF] = useState<Form>(() => product ? {
    ...blank, ...Object.fromEntries(Object.entries(product).map(([k, v]) => [k, v === null || v === undefined ? '' : typeof v === 'boolean' ? v : String(v)])),
  } : blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Named[]>('/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<Named[]>('/brands') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<Named[]>('/suppliers'), enabled: showCost && can('purchases.view', 'suppliers.manage') });

  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const priceChanged = product && (toNum(f.sellingPrice as string) !== toNum(product.sellingPrice) || toNum(f.minSellingPrice as string) !== toNum(product.minSellingPrice));
  const sell = toNum(f.sellingPrice as string), cost = toNum(f.purchasePrice as string);

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const r = await api.post<{ url: string }>('/products/upload-image', fd);
      setF((x) => ({ ...x, imageUrl: r.url }));
    } catch (e) { toast(errorText(e), 'error'); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const s = (k: string) => (String(f[k]).trim() === '' ? null : String(f[k]).trim());
    const n = (k: string) => (String(f[k]).trim() === '' ? null : Number(f[k]));
    const body: Record<string, unknown> = {
      sku: s('sku'), barcode: s('barcode'), name: s('name'), description: s('description'), categoryId: n('categoryId'), brandId: n('brandId'),
      variantGroup: s('variantGroup'), compatibility: s('compatibility'), color: s('color'), size: s('size'), connectorType: s('connectorType'),
      sellingPrice: n('sellingPrice'), minSellingPrice: n('minSellingPrice'), reorderLevel: n('reorderLevel') ?? 0, maxStockLevel: n('maxStockLevel'),
      warrantyMonths: n('warrantyMonths') ?? 0, imageUrl: s('imageUrl'), isActive: !!f.isActive,
    };
    if (showCost) { body.purchasePrice = n('purchasePrice') ?? 0; body.supplierId = n('supplierId'); }
    if (!product) body.openingStock = n('openingStock') ?? 0;
    if (priceChanged) body.priceChangeReason = s('priceChangeReason') ?? undefined;
    try {
      const p = product ? await run((approval) => api.put<Product>(`/products/${product.id}`, { ...body, approval })) : await api.post<Product>('/products', body);
      toast(product ? 'Product updated' : 'Product created');
      onSaved(p);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'APPROVAL_CANCELLED') return;
      setErrors(fieldErrors(err));
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {dialog}
    <form onSubmit={submit} className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Basic details</legend>
        <Input label="Product name *" value={f.name as string} onChange={set('name')} error={errors.name} required wrapClass="sm:col-span-2" />
        <Input label="SKU *" value={f.sku as string} onChange={set('sku')} error={errors.sku} required hint="Unique code, e.g. CHG-TC20" />
        <Input label="Barcode" value={f.barcode as string} onChange={set('barcode')} error={errors.barcode} hint="Scan or type; EAN/UPC check digits are verified" />
        <Select label="Category *" value={f.categoryId as string} onChange={set('categoryId')} error={errors.categoryId} required>
          <option value="">Choose...</option>
          {cats.data?.filter((c) => c.isActive !== false || String(c.id) === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Brand" value={f.brandId as string} onChange={set('brandId')}>
          <option value="">No brand</option>
          {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <Textarea label="Description" value={f.description as string} onChange={set('description')} wrapClass="sm:col-span-2" />
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Compatibility and variant</legend>
        <Input label="Compatible models" value={f.compatibility as string} onChange={set('compatibility')} wrapClass="sm:col-span-3" placeholder="e.g. iPhone 15, Galaxy A15" />
        <Input label="Colour" value={f.color as string} onChange={set('color')} />
        <Input label="Size / length" value={f.size as string} onChange={set('size')} />
        <Input label="Connector type" value={f.connectorType as string} onChange={set('connectorType')} placeholder="USB-C, Lightning..." />
        <Input label="Variant group" value={f.variantGroup as string} onChange={set('variantGroup')} hint="Same value links colour/size variants" wrapClass="sm:col-span-3" />
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Pricing</legend>
        {showCost && <Input label="Buying price" type="number" min={0} step="0.01" value={f.purchasePrice as string} onChange={set('purchasePrice')} error={errors.purchasePrice} />}
        <Input label="Selling price *" type="number" min={0} step="0.01" value={f.sellingPrice as string} onChange={set('sellingPrice')} error={errors.sellingPrice} required />
        <Input label="Minimum selling price *" type="number" min={0} step="0.01" value={f.minSellingPrice as string} onChange={set('minSellingPrice')} error={errors.minSellingPrice} required hint="Below this needs approval" />
        {showCost && sell > 0 && <p className="text-sm text-slate-600 sm:col-span-3">Profit per unit at this price: <b>{money(sell - cost)}</b> ({(((sell - cost) / sell) * 100).toFixed(1)}% margin){product && <> · current average cost {money(product.avgCost)}</>}</p>}
        {showCost && suppliers.data && (
          <Select label="Main supplier" value={f.supplierId as string} onChange={set('supplierId')}>
            <option value="">None</option>
            {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
        {priceChanged && <Input label="Reason for price change" value={f.priceChangeReason as string} onChange={set('priceChangeReason')} wrapClass="sm:col-span-2" />}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Stock and warranty</legend>
        {!product && <Input label="Opening stock" type="number" min={0} value={f.openingStock as string} onChange={set('openingStock')} hint="Recorded as an opening movement" />}
        <Input label="Reorder level" type="number" min={0} value={f.reorderLevel as string} onChange={set('reorderLevel')} />
        <Input label="Max stock (overstock)" type="number" min={0} value={f.maxStockLevel as string} onChange={set('maxStockLevel')} />
        <Input label="Warranty (months)" type="number" min={0} max={120} value={f.warrantyMonths as string} onChange={set('warrantyMonths')} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        {f.imageUrl && <img src={f.imageUrl as string} alt="" className="h-16 w-16 rounded-lg border object-cover" />}
        <label className="text-sm"><span className="label">Product image</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="h-4 w-4" />Active (can be sold)</label>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{product ? 'Save changes' : 'Create product'}</Button>
      </div>
    </form>
    </>
  );
}
