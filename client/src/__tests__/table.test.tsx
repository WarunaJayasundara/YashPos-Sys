import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DataTable } from '../components/Table';

describe('responsive data table', () => {
  it('renders a table for wide screens and stacked cards for phones from the same data', () => {
    const { container } = render(
      <DataTable rows={[{ id: 1, name: 'Cable', qty: 4 }]} rowKey={(r) => r.id} columns={[
        { key: 'n', header: 'Name', primary: true, render: (r) => r.name },
        { key: 'q', header: 'Qty', num: true, render: (r) => r.qty },
        { key: 'h', header: 'Hidden on phone', hideMobile: true, render: () => 'x' },
      ]} />,
    );
    const table = container.querySelector('div.hidden.md\\:block table');
    const cards = container.querySelector('ul.md\\:hidden');
    expect(table).not.toBeNull();
    expect(cards).not.toBeNull();
    expect(cards!.textContent).toContain('Cable');
    expect(cards!.textContent).toContain('Qty');
    expect(cards!.textContent).not.toContain('Hidden on phone');
  });

  it('shows an empty state', () => {
    const { getByText } = render(<DataTable rows={[]} rowKey={() => 1} columns={[]} empty="No sales" />);
    expect(getByText('No sales')).toBeTruthy();
  });
});
