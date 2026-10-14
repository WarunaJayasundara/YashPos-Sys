import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface T { id: number; kind: Kind; text: string }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg',
            t.kind === 'success' && 'bg-emerald-600', t.kind === 'error' && 'bg-red-600', t.kind === 'info' && 'bg-slate-800')}>
            {t.kind === 'success' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : t.kind === 'error' ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <Info className="h-5 w-5 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
