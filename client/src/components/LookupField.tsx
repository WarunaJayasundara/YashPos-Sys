import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Plus } from 'lucide-react';
import { api, ApiError, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Named } from '../lib/types';
import { Button, Modal } from './ui';
import { useToast } from './toast';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Type-to-search box for a brand or category. Suggests existing names as you type (so "samsung" picks "Samsung"
 * instead of making a duplicate) and asks before adding a new one. Only users who manage the catalogue can add.
 */
export function LookupField({ kind, items, value, onChange, error }: {
  kind: 'brand' | 'category'; items: Named[] | undefined; value: string; onChange: (id: string) => void; error?: string;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const id = useId();
  const plural = kind === 'brand' ? 'brands' : 'categories';
  const label = kind === 'brand' ? 'Brand' : 'Category';
  const canAdd = can('catalog.manage');
  const list = useMemo(() => (items ?? []).filter((i) => i.isActive !== false || String(i.id) === value), [items, value]);
  const selected = list.find((i) => String(i.id) === value);
  const [text, setText] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(selected?.name ?? ''); }, [selected?.name]);

  const q = norm(text);
  const exact = list.find((i) => norm(i.name) === q);
  const matches = q ? list.filter((i) => norm(i.name).includes(q)).sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) || a.name.localeCompare(b.name)) : list;
  const offerNew = !!q && !exact;
  const options = matches.slice(0, 8);

  const pick = (i: Named | null) => {
    onChange(i ? String(i.id) : '');
    setText(i?.name ?? '');
    setOpen(false);
  };

  // leaving the box: snap to an existing name, or ask about adding the new one
  const settle = () => {
    setOpen(false);
    if (!q) return pick(null);
    if (exact) return pick(exact);
    if (selected && norm(selected.name) === q) return;
    setConfirm(text.trim().replace(/\s+/g, ' '));
  };

  const add = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const row = await api.post<Named>(`/${plural}`, { name: confirm });
      await qc.invalidateQueries({ queryKey: [plural] });
      onChange(String(row.id));
      setText(row.name);
      toast(`${label} "${row.name}" added`);
      setConfirm(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') {
        const fresh = await api.get<Named[]>(`/${plural}`);
        const hit = fresh.find((i) => norm(i.name) === norm(confirm));
        qc.setQueryData([plural], fresh);
        if (hit) { pick(hit); toast(`"${hit.name}" already exists, so it was selected`, 'info'); }
        setConfirm(null);
      } else toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelNew = () => { setConfirm(null); setText(selected?.name ?? ''); };

  return (
    <div ref={box} className="relative" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) settle(); }}>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        autoComplete="off"
        className={clsx('input', error && 'input-error')}
        placeholder={`Type to search${canAdd ? ' or add' : ''} (optional)`}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - (offerNew ? 0 : 1))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); if (active < options.length && open && options[active]) pick(options[active]); else settle(); }
          else if (e.key === 'Escape') { setOpen(false); setText(selected?.name ?? ''); }
        }}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {open && (options.length > 0 || offerNew) && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lift">
          {options.map((i, n) => (
            <li key={i.id} role="option" aria-selected={String(i.id) === value}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setActive(n)}
                className={clsx('flex w-full items-center justify-between px-3 py-2 text-left text-sm', n === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700')}>
                {i.name}{String(i.id) === value && <Check className="h-4 w-4 text-brand-600" />}
              </button>
            </li>
          ))}
          {offerNew && (
            <li role="option" aria-selected={false}>
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={settle} onMouseEnter={() => setActive(options.length)}
                className={clsx('flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium', active === options.length ? 'bg-brand-50 text-brand-800' : 'text-brand-700')}>
                <Plus className="h-4 w-4" />{canAdd ? `Add "${text.trim()}" as a new ${kind}` : `"${text.trim()}" is not in the list`}
              </button>
            </li>
          )}
        </ul>
      )}

      <Modal open={!!confirm} onClose={cancelNew} title={`New ${kind}?`}
        footer={canAdd ? <>
          <Button variant="secondary" onClick={cancelNew}>Cancel</Button>
          <Button loading={busy} onClick={add}><Plus className="h-4 w-4" />Add {kind}</Button>
        </> : <Button onClick={cancelNew}>OK</Button>}>
        {canAdd ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p><b>"{confirm}"</b> is not in your {plural} yet. Add it as a new {kind}?</p>
            {matches.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-slate-500">Or did you mean:</p>
                <div className="flex flex-wrap gap-1.5">
                  {matches.slice(0, 5).map((i) => <button key={i.id} type="button" className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50" onClick={() => { pick(i); setConfirm(null); }}>{i.name}</button>)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-700"><b>"{confirm}"</b> is not in the list. Only the owner or a manager can add a new {kind}: ask them to add it, or choose an existing one.</p>
        )}
      </Modal>
    </div>
  );
}
