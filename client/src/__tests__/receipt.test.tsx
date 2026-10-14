import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Receipt, A4Invoice } from '../components/Receipt';
import type { Sale, Settings } from '../lib/types';

const settings: Settings = {
  shopName: 'YASH MOBILE', address: 'Colombo', phone: '011 000 0000', email: '', logoUrl: null, receiptWidth: 80, defaultPrintFormat: '80',
  receiptFooter: 'Thank you!', warrantyPolicy: 'Defects only', taxLabel: 'VAT', taxRate: '0', taxRegNo: '', invoicePrefix: 'YM', currency: 'Rs.', language: 'en',
};

const sale: Sale = {
  id: 1, invoiceNumber: 'YM-2026-000001', status: 'COMPLETED', customerId: null, customerName: null, customerPhone: null, cashierId: 1, cashierName: 'Cashier A',
  subtotal: '3600', lineDiscount: '0', billDiscount: '100', taxRate: '0', taxAmount: '0', total: '3500', amountPaid: '3500', amountTendered: '4000', changeDue: '500',
  balanceDue: '0', notes: null, createdAt: '2026-10-14T05:00:00Z', voidedAt: null, voidReason: null, offlineCreatedAt: null,
  items: [{ id: 1, productId: 1, productName: 'Type-C Fast Charger 20W', sku: 'CHG-TC20', qty: 2, qtyReturned: 0, listPrice: '1800', unitPrice: '1800', lineDiscount: '0', lineTotal: '3600', allocatedBillDiscount: '100', serialNumber: 'SN123', warrantyMonths: 6 }],
  payments: [{ id: 1, method: 'CASH', amount: '3500', reference: null }],
  returns: [],
};

describe('receipt layouts', () => {
  it('80 mm receipt shows the stored snapshot, payment and change', () => {
    const { getByTestId } = render(<Receipt sale={sale} settings={settings} width="80" />);
    const el = getByTestId('receipt');
    expect(el.className).toContain('w80');
    const t = el.textContent!;
    for (const s of ['YASH MOBILE', 'YM-2026-000001', 'Cashier A', 'Type-C Fast Charger 20W', '2 x 1,800.00', '3,500.00', 'Cash received', '4,000.00', '500.00', 'S/N SN123', 'Warranty 6 month(s)', 'Defects only', 'Thank you!']) {
      expect(t).toContain(s);
    }
  });

  it('58 mm receipt uses the narrow layout and omits the SKU on item lines', () => {
    const { getByTestId } = render(<Receipt sale={sale} settings={settings} width="58" />);
    expect(getByTestId('receipt').className).toContain('w58');
    expect(getByTestId('receipt').textContent).not.toContain('CHG-TC20');
  });

  it('marks voided sales clearly', () => {
    const { getByTestId } = render(<Receipt sale={{ ...sale, status: 'VOIDED' }} settings={settings} width="80" />);
    expect(getByTestId('receipt').textContent).toContain('VOIDED');
  });

  it('A4 invoice lists items, totals and bill discount', () => {
    const { getByTestId } = render(<A4Invoice sale={sale} settings={settings} />);
    const t = getByTestId('a4-invoice').textContent!;
    expect(t).toContain('INVOICE');
    expect(t).toContain('Bill discount');
    expect(t).toContain('-100.00');
    expect(t).toContain('Grand total (Rs.)');
  });
});
