import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, PackageMinus, Trash2 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, int, money } from '../lib/format';
import type { Product } from '../lib/types';
import { Badge, Button, Card, Confirm, ErrorBox, Loading, Modal, PageHeader, Stat, STOCK_BADGE } from '../components/ui';
import { useToast } from '../components/toast';
import { UndoStock } from '../components/UndoStock';
import { ProductForm } from '../components/ProductForm';
import { AdjustmentForm } from './StockPage';

interface Detail extends Product {
  lifetime?: { unitsSold: number; unitsReceived: number; netRevenue: string; cogs: string; grossProfit: string; potentialProfitOnStock: string };
  priceHistory?: { id: number; field: string; oldValue: string; newValue: string; reason: string | null; createdAt: string }[];
  variants: { id: number; name: string; sku: string; color: string | null; size: string | null; qtyOnHand: number }[];
}
interface Move { id: number; type: string; qtyChange: number; qtyAfter: number; unitCost?: string; refType: string | null; refId: number | null; reason: string | null; createdAt: string; undone?: boolean; canUndo?: boolean }

const FIELD: Record<string, string> = { sellingPrice: 'Selling price', minSellingPrice: 'Minimum price', purchasePrice: 'Buying price' };

export default function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Detail>(`/products/${id}`) });
  const moves = useQuery({ queryKey: ['product-moves', id], queryFn: () => api.get<Move[]>(`/products/${id}/movements`), enabled: can('stock.view') });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const showCost = p.avgCost !== undefined;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['product', id] }); qc.invalidateQueries({ queryKey: ['product-moves', id] }); qc.invalidateQueries({ queryKey: ['products'] }); };

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        subtitle={<>{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}{p.category ? ` · ${p.category}` : ''}{p.brand ? ` · ${p.brand}` : ''} <Badge tone={STOCK_BADGE[p.stockStatus].tone} className="ml-1">{STOCK_BADGE[p.stockStatus].label}</Badge>{!p.isActive && <Badge className="ml-1">Inactive</Badge>}</>}
        actions={<>
          {can('stock.adjust') && <Button variant="secondary" onClick={() => setAdjusting(true)}><PackageMinus className="h-4 w-4" />Adjust stock</Button>}
          {can('products.manage') && <Button onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
          {can('products.delete') && <Button variant="secondary" className="text-red-700" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" />Delete</Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={int(p.qtyAvailable)} sub={`On hand ${p.qtyOnHand} · reorder at ${p.reorderLevel}`} />
        <Stat label="Selling price" value={money(p.sellingPrice)} sub={`Minimum ${money(p.minSellingPrice)}`} />
        {showCost && <>
          <Stat label="Average cost" value={money(p.avgCost)} sub={`Last buying price ${money(p.purchasePrice)}`} />
          <Stat label="Profit per unit" value={money(p.unitProfit)} tone="green" sub={`${p.marginPercent ?? 0}% margin, before discounts`} />
        </>}
      </div>
      {p.lifetime && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Units received" value={int(p.lifetime.unitsReceived)} />
          <Stat label="Units sold (net)" value={int(p.lifetime.unitsSold)} />
          <Stat label="Net revenue" value={money(p.lifetime.netRevenue)} />
          <Stat label="Gross profit (all time)" value={money(p.lifetime.grossProfit)} tone="green" sub={`COGS ${money(p.lifetime.cogs)}`} />
          <Stat label="Potential profit on stock" value={money(p.lifetime.potentialProfitOnStock)} sub="At current price and avg cost" />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-2 p-4 text-sm">
            {[['Compatible', p.compatibility], ['Colour', p.color], ['Size', p.size], ['Connector', p.connectorType], ['Warranty', p.warrantyMonths ? `${p.warrantyMonths} months` : 'None'], ['Supplier', p.supplier], ['Max stock', p.maxStockLevel], ['Updated', dateTime(p.updatedAt)]]
              .filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
                <div key={String(k)}><dt className="text-xs text-slate-500">{k}</dt><dd>{String(v)}</dd></div>
              ))}
            {p.description && <div className="col-span-2"><dt className="text-xs text-slate-500">Description</dt><dd className="whitespace-pre-line">{p.description}</dd></div>}
          </dl>
          {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="mx-4 mb-4 h-32 rounded-lg border object-contain" />}
          {p.variants.length > 0 && (
            <div className="border-t border-slate-100 p-4 text-sm">
              <p className="label">Other variants</p>
              <ul className="space-y-1">{p.variants.map((v) => <li key={v.id}><Link className="link" to={`/products/${v.id}`}>{v.name}</Link> <span className="text-xs text-slate-500">{v.qtyOnHand} in stock</span></li>)}</ul>
            </div>
          )}
        </Card>
        <Card title="Stock movements" className="xl:col-span-2">
          {!can('stock.view') ? <p className="p-4 text-sm text-slate-500">You cannot view stock history.</p> : moves.isLoading ? <Loading /> : (
            <div className="max-h-96 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50"><tr><th className="th">When</th><th className="th">Type</th><th className="th text-right">Change</th><th className="th text-right">Balance</th>{showCost && <th className="th text-right">Unit cost</th>}<th className="th">Ref / reason</th><th className="th" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {moves.data?.map((m) => (
                    <tr key={m.id}>
                      <td className="td whitespace-nowrap">{dateTime(m.createdAt)}</td>
                      <td className="td">{m.type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className={`td num font-semibold ${m.qtyChange < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}</td>
                      <td className="td num">{m.qtyAfter}</td>
                      {showCost && <td className="td num">{money(m.unitCost)}</td>}
                      <td className="td text-xs text-slate-500">{m.refType === 'SALE' && m.refId ? <Link className="link" to={`/sales/${m.refId}`}>Sale</Link> : m.refType}{m.reason ? ` ${m.reason}` : ''}</td>
                      <td className="td"><UndoStock move={{ ...m, product: { name: p.name } }} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ['stock-alerts'] }); }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {p.priceHistory && (
        <Card title="Price change history">
          {p.priceHistory.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {p.priceHistory.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                  <span>{FIELD[h.field] ?? h.field}: {money(h.oldValue)} → <b>{money(h.newValue)}</b>{h.reason ? ` · ${h.reason}` : ''}</span>
                  <span className="text-xs text-slate-500">{dateTime(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="p-4 text-sm text-slate-500">No price changes recorded.</p>}
        </Card>
      )}
      <Modal open={editing} onClose={() => setEditing(false)} title={`Edit ${p.name}`} wide>
        <ProductForm product={p} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      </Modal>
      <Confirm open={deleting} onClose={() => setDeleting(false)} danger loading={busy} confirmLabel="Delete product" title={`Delete ${p.name}?`}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/products/${p.id}`);
            toast(`${p.name} deleted`);
            qc.invalidateQueries({ queryKey: ['products'] });
            qc.invalidateQueries({ queryKey: ['stock-alerts'] });
            nav('/products');
          } catch (e) { toast(errorText(e), 'error'); setDeleting(false); } finally { setBusy(false); }
        }}
        message={<p>Use this for a product added by mistake. It is removed completely, with its stock entries. Products that were ever sold or purchased cannot be deleted: deactivate them instead (Edit, then untick Active).</p>} />
      <Modal open={adjusting} onClose={() => setAdjusting(false)} title="Stock adjustment">
        <AdjustmentForm productId={p.id} onDone={() => { setAdjusting(false); refresh(); }} />
      </Modal>
    </div>
  );
}
