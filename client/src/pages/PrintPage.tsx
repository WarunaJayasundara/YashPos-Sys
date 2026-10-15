import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer, FileDown } from 'lucide-react';
import { api } from '../lib/api';
import type { Sale, Settings } from '../lib/types';
import { ErrorBox, Loading, Button } from '../components/ui';
import { Receipt, A4Invoice } from '../components/Receipt';
import { PaperOptions, lastPaper, openPrint } from '../components/PaperChooser';

export type PrintFormat = '58' | '80' | 'A4';

/** Standalone print view (no app chrome). @page size matches the chosen paper. */
export default function PrintPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<{ sale: Sale; settings: Settings }>(`/sales/${id}/receipt`) });
  const chosen = sp.get('format') as PrintFormat | null;
  const format = chosen ?? '80';

  useEffect(() => {
    if (!q.data) return;
    if (sp.get('reprint') === '1') api.post(`/sales/${id}/reprint`).catch(() => undefined);
    if (chosen && sp.get('auto') === '1') {
      const t = setTimeout(() => window.print(), 350);
      return () => clearTimeout(t);
    }
  }, [q.data, id, sp, chosen]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const { sale, settings } = q.data!;
  if (!chosen) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-pop">
          <h1 className="text-base font-semibold text-slate-900">Choose paper size</h1>
          <p className="mb-4 mt-1 text-sm text-slate-500">Invoice {sale.invoiceNumber}</p>
          <PaperOptions preferred={lastPaper(settings.defaultPrintFormat)} onPick={(p) => {
            if (p === 'PDF') return openPrint(sale.id, 'PDF');
            try { localStorage.setItem('yash.lastPaper', p); } catch { /* storage blocked */ }
            setSp({ format: p, auto: '1' });
          }} />
        </div>
      </div>
    );
  }
  const page = format === 'A4' ? '@page { size: A4; margin: 12mm; }' : `@page { size: ${format}mm auto; margin: 2mm; }`;

  return (
    <div className="print-root min-h-screen bg-slate-200 p-4">
      <style>{page}</style>
      <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-600">Paper:</span>
        {(['80', '58', 'A4'] as const).map((f) => (
          <Button key={f} size="sm" variant={f === format ? 'primary' : 'secondary'} onClick={() => setSp({ format: f })}>{f === 'A4' ? 'A4 invoice' : `${f} mm thermal`}</Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => window.open(`/api/sales/${sale.id}/invoice.pdf`, '_blank', 'noopener')}><FileDown className="h-4 w-4" />PDF</Button>
        <Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
      </div>
      <div className="flex justify-center">
        <div className="sheet bg-white p-3 shadow-lg">
          {format === 'A4' ? <A4Invoice sale={sale} settings={settings} /> : <Receipt sale={sale} settings={settings} width={format} />}
        </div>
      </div>
    </div>
  );
}
