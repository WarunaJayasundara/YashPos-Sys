import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/api';
import { Button, Input } from '../components/ui';

export default function LoginPage() {
  const { login, unreachable } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username.trim().toLowerCase(), password);
    } catch (err) {
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <img src="/icon.svg" alt="" className="mb-3 h-16 w-16" />
          <h1 className="text-2xl font-extrabold tracking-wide">YASH MOBILE</h1>
          <p className="text-sm text-brand-100">POS & Inventory Management</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Sign in</h2>
          {unreachable && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The server cannot be reached. Check the connection.</p>}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
          <Input label="Username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" size="lg" className="w-full" loading={busy}><LogIn className="h-5 w-5" />Sign in</Button>
        </form>
      </div>
    </div>
  );
}
