import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError, errorText } from '../lib/api';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-400',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed',
        size === 'sm' && 'min-h-8 px-2.5 text-xs',
        size === 'md' && 'min-h-10 px-4 text-sm',
        size === 'lg' && 'min-h-12 px-5 text-base',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

interface FieldProps { label?: string; error?: string; hint?: string; children: (id: string) => ReactNode; className?: string }
export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="label">{label}</label>}
      {children(id)}
      {error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

type InputP = InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string; wrapClass?: string };
export const Input = forwardRef<HTMLInputElement, InputP>(({ label, error, hint, wrapClass, className, ...rest }, ref) => (
  <Field label={label} error={error} hint={hint} className={wrapClass}>
    {(id) => <input ref={ref} id={rest.id ?? id} aria-invalid={!!error} className={clsx('input', error && 'input-error', className)} {...rest} />}
  </Field>
));
Input.displayName = 'Input';

export function Select({ label, error, hint, wrapClass, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string; wrapClass?: string }) {
  return (
    <Field label={label} error={error} hint={hint} className={wrapClass}>
      {(id) => <select id={rest.id ?? id} aria-invalid={!!error} className={clsx('input pr-8', error && 'input-error', className)} {...rest}>{children}</select>}
    </Field>
  );
}

export function Textarea({ label, error, wrapClass, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; wrapClass?: string }) {
  return (
    <Field label={label} error={error} className={wrapClass}>
      {(id) => <textarea id={rest.id ?? id} className={clsx('input min-h-20', error && 'input-error', className)} {...rest} />}
    </Field>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-700">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  gray: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800', blue: 'bg-brand-100 text-brand-800', violet: 'bg-violet-100 text-violet-800',
};
export type Tone = keyof typeof tones;
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

export const STOCK_BADGE: Record<string, { tone: Tone; label: string }> = {
  OUT: { tone: 'red', label: 'Out of stock' }, LOW: { tone: 'amber', label: 'Low stock' }, OVER: { tone: 'violet', label: 'Overstock' }, OK: { tone: 'green', label: 'In stock' },
};

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span className="flex-1">{errorText(error)}</span>
      {onRetry && !(error instanceof ApiError && [403, 404].includes(error.status)) && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-slate-500">
      <Inbox className="h-8 w-8 text-slate-300" />
      <p className="font-medium text-slate-600">{title}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx('mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl', tone === 'green' && 'text-emerald-700', tone === 'red' && 'text-red-700', tone === 'amber' && 'text-amber-700')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose, children }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void; children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <div className="space-y-3 text-sm text-slate-600">{message}{children}</div>
    </Modal>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium', value === t.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
