import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Upload } from 'lucide-react';
import { api, ApiError, errorText, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import type { Named, Product } from '../lib/types';
import { Badge, Button, Card, ErrorBox, Input, Loading, Modal, PageHeader, Select, STOCK_BADGE } from '../components/ui';
import { DataTable } from '../components/Table';
import { ProductForm } from '../components/ProductForm';
import { useToast } from '../components/toast';

export default function ProductsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(term);
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const status = sp.get('status') ?? '';
  const categoryId = sp.get('categoryId') ?? '';
  const brandId = sp.get('brandId') ?? '';
  const active = sp.get('active') ?? 'true';
  const showCost = can('products.view_cost');

  useEffect(() => { const t = setTimeout(() => setDebounced(term), 250); return () => clearTimeout(t); }, [term]);
  useEffect(() => setPage(1), [debounced, status, categoryId, brandId, active]);

  const filters = { q: debounced, status, categoryId, brandId, active, page, pageSize: 50 };
  const q = useQuery({ queryKey: ['products', filters], queryFn: () => api.get<{ total: number; data: Product[] }>(`/products${qs(filters)}`), placeholderData: (p) => p });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api.get<Named[]>('/categories') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api.get<Named[]>('/brands') });
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const exportCsv = () => window.open(`/api/products/export${qs({ q: debounced, status, categoryId, brandId, active })}`, '_blank');

  return (
    <div>
      <PageHeader title="Products" subtitle={q.data ? `${q.data.total} product(s)` : undefined} actions={can('products.manage') && <>
        <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Import</Button>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New product</Button>
      </>} />
      <Card>
        <div className="grid gap-2 border-b border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Search name, SKU, barcode, model..." value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search products" wrapClass="lg:col-span-2" />
          <Select value={categoryId} onChange={(e) => setParam('categoryId', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={brandId} onChange={(e) => setParam('brandId', e.target.value)} aria-label="Brand">
            <option value="">All brands</option>
            {brands.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Stock status" wrapClass="flex-1">
              <option value="">Any stock</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option><option value="OVER">Overstock</option><option value="OK">Healthy</option>
            </Select>
            <Select value={active} onChange={(e) => setParam('active', e.target.value)} aria-label="Active status" wrapClass="flex-1">
              <option value="true">Active</option><option value="false">Inactive</option><option value="all">All</option>
            </Select>
          </div>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div> : (
          <>
            <DataTable
              rows={q.data!.data}
              rowKey={(p) => p.id}
              onRowClick={(p) => nav(`/products/${p.id}`)}
              empty="No products found"
              columns={[
                { key: 'name', header: 'Product', primary: true, render: (p) => <div><span className="font-medium">{p.name}</span>{!p.isActive && <Badge className="ml-2">Inactive</Badge>}<div className="text-xs font-normal text-slate-500">{p.sku}{p.compatibility ? ` · ${p.compatibility}` : ''}</div></div> },
                { key: 'cat', header: 'Category', render: (p) => p.category, hideMobile: true },
                { key: 'brand', header: 'Brand', render: (p) => p.brand ?? '-', hideMobile: true },
                ...(showCost ? [{ key: 'cost', header: 'Avg cost', num: true, render: (p: Product) => money(p.avgCost) }] : []),
                { key: 'price', header: 'Selling', num: true, render: (p) => money(p.sellingPrice) },
                ...(showCost ? [{ key: 'margin', header: 'Margin', num: true, render: (p: Product) => (p.marginPercent == null ? '-' : `${p.marginPercent}%`) }] : []),
                { key: 'qty', header: 'Available', num: true, render: (p) => <span className="font-semibold">{p.qtyAvailable}</span> },
                { key: 'st', header: 'Status', render: (p) => <Badge tone={STOCK_BADGE[p.stockStatus].tone}>{STOCK_BADGE[p.stockStatus].label}</Badge> },
              ]}
            />
            {q.data!.total > 50 && (
              <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm">
                <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span>Page {page} of {Math.ceil(q.data!.total / 50)}</span>
                <Button size="sm" variant="secondary" disabled={page * 50 >= q.data!.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="New product" wide>
        <ProductForm onCancel={() => setCreating(false)} onSaved={(p) => { setCreating(false); qc.invalidateQueries({ queryKey: ['products'] }); nav(`/products/${p.id}`); }} />
      </Modal>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={(m) => { toast(m); qc.invalidateQueries({ queryKey: ['products'] }); }} />
    </div>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<{ row: number; message: string }[]>([]);
  const [error, setError] = useState('');
  const template = 'sku,name,category,brand,barcode,compatibility,color,size,connectorType,purchasePrice,sellingPrice,minSellingPrice,reorderLevel,warrantyMonths,openingStock\nCBL-TC1M,Type-C Cable 1m,Cables,Anker,,Android,Black,1m,USB-C,450,850,700,5,6,10\n';
  const submit = async () => {
    if (!file) return;
    setBusy(true); setProblems([]); setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post<{ created: number; updated: number }>('/products/import', fd);
      onDone(`Imported: ${r.created} created, ${r.updated} updated`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.details)) setProblems(e.details as { row: number; message: string }[]);
      setError(errorText(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Import products from CSV" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!file} onClick={submit}>Import</Button></>}>
      <div className="space-y-3 text-sm">
        <p>Rows with an existing SKU update that product (price changes go into price history). New SKUs are created with their opening stock. If any row is invalid, nothing is imported.</p>
        <a className="text-brand-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="products-template.csv">Download template</a>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="CSV file" />
        {error && <p className="text-red-700">{error}</p>}
        {problems.length > 0 && <ul className="max-h-40 overflow-y-auto rounded bg-red-50 p-2 text-xs text-red-800">{problems.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}</ul>}
      </div>
    </Modal>
  );
}
