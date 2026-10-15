import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaperOptions, lastPaper, openPrint } from '../components/PaperChooser';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('paper size chooser', () => {
  it('offers all four sizes and focuses the preferred one', () => {
    const pick = vi.fn();
    render(<PaperOptions preferred="58" onPick={pick} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    const small = screen.getByRole('button', { name: /58 mm/ });
    expect(document.activeElement).toBe(small);
    fireEvent.click(screen.getByRole('button', { name: /A4 invoice/ }));
    expect(pick).toHaveBeenCalledWith('A4');
  });

  it('remembers the last size used on this device, else the shop default', () => {
    expect(lastPaper('A4')).toBe('A4');
    expect(lastPaper(undefined)).toBe('80');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openPrint(7, '58');
    expect(open).toHaveBeenCalledWith('/print/7?format=58&auto=1', '_blank', 'noopener');
    expect(lastPaper('A4')).toBe('58');
    openPrint(7, 'PDF', true);
    expect(open).toHaveBeenLastCalledWith('/api/sales/7/invoice.pdf', '_blank', 'noopener');
  });
});
