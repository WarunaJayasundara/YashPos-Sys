export type D = string; // decimal values arrive as strings

export interface Product {
  id: number; sku: string; barcode: string | null; name: string; description: string | null;
  categoryId: number; category?: string; brandId: number | null; brand?: string; supplierId?: number | null; supplier?: string;
  variantGroup: string | null; compatibility: string | null; color: string | null; size: string | null; connectorType: string | null;
  sellingPrice: D; minSellingPrice: D; purchasePrice?: D; avgCost?: D; unitProfit?: D; marginPercent?: number | null;
  qtyOnHand: number; qtyReserved: number; qtyAvailable: number; reorderLevel: number; maxStockLevel: number | null;
  warrantyMonths: number; imageUrl: string | null; isActive: boolean; stockStatus: 'OK' | 'LOW' | 'OUT' | 'OVER';
  createdAt: string; updatedAt: string;
}

export interface SaleItem {
  id: number; productId: number; productName: string; sku: string; qty: number; qtyReturned: number; listPrice: D; unitPrice: D;
  lineDiscount: D; lineTotal: D; allocatedBillDiscount: D; unitCost?: D; serialNumber: string | null; warrantyMonths: number;
}

export interface Sale {
  id: number; invoiceNumber: string; status: 'COMPLETED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'VOIDED';
  customerId: number | null; customerName: string | null; customerPhone: string | null; cashierId: number; cashierName: string;
  subtotal: D; lineDiscount: D; billDiscount: D; taxRate: D; taxAmount: D; total: D; totalCost?: D; amountPaid: D;
  amountTendered: D; changeDue: D; balanceDue: D; notes: string | null; createdAt: string; voidedAt: string | null; voidReason: string | null;
  offlineCreatedAt: string | null;
  items: SaleItem[]; payments: { id: number; method: string; amount: D; reference: string | null }[];
  returns: { id: number; returnNumber: string; createdAt: string; refundTotal: D; reason: string; type: string; refunds: { method: string; amount: D }[]; items: { saleItemId: number; qty: number; restock: boolean; refundAmount: D }[] }[];
}

export interface Settings {
  shopName: string; address: string; phone: string; email: string; logoUrl: string | null; receiptWidth: number;
  defaultPrintFormat: '58' | '80' | 'A4'; receiptFooter: string; warrantyPolicy: string; taxLabel: string; taxRate: D; taxRegNo: string;
  invoicePrefix: string; currency: string; language: string;
}

export interface Named { id: number; name: string; isActive?: boolean }
