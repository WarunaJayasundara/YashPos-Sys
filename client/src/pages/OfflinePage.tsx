import { useState } from 'react';
import { RefreshCw, Trash2, RotateCw } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { discardPending, retryConflict, syncPending } from '../lib/offline';
import { usePending, useOnline } from '../lib/useOnline';
import { dateTime, money } from '../lib/format';
import { Badge, Button, Card, Confirm, Empty, PageHeader } from '../components/ui';
import { useToast } from '../components/toast';

export default function OfflinePage() {
  const { user } = useAuth();
  const online = useOnline();
  const pending = usePending();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<string | null>(null);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await syncPending(user!.username);
      toast(`${r.synced} synced${r.conflicts ? `, ${r.conflicts} need reconciliation` : ''}`, r.conflicts ? 'error' : 'success');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Offline sales queue" subtitle="Sales saved on this device while the server could not be reached" actions={<Button onClick={sync} loading={busy} disabled={!online || !pending.length}><RefreshCw className="h-4 w-4" />Sync now</Button>} />
      <Card>
        {!pending.length ? <Empty title="Nothing waiting. Every sale on this device has reached the server." /> : (
          <ul className="divide-y divide-slate-100">
            {pending.map((p) => (
              <li key={p.clientRequestId} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{money(p.total)} <Badge tone={p.status === 'CONFLICT' ? 'red' : 'amber'} className="ml-1">{p.status === 'CONFLICT' ? 'Needs reconciliation' : 'Pending - not recorded on server'}</Badge></p>
                  <p className="text-slate-600">{p.summary}</p>
                  <p className="text-xs text-slate-500">Saved {dateTime(p.createdAt)} by {p.username} · ID {p.clientRequestId.slice(0, 8)}</p>
                  {p.error && <p className="mt-1 text-xs text-red-700">{p.error}</p>}
                  {p.username !== user?.username && <p className="mt-1 text-xs text-amber-700">Only {p.username} can sync this sale (sign in as them).</p>}
                </div>
                <div className="flex gap-2">
                  {p.status === 'CONFLICT' && <Button size="sm" variant="secondary" onClick={() => retryConflict(p.clientRequestId).then(sync)}><RotateCw className="h-4 w-4" />Retry</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setDiscard(p.clientRequestId)} aria-label="Discard"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="mt-4 space-y-1 text-xs text-slate-500">
        <p>How reconciliation works: each queued sale carries a unique ID, so sending it twice can never create two sales. When it is synced the server re-checks stock and prices. If stock ran out meanwhile (for example the item was sold on another device), the sale is rejected and listed here. Resolve it by restocking (receive goods or a count correction) and pressing Retry, or by discarding it and refunding the customer.</p>
      </div>
      <Confirm open={!!discard} onClose={() => setDiscard(null)} danger title="Discard this offline sale?" confirmLabel="Discard"
        message="It was never recorded on the server. Discarding removes it from this device permanently. Make sure the customer's money and goods are dealt with."
        onConfirm={async () => { await discardPending(discard!); setDiscard(null); toast('Discarded', 'info'); }} />
    </div>
  );
}
