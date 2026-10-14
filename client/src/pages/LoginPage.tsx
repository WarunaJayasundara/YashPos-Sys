import { useState, type FormEvent } from 'react';
import { BarChart3, Eye, EyeOff, LogIn, ScanBarcode, ShieldCheck, Smartphone } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/api';
import { Button, Input } from '../components/ui';

const FEATURES = [
  { icon: ScanBarcode, title: 'Fast billing', text: 'Scan, tap and print receipts in seconds.' },
  { icon: BarChart3, title: 'Profit you can trust', text: 'Real cost of every sale, live stock value.' },
  { icon: Smartphone, title: 'Shop in your pocket', text: 'Check sales and stock from your phone.' },
];

export default function LoginPage() {
  const { login, unreachable } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
    <div className="grid min-h-[100dvh] grid-cols-1 bg-white lg:h-[100dvh] lg:grid-cols-[1.1fr_1fr] lg:overflow-hidden">
      <aside className="relative hidden overflow-hidden bg-ink-900 p-10 text-white lg:flex lg:flex-col xl:p-12">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-gold-400/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11 rounded-xl shadow-lg shadow-black/40" />
          <p className="text-lg font-extrabold tracking-wide">YASH <span className="text-gold-400">MOBILE</span></p>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">Run the shop from one screen.</h1>
          <p className="mt-3 text-slate-400">Point of sale, stock, purchases and profit for YASH MOBILE.</p>
          <ul className="mt-10 space-y-5 [@media(max-height:760px)]:hidden">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-gold-400 ring-1 ring-white/10"><f.icon className="h-5 w-5" /></span>
                <div><p className="font-semibold">{f.title}</p><p className="text-sm text-slate-400">{f.text}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-slate-500">© {new Date().getFullYear()} YASH MOBILE</p>
      </aside>

      <main className="flex items-center justify-center overflow-y-auto bg-[#f3f5f9] px-5 py-10 lg:bg-white">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img src="/icon.svg" alt="" className="mb-3 h-16 w-16 rounded-2xl shadow-lg shadow-brand-900/20" />
            <p className="text-xl font-extrabold tracking-wide text-ink-900">YASH <span className="text-brand-600">MOBILE</span></p>
            <p className="text-sm text-slate-500">Point of sale and inventory</p>
          </div>
          <form onSubmit={submit} className="card space-y-5 p-6 sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
              <p className="mt-1 text-sm text-slate-500">Sign in with your staff account.</p>
            </div>
            {unreachable && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20">The server cannot be reached. Check the connection.</p>}
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-600/15" role="alert">{error}</p>}
            <Input label="Username" className="h-11" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            <div>
              <label htmlFor="pw" className="label">Password</label>
              <div className="relative">
                <input id="pw" type={show ? 'text' : 'password'} className="input h-11 pr-11" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy}><LogIn className="h-5 w-5" />Sign in</Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />Ask the owner if you need an account or a new password.</p>
          </form>
        </div>
      </main>
    </div>
  );
}
