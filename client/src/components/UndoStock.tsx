import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Confirm, Input } from './ui';
import { useToast } from './toast';

export interface UndoableMove { id: number; type: string; qtyChange: number; undone?: boolean; canUndo?: boolean; product?: { name: string } }

/** "Undo" for a wrong stock entry (owner only), or an "undone" badge once it has been reversed. */
export function UndoStock({ move, onDone }: { move: UndoableMove; onDone: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (move.undone) return <Badge tone="gray">Undone</Badge>;
  if (!move.canUndo || !can('stock.undo')) return null;

  const units = Math.abs(move.qtyChange);
  const undo = async () => {
    setBusy(true);
    try {
      await api.post(`/stock/movements/${move.id}/undo`, { reason: reason.trim() || undefined });
      toast(`Undone: ${units} unit(s) ${move.qtyChange > 0 ? 'removed from' : 'put back into'} stock`);
      setOpen(false);
      onDone();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" title="Undo this entry">
        <Undo2 className="h-3.5 w-3.5" />Undo
      </button>
      <Confirm open={open} onClose={() => setOpen(false)} danger loading={busy} confirmLabel="Undo entry" onConfirm={undo} title="Undo this stock entry?"
        message={<p>This {move.qtyChange > 0 ? <>removes the <b>{units}</b> unit(s) that were added</> : <>puts back the <b>{units}</b> unit(s) that were taken out</>}
          {move.product ? <> for <b>{move.product.name}</b></> : null}. The entry stays in the history marked "Undone", with your name.</p>}>
        <Input label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. typed 50 instead of 5" maxLength={200} />
      </Confirm>
    </>
  );
}
