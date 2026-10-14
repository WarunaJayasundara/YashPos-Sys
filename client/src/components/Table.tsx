import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Empty } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  num?: boolean;
  /** shown as the card title on phones */
  primary?: boolean;
  /** hidden in the phone card view */
  hideMobile?: boolean;
  className?: string;
}

/** Table on wide screens, stacked cards on phones. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, empty = 'Nothing to show', footer, renderMobile }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; empty?: string; footer?: ReactNode;
  /** custom phone row; defaults to a label/value card */
  renderMobile?: (r: T) => ReactNode;
}) {
  if (!rows.length) return <Empty title={empty} />;
  const primary = columns.find((c) => c.primary) ?? columns[0];
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="border-b border-slate-200/80 bg-slate-50/80">
            <tr>{columns.map((c) => <th key={c.key} className={clsx('th', c.num && 'text-right', c.className)}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={clsx('transition-colors', onRowClick ? 'cursor-pointer hover:bg-brand-50/40' : 'hover:bg-slate-50/60')}>
                {columns.map((c) => <td key={c.key} className={clsx('td', c.num && 'num', c.className)}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
        </table>
      </div>
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              className={clsx('px-4 py-3.5', onRowClick && 'active:bg-slate-50')}
            >
              {renderMobile ? renderMobile(r) : <>
              <div className="mb-1.5 text-sm font-semibold text-slate-900">{primary.render(r)}</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {columns.filter((c) => c !== primary && !c.hideMobile).map((c) => (
                  <div key={c.key} className="flex min-w-0 flex-col">
                    <dt className="text-slate-400">{c.header}</dt>
                    <dd className={clsx('truncate text-slate-700', c.num && 'tabular-nums')}>{c.render(r)}</dd>
                  </div>
                ))}
              </dl>
              </>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
