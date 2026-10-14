import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api';
import type { Product } from '../lib/types';

/** Search-as-you-type product chooser. */
export function ProductPicker({ onPick, label = 'Product', placeholder = 'Search name, SKU or barcode', exclude = [] }: { onPick: (p: Product) => void; label?: string; placeholder?: string; exclude?: number[] }) {
  const [term, setTerm] = useState('');
  const [d, setD] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setD(term), 200); return () => clearTimeout(t); }, [term]);
  const q = useQuery({ queryKey: ['pick', d], queryFn: () => api.get<{ data: Product[] }>(`/products${qs({ q: d, pageSize: 15, active: 'all' })}`), enabled: d.length > 0 });
  const rows = (q.data?.data ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <div className="relative">
      <label className="label">{label}</label>
      <input className="input" value={term} placeholder={placeholder} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Enter' && rows[0]) { e.preventDefault(); onPick(rows[0]); setTerm(''); } }} />
      {open && d && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {q.isLoading && <li className="p-3 text-sm text-slate-500">Searching...</li>}
          {!q.isLoading && !rows.length && <li className="p-3 text-sm text-slate-500">No match</li>}
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setTerm(''); setOpen(false); }}>
                <span className="min-w-0 truncate">{p.name} <span className="text-xs text-slate-500">{p.sku}</span></span>
                <span className="whitespace-nowrap text-xs text-slate-500">{p.qtyOnHand} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
