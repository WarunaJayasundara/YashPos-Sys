import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Badge, Button, Card, Input, Loading, Modal, PageHeader, Select, Tabs } from '../components/ui';
import { DataTable } from '../components/Table';
import { useToast } from '../components/toast';

interface StaffUser { id: number; username: string; fullName: string; isActive: boolean; lastLoginAt: string | null; role: { id: number; code: string; name: string } }
interface Role { id: number; code: string; name: string; isSystem: boolean; maxDiscountPercent: string; users: number; permissions: string[] }
interface RolesRes { roles: Role[]; permissions: { code: string; description: string }[] }

export default function StaffPage() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <div>
      <PageHeader title="Staff and permissions" subtitle="Permissions are checked by the server on every request" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Staff accounts' }, { value: 'roles', label: 'Roles and permissions' }]} />
      {tab === 'users' ? <Users /> : <Roles />}
    </div>
  );
}

function Users() {
  const { user: me } = useAuth();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<StaffUser[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesRes>('/roles') });
  const [edit, setEdit] = useState<Partial<StaffUser> | null>(null);
  return (
    <Card actions={<Button size="sm" onClick={() => setEdit({ isActive: true })}><Plus className="h-4 w-4" />Add staff</Button>} title="Accounts">
      {q.isLoading ? <Loading /> : (
        <DataTable rows={q.data ?? []} rowKey={(u) => u.id} onRowClick={setEdit} columns={[
          { key: 'n', header: 'Name', primary: true, render: (u) => <span className="font-medium">{u.fullName}{u.id === me?.id && <Badge className="ml-2" tone="blue">You</Badge>}</span> },
          { key: 'u', header: 'Username', render: (u) => u.username },
          { key: 'r', header: 'Role', render: (u) => u.role.name },
          { key: 's', header: 'Status', render: (u) => <Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Disabled'}</Badge> },
          { key: 'l', header: 'Last sign-in', render: (u) => (u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never') },
        ]} />
      )}
      {edit && roles.data && <UserForm user={edit} roles={roles.data.roles} isMe={edit.id === me?.id} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function UserForm({ user, roles, isMe, onClose }: { user: Partial<StaffUser>; roles: Role[]; isMe: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ username: user.username ?? '', fullName: user.fullName ?? '', roleId: String(user.role?.id ?? roles.find((r) => r.code === 'cashier')?.id ?? ''), password: '', isActive: user.isActive ?? true });
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = { username: f.username, fullName: f.fullName, ...(isMe ? {} : { roleId: Number(f.roleId), isActive: f.isActive }) };
    if (f.password) body.password = f.password;
    try {
      if (user.id) await api.put(`/users/${user.id}`, body); else await api.post('/users', body);
      toast('Saved');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={user.id ? `Edit ${user.fullName}` : 'Add staff member'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="user-form" loading={busy}>Save</Button></>}>
      <form id="user-form" onSubmit={save} className="space-y-3">
        <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        <Input label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required autoCapitalize="none" />
        <Select label="Role" value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })} disabled={isMe}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        <Input label={user.id ? 'New password (leave empty to keep)' : 'Password'} type="password" autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!user.id} hint="At least 8 characters. Changing it signs the person out everywhere." />
        {!isMe && user.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Account active</label>}
      </form>
    </Modal>
  );
}

function Roles() {
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesRes>('/roles') });
  const [edit, setEdit] = useState<Partial<Role> | null>(null);
  if (q.isLoading) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" onClick={() => setEdit({ permissions: [], maxDiscountPercent: '0' })}><Plus className="h-4 w-4" />New role</Button></div>
      <div className="grid gap-3 lg:grid-cols-3">
        {q.data?.roles.map((r) => (
          <Card key={r.id} title={r.name} actions={<Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Edit</Button>}>
            <div className="p-4 text-sm"><p>{r.users} account(s) · discount limit {Number(r.maxDiscountPercent)}%</p><p className="mt-1 text-xs text-slate-500">{r.permissions.length} of {q.data.permissions.length} permissions</p></div>
          </Card>
        ))}
      </div>
      {edit && q.data && <RoleForm role={edit} all={q.data.permissions} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RoleForm({ role, all, onClose }: { role: Partial<Role>; all: { code: string; description: string }[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: role.name ?? '', code: role.code ?? '', maxDiscountPercent: String(Number(role.maxDiscountPercent ?? 0)), permissions: new Set(role.permissions ?? []) });
  const isAdmin = role.code === 'admin';
  const toggle = (c: string) => { const s = new Set(f.permissions); if (s.has(c)) s.delete(c); else s.add(c); setF({ ...f, permissions: s }); };
  const save = async () => {
    const body = { name: f.name, code: f.code, maxDiscountPercent: Number(f.maxDiscountPercent), permissions: [...f.permissions] };
    try {
      if (role.id) await api.put(`/roles/${role.id}`, body); else await api.post('/roles', body);
      toast('Role saved. Affected staff get the new permissions on their next request.');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    } catch (e) { toast(errorText(e), 'error'); }
  };
  const groups = [...new Set(all.map((p) => p.code.split('.')[0]))];
  return (
    <Modal open onClose={onClose} title={role.id ? `Role: ${role.name}` : 'New role'} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save role</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Code" value={f.code} disabled={!!role.isSystem} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} hint="lowercase, e.g. senior_cashier" />
          <Input label="Max discount without approval (%)" type="number" min={0} max={100} value={f.maxDiscountPercent} onChange={(e) => setF({ ...f, maxDiscountPercent: e.target.value })} />
        </div>
        {isAdmin && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">The owner role always keeps every permission.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g} className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase text-slate-500">{g}</legend>
              {all.filter((p) => p.code.startsWith(`${g}.`)).map((p) => (
                <label key={p.code} className="flex items-start gap-2 py-1 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={f.permissions.has(p.code)} disabled={isAdmin} onChange={() => toggle(p.code)} />
                  <span>{p.description}<span className="block text-[11px] text-slate-400">{p.code}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </div>
    </Modal>
  );
}
