import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { Badge, Button, Card, Input, Loading, Modal, PageHeader } from '../components/ui';
import { useToast } from '../components/toast';

interface Row { id: number; name: string; isActive: boolean; _count: { products: number } }

function LookupList({ kind, title }: { kind: 'categories' | 'brands'; title: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: [kind], queryFn: () => api.get<Row[]>(`/${kind}`) });
  const [edit, setEdit] = useState<Partial<Row> | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (edit?.id) await api.put(`/${kind}/${edit.id}`, { name: edit.name, isActive: edit.isActive });
      else await api.post(`/${kind}`, { name: edit?.name });
      toast('Saved');
      setEdit(null);
      qc.invalidateQueries({ queryKey: [kind] });
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };

  return (
    <Card title={title} actions={<Button size="sm" onClick={() => setEdit({ name: '', isActive: true })}><Plus className="h-4 w-4" />Add</Button>}>
      {q.isLoading ? <Loading /> : (
        <ul className="divide-y divide-slate-100">
          {q.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span>{r.name} {!r.isActive && <Badge>Hidden</Badge>}</span>
              <span className="flex items-center gap-3 text-xs text-slate-500">{r._count.products} products
                <button onClick={() => setEdit(r)} className="rounded p-1 hover:bg-slate-100" aria-label={`Edit ${r.name}`}><Pencil className="h-4 w-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${title.toLowerCase().slice(0, -1)}` : `New ${kind === 'brands' ? 'brand' : 'category'}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" form={`${kind}-form`} loading={busy}>Save</Button></>}>
        <form id={`${kind}-form`} onSubmit={save} className="space-y-3">
          <Input label="Name" value={edit?.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required minLength={2} autoFocus />
          {edit?.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />Show in product forms</label>}
        </form>
      </Modal>
    </Card>
  );
}

export default function CatalogPage() {
  return (
    <div>
      <PageHeader title="Categories and brands" subtitle="Used to organise products and reports" />
      <div className="grid gap-4 lg:grid-cols-2">
        <LookupList kind="categories" title="Categories" />
        <LookupList kind="brands" title="Brands" />
      </div>
    </div>
  );
}
