import { useCallback, useState } from 'react';
import clsx from 'clsx';
import { FileDown, Printer, Receipt as ReceiptIcon, FileText } from 'lucide-react';
import { Modal } from './ui';

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

/** Paper-size tiles. The last-used size is focused, so Enter prints it. */
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

/** "Choose paper size" dialog shown before every print. */
export function usePaperChooser(fallback?: string) {
  const [target, setTarget] = useState<{ saleId: number; reprint: boolean } | null>(null);
  const ask = useCallback((saleId: number, reprint = false) => setTarget({ saleId, reprint }), []);
  const close = useCallback(() => setTarget(null), []);
  const dialog = (
    <Modal open={!!target} onClose={close} title="Choose paper size">
      {target && (
        <PaperOptions preferred={lastPaper(fallback)} onPick={(p) => { openPrint(target.saleId, p, target.reprint); close(); }} />
      )}
    </Modal>
  );
  return { ask, dialog };
}
