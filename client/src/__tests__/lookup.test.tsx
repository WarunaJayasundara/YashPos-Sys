import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LookupField } from '../components/LookupField';
import { ToastProvider } from '../components/toast';

let perms = ['catalog.manage'];
vi.mock('../lib/auth', () => ({ useAuth: () => ({ can: (...p: string[]) => p.some((x) => perms.includes(x)) }) }));

const brands = [{ id: 1, name: 'Samsung' }, { id: 2, name: 'Anker' }, { id: 3, name: 'Baseus' }];

function setup(value = '') {
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider><LookupField kind="brand" items={brands} value={value} onChange={onChange} /></ToastProvider>
    </QueryClientProvider>,
  );
  return { onChange, input: screen.getByRole('combobox') };
}

describe('brand / category box', () => {
  it('suggests existing names while typing', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'sam' } });
    expect(screen.getByRole('button', { name: 'Samsung' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Baseus' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add "sam" as a new brand/ })).toBeTruthy();
  });

  it('picks the existing brand when the name matches in any case, without asking to add', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: '  anker ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2');
    expect(screen.queryByText(/New brand\?/)).toBeNull();
  });

  it('asks before adding a new brand', () => {
    perms = ['catalog.manage'];
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'Ugreen' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('New brand?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add brand/ })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tells users who cannot manage the catalogue to ask the owner', () => {
    perms = [];
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Ugreen' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/Only the owner or a manager can add a new brand/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add brand/ })).toBeNull();
    perms = ['catalog.manage'];
  });
});
