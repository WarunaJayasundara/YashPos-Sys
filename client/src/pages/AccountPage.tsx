import { useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, Input, PageHeader } from '../components/ui';
import { useToast } from '../components/toast';

export default function AccountPage() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast('The new passwords do not match', 'error');
    setBusy(true);
    try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: next }); toast('Password changed. Other devices were signed out.'); setCur(''); setNext(''); setConfirm(''); }
    catch (err) { toast(errorText(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-lg">
      <PageHeader title="My account" subtitle={`${user?.fullName} · ${user?.roleName}`} actions={<Button variant="secondary" onClick={logout}>Sign out</Button>} />
      <Card title="Change password">
        <form onSubmit={save} className="space-y-3 p-4">
          <Input label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <Input label="New password" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          <Input label="Repeat new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button type="submit" loading={busy}>Change password</Button>
        </form>
      </Card>
    </div>
  );
}
