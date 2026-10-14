import { useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Button, Input, Modal } from './ui';

export interface Approval { username: string; password: string }

/**
 * Supervisor override flow: run an action; if the API answers APPROVAL_REQUIRED, ask a
 * supervisor to sign off and repeat the same request with their credentials.
 */
export function useApproval() {
  const [state, setState] = useState<{ reason: string; error?: string } | null>(null);
  const resolver = useRef<((a: Approval | null) => void) | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function run<T>(fn: (approval?: Approval) => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'APPROVAL_REQUIRED') throw e;
      let reason = e.message;
      for (;;) {
        const approval = await new Promise<Approval | null>((res) => {
          resolver.current = res;
          setState({ reason, error: state?.error });
        });
        if (!approval) throw new ApiError(403, 'Approval cancelled', 'APPROVAL_CANCELLED');
        try {
          const r = await fn(approval);
          setState(null);
          return r;
        } catch (e2) {
          if (e2 instanceof ApiError && e2.code === 'APPROVAL_INVALID') {
            reason = e.message;
            setState({ reason, error: e2.message });
            continue;
          }
          setState(null);
          throw e2;
        } finally {
          setPassword('');
        }
      }
    }
  }

  const close = (a: Approval | null) => {
    resolver.current?.(a);
    resolver.current = null;
    if (!a) { setState(null); setPassword(''); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    close({ username: username.trim(), password });
  };

  const dialog = (
    <Modal open={!!state} onClose={() => close(null)} title="Supervisor approval" footer={<>
      <Button variant="secondary" onClick={() => close(null)}>Cancel</Button>
      <Button type="submit" form="approval-form"><ShieldCheck className="h-4 w-4" />Approve</Button>
    </>}>
      <form id="approval-form" onSubmit={submit} className="space-y-3">
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{state?.reason}</p>
        {state?.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
        <Input label="Supervisor username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        <Input label="Password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <p className="text-xs text-slate-500">The approver is recorded on the transaction and in the audit log.</p>
      </form>
    </Modal>
  );

  return { run, dialog };
}
