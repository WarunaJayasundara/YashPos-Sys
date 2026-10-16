<?php

namespace App\Support;

/** Every permission the API checks, and the default roles. Seeded into the database. */
class Perms
{
    public const ALL = [
        'dashboard.view' => 'View the sales dashboard',
        'dashboard.financial' => 'See profit, cost and stock valuation on the dashboard',
        'products.view' => 'Search products, stock and retail prices',
        'products.view_cost' => 'See buying prices, average cost and margins',
        'products.manage' => 'Create, edit, import and deactivate products',
        'prices.change' => 'Change selling and minimum prices',
        'catalog.manage' => 'Manage categories and brands',
        'suppliers.manage' => 'Manage suppliers',
        'purchases.view' => 'View purchases and supplier balances',
        'purchases.manage' => 'Create purchase orders and receive goods',
        'purchases.pay' => 'Record supplier payments',
        'stock.view' => 'View stock movement history',
        'stock.adjust' => 'Request stock adjustments',
        'stock.approve' => 'Approve stock adjustments',
        'stock.undo' => 'Undo wrong stock entries (opening stock and manual adjustments)',
        'products.delete' => 'Delete products that were never sold or purchased',
        'data.reset' => 'Clear test sales, purchases and stock history before going live',
        'sales.create' => 'Use the POS to make sales',
        'sales.view_own' => 'View and reprint own sales',
        'sales.view_all' => 'View and reprint all sales',
        'sales.void' => 'Void a sale (same business day)',
        'returns.create' => 'Start a return or exchange',
        'returns.approve' => 'Approve returns and refunds',
        'discounts.override' => 'Approve discounts above the role limit or below minimum price',
        'customers.view' => 'View customers',
        'customers.manage' => 'Create customers and record their payments',
        'warranty.manage' => 'Record and update warranty claims',
        'expenses.view' => 'View expenses',
        'expenses.manage' => 'Record expenses',
        'cash.close' => 'Perform the daily cash closing',
        'reports.sales' => 'Sales, returns and discount reports',
        'reports.inventory' => 'Inventory and stock reports (without cost)',
        'reports.financial' => 'Profit, cost, valuation, expenses and supplier balance reports',
        'reports.export' => 'Export reports to CSV',
        'users.manage' => 'Manage staff accounts, roles and permissions',
        'audit.view' => 'View the audit log',
        'settings.manage' => 'Change business and invoice settings',
    ];

    public static function codes(): array
    {
        return array_keys(self::ALL);
    }

    public static function defaultRoles(): array
    {
        return [
            ['code' => 'admin', 'name' => 'Admin / Owner', 'maxDiscountPercent' => 100, 'permissions' => self::codes()],
            ['code' => 'manager', 'name' => 'Manager', 'maxDiscountPercent' => 15, 'permissions' => [
                'dashboard.view', 'products.view', 'products.view_cost', 'products.manage', 'catalog.manage', 'suppliers.manage',
                'purchases.view', 'purchases.manage', 'stock.view', 'stock.adjust', 'stock.approve', 'sales.create',
                'sales.view_own', 'sales.view_all', 'sales.void', 'returns.create', 'returns.approve', 'discounts.override',
                'customers.view', 'customers.manage', 'warranty.manage', 'expenses.view', 'expenses.manage', 'cash.close',
                'reports.sales', 'reports.inventory', 'reports.export',
            ]],
            ['code' => 'cashier', 'name' => 'Cashier / Sales Staff', 'maxDiscountPercent' => 5, 'permissions' => [
                'products.view', 'sales.create', 'sales.view_own', 'returns.create', 'customers.view', 'customers.manage',
                'warranty.manage', 'cash.close',
            ]],
        ];
    }
}
