import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, Confirm, Input } from './ui';
import { useToast } from './toast';

/** Owner-only: wipes trial sales, purchases and stock history before the shop goes live. */
export function ClearTestData() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleteProducts, setDeleteProducts] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!can('data.reset')) return null;

  const close = () => { setOpen(false); setConfirm(''); setPassword(''); };
  const run = async () => {
    setBusy(true);
    try {
      await api.post('/system/clear-test-data', { confirm, password, deleteProducts });
      toast(deleteProducts ? 'Test data and all products cleared' : 'Test data cleared. Products and their stock were kept');
      close();
      qc.invalidateQueries();
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Card title="Clear test data" className="mt-4 border-red-200" icon={Trash2}>
      <div className="space-y-3 p-4 text-sm text-slate-600">
        <p>Use this once, before the shop starts real selling, to remove trial entries: <b>all sales, returns, purchases, payments, expenses, cash closings and stock history</b>.
          Invoice numbers start again from 1. Staff, settings, customers, suppliers, categories and brands are kept.</p>
        <label className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={deleteProducts} onChange={(e) => setDeleteProducts(e.target.checked)} />
          Also delete all products (otherwise products stay with their current stock)
        </label>
        <Button type="button" variant="danger" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" />Clear test data…</Button>
      </div>
      <Confirm open={open} onClose={close} danger loading={busy} confirmLabel="Clear everything" onConfirm={run} title="Clear all test data?"
        message={<p>This permanently deletes every sale, return, purchase, payment, expense, cash closing and stock entry{deleteProducts ? <>, <b>and all products</b></> : null}. It cannot be undone.</p>}>
        <Input label='Type CLEAR to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        <Input label="Your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Confirm>
    </Card>
  );
}
