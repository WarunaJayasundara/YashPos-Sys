import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { dateTime, daysAgo, today } from '../lib/format';
import { Card, ErrorBox, Input, Loading, PageHeader, Select } from '../components/ui';
import { DateRange, type Range } from '../components/DateRange';

interface Log { id: number; username: string | null; action: string; entity: string; entityId: string | null; details: unknown; ip: string | null; createdAt: string }
const ENTITIES = ['sale', 'return', 'product', 'purchase', 'stock_adjustment', 'expense', 'cash_closing', 'customer', 'supplier', 'user', 'role', 'settings', 'warranty', 'category', 'brand'];

export default function AuditPage() {
  const [range, setRange] = useState<Range>({ from: daysAgo(6), to: today() });
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit', range, entity, action], queryFn: () => api.get<Log[]>(`/audit-logs${qs({ ...range, entity, action, limit: 500 })}`) });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be edited." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <DateRange value={range} onChange={setRange} />
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Record type"><option value="">All records</option>{ENTITIES.map((e) => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}</Select>
          <Input placeholder="Action contains (e.g. void, login)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action" />
        </div>
        {q.isLoading ? <Loading /> : q.error ? <div className="p-3"><ErrorBox error={q.error} /></div> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {q.data!.length ? q.data!.map((l) => (
              <li key={l.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><b>{l.action}</b> <span className="text-slate-500">{l.entity}{l.entityId ? ` #${l.entityId}` : ''}</span></span>
                  <span className="text-xs text-slate-500">{dateTime(l.createdAt)} · {l.username ?? 'system'}{l.ip ? ` · ${l.ip}` : ''}</span>
                </div>
                {l.details != null && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify(l.details)}</pre>}
              </li>
            )) : <li className="p-8 text-center text-slate-500">No entries.</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
