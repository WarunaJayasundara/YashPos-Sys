// Every permission the API checks. Seeded into the permissions table.
export const PERMISSIONS = {
  'dashboard.view': 'View the sales dashboard',
  'dashboard.financial': 'See profit, cost and stock valuation on the dashboard',
  'products.view': 'Search products, stock and retail prices',
  'products.view_cost': 'See buying prices, average cost and margins',
  'products.manage': 'Create, edit, import and deactivate products',
  'prices.change': 'Change selling and minimum prices',
  'catalog.manage': 'Manage categories and brands',
  'suppliers.manage': 'Manage suppliers',
  'purchases.view': 'View purchases and supplier balances',
  'purchases.manage': 'Create purchase orders and receive goods',
  'purchases.pay': 'Record supplier payments',
  'stock.view': 'View stock movement history',
  'stock.adjust': 'Request stock adjustments',
  'stock.approve': 'Approve stock adjustments',
  'sales.create': 'Use the POS to make sales',
  'sales.view_own': 'View and reprint own sales',
  'sales.view_all': 'View and reprint all sales',
  'sales.void': 'Void a sale (same business day)',
  'returns.create': 'Start a return or exchange',
  'returns.approve': 'Approve returns and refunds',
  'discounts.override': 'Approve discounts above the role limit or below minimum price',
  'customers.view': 'View customers',
  'customers.manage': 'Create customers and record their payments',
  'warranty.manage': 'Record and update warranty claims',
  'expenses.view': 'View expenses',
  'expenses.manage': 'Record expenses',
  'cash.close': 'Perform the daily cash closing',
  'reports.sales': 'Sales, returns and discount reports',
  'reports.inventory': 'Inventory and stock reports (without cost)',
  'reports.financial': 'Profit, cost, valuation, expenses and supplier balance reports',
  'reports.export': 'Export reports to CSV',
  'users.manage': 'Manage staff accounts, roles and permissions',
  'audit.view': 'View the audit log',
  'settings.manage': 'Change business and invoice settings',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

export const DEFAULT_ROLES: { code: string; name: string; maxDiscountPercent: number; permissions: PermissionCode[] }[] = [
  { code: 'admin', name: 'Admin / Owner', maxDiscountPercent: 100, permissions: ALL_PERMISSIONS },
  {
    code: 'manager',
    name: 'Manager',
    maxDiscountPercent: 15,
    permissions: [
      'dashboard.view', 'products.view', 'products.view_cost', 'products.manage', 'catalog.manage', 'suppliers.manage',
      'purchases.view', 'purchases.manage', 'stock.view', 'stock.adjust', 'stock.approve', 'sales.create',
      'sales.view_own', 'sales.view_all', 'sales.void', 'returns.create', 'returns.approve', 'discounts.override',
      'customers.view', 'customers.manage', 'warranty.manage', 'expenses.view', 'expenses.manage', 'cash.close',
      'reports.sales', 'reports.inventory', 'reports.export',
    ],
  },
  {
    code: 'cashier',
    name: 'Cashier / Sales Staff',
    maxDiscountPercent: 5,
    permissions: [
      'products.view', 'sales.create', 'sales.view_own', 'returns.create', 'customers.view', 'customers.manage',
      'warranty.manage', 'cash.close',
    ],
  },
];
