import clsx from 'clsx';
import { daysAgo, monthStart, today } from '../lib/format';

export interface Range { from: string; to: string }

const presets = [
  { label: 'Today', get: () => ({ from: today(), to: today() }) },
  { label: '7 days', get: () => ({ from: daysAgo(6), to: today() }) },
  { label: '30 days', get: () => ({ from: daysAgo(29), to: today() }) },
  { label: 'This month', get: () => ({ from: monthStart(), to: today() }) },
];

export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-slate-100 p-1">
        {presets.map((p) => {
          const r = p.get();
          const active = r.from === value.from && r.to === value.to;
          return (
            <button key={p.label} onClick={() => onChange(r)} className={clsx('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium', active ? 'bg-white shadow-sm' : 'text-slate-600')}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <input aria-label="From date" type="date" className="input w-[9.5rem] py-1.5" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
        <span className="text-slate-400">-</span>
        <input aria-label="To date" type="date" className="input w-[9.5rem] py-1.5" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
      </div>
    </div>
  );
}
