import clsx from 'clsx';
import { AlertTriangle, Inbox, Loader2, X, type LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError, errorText } from '../lib/api';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'soft';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/45 disabled:shadow-none',
  secondary: 'border border-slate-300/90 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 active:bg-red-800 disabled:bg-red-600/45',
  success: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-600/45 disabled:shadow-none',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200 disabled:text-slate-400',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 disabled:text-brand-300',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' | 'xl'; loading?: boolean }>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-all duration-150 active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 rounded-xl px-5 text-base',
        size === 'xl' && 'h-14 rounded-xl px-6 text-lg',
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
      {error ? <p className="mt-1 text-xs font-medium text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
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
      {(id) => <select id={rest.id ?? id} aria-invalid={!!error} className={clsx('input', error && 'input-error', className)} {...rest}>{children}</select>}
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

export function Card({ className, children, title, actions, icon: Icon }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          {title && <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">{Icon && <Icon className="h-4 w-4 text-slate-400" />}{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-[1.65rem]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/15', green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25', blue: 'bg-brand-50 text-brand-700 ring-brand-600/20', violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};
const dots = { gray: 'bg-slate-400', green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-brand-500', violet: 'bg-violet-500' };
export type Tone = keyof typeof tones;
export function Badge({ tone = 'gray', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  );
}

export const STOCK_BADGE: Record<string, { tone: Tone; label: string }> = {
  OUT: { tone: 'red', label: 'Out of stock' }, LOW: { tone: 'amber', label: 'Low stock' }, OVER: { tone: 'violet', label: 'Overstock' }, OK: { tone: 'green', label: 'In stock' },
};

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-200/70', className)} />;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label={label}>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span className="flex-1">{errorText(error)}</span>
      {onRetry && !(error instanceof ApiError && [403, 404].includes(error.status)) && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Empty({ title, children, icon: Icon = Inbox }: { title: string; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-slate-500">
      <span className="mb-1 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Icon className="h-6 w-6" /></span>
      <p className="font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  );
}

const accents = {
  brand: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600', red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600', slate: 'bg-slate-100 text-slate-600',
};
export function Stat({ label, value, sub, tone, icon: Icon, accent = 'brand' }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'amber'; icon?: LucideIcon; accent?: keyof typeof accents;
}) {
  return (
    <div className="card p-4 transition hover:shadow-lift sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        {Icon && <span className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', accents[accent])}><Icon className="h-[18px] w-[18px]" /></span>}
      </div>
      <p className={clsx('mt-1 truncate text-lg font-bold tracking-tight tabular-nums text-slate-900 sm:text-xl 2xl:text-2xl', tone === 'green' && '!text-emerald-600', tone === 'red' && '!text-red-600', tone === 'amber' && '!text-amber-600')}>{value}</p>
      {sub && <div className="mt-1 truncate text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide, full }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; full?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('flex w-full flex-col bg-white shadow-pop animate-slide-up sm:animate-fade-up',
        full ? 'h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-4xl sm:rounded-2xl' : 'max-h-[92dvh] rounded-t-3xl sm:rounded-2xl',
        !full && (wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'))}>
        {!full && <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden />}
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-3 sm:pt-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl">{footer}</div>}
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
    <div className="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 scrollbar-none" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={clsx('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition', value === t.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Coloured initials tile used where a product has no photo. */
const swatches = ['from-sky-400 to-blue-600', 'from-violet-400 to-purple-600', 'from-emerald-400 to-teal-600', 'from-amber-400 to-orange-600', 'from-rose-400 to-pink-600', 'from-indigo-400 to-brand-700', 'from-cyan-400 to-sky-600', 'from-lime-400 to-green-600'];
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const initials = name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w[0] ?? '')).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % swatches.length;
  if (src) return <img src={src} alt="" className={clsx('object-cover', className)} />;
  return <span className={clsx('grid place-items-center bg-gradient-to-br font-bold text-white', swatches[idx], className)} aria-hidden>{initials}</span>;
}
