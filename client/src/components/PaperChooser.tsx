import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, FileDown, FileText, Pencil, Printer, Receipt as ReceiptIcon, Wrench } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { toNum } from '../lib/format';
import type { Sale, Settings } from '../lib/types';
import { Button, Input, Modal } from './ui';
import { A4Invoice, Receipt } from './Receipt';
import { useToast } from './toast';

export type Paper = '80' | '58' | 'A4' | 'PDF';

const KEY = 'yash.lastPaper';

const OPTIONS: { id: Paper; title: string; hint: string; icon: typeof Printer }[] = [
  { id: '80', title: '80 mm', hint: 'Standard receipt printer', icon: ReceiptIcon },
  { id: '58', title: '58 mm', hint: 'Small / mobile printer', icon: ReceiptIcon },
  { id: 'A4', title: 'A4 invoice', hint: 'Office printer', icon: FileText },
  { id: 'PDF', title: 'PDF', hint: 'Save or send by WhatsApp', icon: FileDown },
];

/** Last paper chosen on this device, else the shop default. */
export function lastPaper(fallback?: string): Paper {
  try {
    const v = localStorage.getItem(KEY);
    if (v && OPTIONS.some((o) => o.id === v)) return v as Paper;
  } catch { /* storage blocked */ }
  return (OPTIONS.some((o) => o.id === fallback) ? fallback : '80') as Paper;
}

/** Opens the print view (or PDF) for a sale in a new tab. Call from a click so pop-up blockers allow it. */
export function openPrint(saleId: number, paper: Paper, reprint = false) {
  try { localStorage.setItem(KEY, paper); } catch { /* storage blocked */ }
  const url = paper === 'PDF' ? `/api/sales/${saleId}/invoice.pdf` : `/print/${saleId}?format=${paper}&auto=1${reprint ? '&reprint=1' : ''}`;
  window.open(url, '_blank', 'noopener');
}

/** Paper-size tiles. The last-used size is focused, so Enter picks it. */
export function PaperOptions({ onPick, preferred }: { onPick: (p: Paper) => void; preferred: Paper }) {
  let used = false;
  try { used = !!localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return (
    <div className="grid w-full grid-cols-2 gap-2" role="group" aria-label="Paper size">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const on = o.id === preferred;
        return (
          <button
            key={o.id}
            type="button"
            autoFocus={on}
            onClick={() => onPick(o.id)}
            className={clsx('flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/30' : 'border-slate-200 bg-white hover:bg-slate-50')}
          >
            <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')}><Icon className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{o.title}{on && <span className="ml-1.5 text-[11px] font-medium text-brand-700">{used ? 'last used' : 'default'}</span>}</span>
              <span className="block text-xs text-slate-500">{o.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Bill exactly as it will print, with optional edits, before anything goes to the printer. */
export function BillPreview({ saleId, paper, reprint, onPaper, onBack, onClose, onUpdated, onFixItems }: {
  saleId: number; paper: Paper; reprint?: boolean; onPaper: (p: Paper) => void; onBack?: () => void; onClose: () => void;
  onUpdated?: (s: Sale) => void; onFixItems?: (s: Sale) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['receipt', String(saleId)], queryFn: () => api.get<{ sale: Sale; settings: Settings }>(`/sales/${saleId}/receipt`) });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ customerName: '', customerPhone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const sale = q.data?.sale;

  useEffect(() => {
    if (sale) setForm({ customerName: sale.customerName ?? '', customerPhone: sale.customerPhone ?? '', notes: sale.notes ?? '' });
  }, [sale]);

  const save = async () => {
    setSaving(true);
    try {
      const s = await api.patch<Sale>(`/sales/${saleId}/details`, form);
      await qc.invalidateQueries({ queryKey: ['receipt', String(saleId)] });
      qc.invalidateQueries({ queryKey: ['sale'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      onUpdated?.(s);
      setEditing(false);
      toast('Bill updated');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onCredit = toNum(sale?.balanceDue) > 0;
  const voided = sale?.status === 'VOIDED';
  const print = () => { openPrint(saleId, paper, reprint); onClose(); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Paper size">
        {OPTIONS.map((o) => (
          <button key={o.id} type="button" onClick={() => onPaper(o.id)}
            className={clsx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition', o.id === paper ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
            {o.title}
          </button>
        ))}
      </div>

      <div className="max-h-[46dvh] overflow-auto rounded-xl bg-slate-100 p-3 ring-1 ring-slate-200" aria-label="Bill preview">
        {!q.data ? <p className="p-6 text-center text-sm text-slate-500">{q.error ? errorText(q.error) : 'Loading bill…'}</p> : (
          <div className="flex justify-center">
            {paper === 'A4' || paper === 'PDF' ? (
              <div className="origin-top bg-white p-4 shadow-sm" style={{ width: 794, zoom: 0.55 }}><A4Invoice sale={q.data.sale} settings={q.data.settings} /></div>
            ) : (
              <div className="bg-white p-2 shadow-sm"><Receipt sale={q.data.sale} settings={q.data.settings} width={paper} /></div>
            )}
          </div>
        )}
      </div>

      {editing && sale && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="Customer name" value={form.customerName} disabled={onCredit} maxLength={120} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            <Input label="Customer phone" value={form.customerPhone} disabled={onCredit} maxLength={30} inputMode="tel" onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
          </div>
          {onCredit && <p className="text-xs text-amber-700">This bill is on credit, so the customer can't be changed.</p>}
          <Input label="Note on the bill (optional)" value={form.notes} maxLength={255} placeholder="e.g. Delivered to shop counter" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <p className="text-xs text-slate-500">Items and amounts can't be edited here; they are part of the sales record.{onFixItems ? ' Use "Fix items" instead.' : ' Use a return for those.'}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={save}>Save changes</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onBack && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" />Back</Button>}
        {!editing && !voided && <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={!sale}><Pencil className="h-4 w-4" />Edit details</Button>}
        {onFixItems && sale?.status === 'COMPLETED' && !editing && (
          <Button variant="secondary" size="sm" onClick={() => onFixItems(sale)}><Wrench className="h-4 w-4" />Fix items</Button>
        )}
        <span className="flex-1" />
        <Button onClick={print} disabled={!sale || editing} autoFocus>
          {paper === 'PDF' ? <><FileDown className="h-4 w-4" />Open PDF</> : <><Printer className="h-4 w-4" />Print</>}
        </Button>
      </div>
    </div>
  );
}

/** Choose paper, preview (and optionally edit) the bill, then print. */
export function usePaperChooser(fallback?: string) {
  const [target, setTarget] = useState<{ saleId: number; reprint: boolean } | null>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const ask = useCallback((saleId: number, reprint = false) => { setPaper(null); setTarget({ saleId, reprint }); }, []);
  const close = useCallback(() => { setTarget(null); setPaper(null); }, []);
  const dialog = (
    <Modal open={!!target} onClose={close} title={paper ? 'Check the bill' : 'Choose paper size'} wide={!!paper}>
      {target && (paper
        ? <BillPreview saleId={target.saleId} paper={paper} reprint={target.reprint} onPaper={setPaper} onBack={() => setPaper(null)} onClose={close} />
        : <PaperOptions preferred={lastPaper(fallback)} onPick={setPaper} />)}
    </Modal>
  );
  return { ask, dialog };
}
