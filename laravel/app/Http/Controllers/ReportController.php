<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Csv;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\V;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController
{
    private const DEFS = [
        'daily-sales' => ['Daily sales', 'reports.sales'],
        'period-sales' => ['Weekly / monthly sales', 'reports.sales'],
        'sales-by-product' => ['Sales by product', 'reports.sales'],
        'sales-by-category' => ['Sales by category', 'reports.sales'],
        'sales-by-brand' => ['Sales by brand', 'reports.sales'],
        'sales-by-cashier' => ['Sales by cashier', 'reports.sales'],
        'profit-by-product' => ['Gross profit by product', 'reports.financial'],
        'profit-by-category' => ['Gross profit by category', 'reports.financial'],
        'purchases' => ['Purchase history', 'purchases.view'],
        'supplier-balances' => ['Supplier balances', 'reports.financial'],
        'inventory-valuation' => ['Current inventory and valuation', 'reports.inventory'],
        'low-stock' => ['Low and out of stock', 'reports.inventory'],
        'stock-movements' => ['Stock movement history', 'reports.inventory'],
        'adjustments' => ['Damaged and adjusted inventory', 'reports.inventory'],
        'returns' => ['Returns, refunds and cancelled sales', 'reports.sales'],
        'discounts' => ['Discounts given', 'reports.sales'],
        'net-profit' => ['Expenses and net profit', 'reports.financial'],
        'cash-reconciliation' => ['Cashier closing and payment reconciliation', 'cash.close'],
        'best-sellers' => ['Best-selling products', 'reports.sales'],
        'slow-moving' => ['Slow-moving products', 'reports.inventory'],
    ];

    private static function n(mixed $v): float
    {
        return $v === null ? 0.0 : (float) $v;
    }

    private static function r2(mixed $v): string
    {
        return Money::fixed(self::n($v));
    }

    private static function local(string $col): string
    {
        return "CONVERT_TZ($col, '+00:00', '".Clock::tzSql()."')";
    }

    private static function col(string $key, string $label, bool $money = false): array
    {
        return $money ? ['key' => $key, 'label' => $label, 'money' => true] : ['key' => $key, 'label' => $label];
    }

    private static function totals(array $rows, array $keys): array
    {
        $out = [];
        foreach ($keys as $k) {
            $out[$k] = Money::fixed(array_sum(array_map(fn ($r) => self::n($r[$k] ?? 0), $rows)));
        }

        return $out;
    }

    /** "AND p.categoryId = ?" etc. for the item-level filters. */
    private static function itemFilters(array $f): array
    {
        $sql = '';
        $b = [];
        foreach (['categoryId' => 'p.categoryId', 'brandId' => 'p.brandId', 'productId' => 'p.id', 'cashierId' => 's.cashierId'] as $k => $c) {
            if (! empty($f[$k])) {
                $sql .= " AND $c = ?";
                $b[] = (int) $f[$k];
            }
        }

        return [$sql, $b];
    }

    /** Net sales by product/category/brand over the period (sale date); returns netted by return date. */
    private static function productLines(array $f, string $groupBy): array
    {
        $key = ['product' => 'p.id', 'category' => 'p.categoryId', 'brand' => 'p.brandId'][$groupBy];
        $label = [
            'product' => "CONCAT(p.name, ' (', p.sku, ')')",
            'category' => "COALESCE((SELECT name FROM categories c WHERE c.id = p.categoryId), 'No category')",
            'brand' => "COALESCE((SELECT name FROM brands b WHERE b.id = p.brandId), 'No brand')",
        ][$groupBy];
        [$fs, $fb] = self::itemFilters($f);
        $sold = DB::select("SELECT $key k, $label label, SUM(si.qty) qty, SUM(si.qty * si.listPrice) gross,
              SUM(si.qty * si.listPrice - si.lineTotal + si.allocatedBillDiscount) disc, SUM(si.lineTotal - si.allocatedBillDiscount) net, SUM(si.qty * si.unitCost) cogs
            FROM sale_items si JOIN sales s ON s.id = si.saleId JOIN products p ON p.id = si.productId
            WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? $fs GROUP BY $key, label", array_merge([$f['gte'], $f['lt']], $fb));
        $ret = DB::select("SELECT $key k, SUM(ri.qty) qty, SUM(ri.refundAmount) refund, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack
            FROM return_items ri JOIN returns r ON r.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId
              JOIN sales s ON s.id = si.saleId JOIN products p ON p.id = si.productId
            WHERE r.createdAt >= ? AND r.createdAt < ? $fs GROUP BY $key", array_merge([$f['gte'], $f['lt']], $fb));
        $rm = [];
        foreach ($ret as $x) {
            $rm[(string) $x->k] = $x;
        }
        $rows = array_map(function ($s) use ($rm) {
            $r = $rm[(string) $s->k] ?? null;
            $net = self::n($s->net) - self::n($r?->refund);
            $cogs = self::n($s->cogs) - self::n($r?->costBack);

            return ['label' => $s->label, 'qtySold' => (int) self::n($s->qty), 'qtyReturned' => (int) self::n($r?->qty), 'grossSales' => self::r2($s->gross),
                'discounts' => self::r2($s->disc), 'returns' => self::r2($r?->refund), 'netSales' => Money::fixed($net), 'cogs' => Money::fixed($cogs),
                'grossProfit' => Money::fixed($net - $cogs), 'marginPercent' => $net > 0 ? Money::fixed(($net - $cogs) / $net * 100, 1) : ''];
        }, $sold);
        usort($rows, fn ($a, $b) => (float) $b['netSales'] <=> (float) $a['netSales']);

        return $rows;
    }

    private static function salesCols(): array
    {
        return [self::col('label', 'Name'), self::col('qtySold', 'Units sold'), self::col('qtyReturned', 'Units returned'),
            self::col('grossSales', 'Gross sales', true), self::col('discounts', 'Discounts', true), self::col('returns', 'Returns', true), self::col('netSales', 'Net sales', true)];
    }

    private static function profitCols(): array
    {
        return array_merge(self::salesCols(), [self::col('cogs', 'Cost of goods sold', true), self::col('grossProfit', 'Gross profit', true), self::col('marginPercent', 'Margin %')]);
    }

    private static function periodSales(array $f, string $group): array
    {
        $bucket = fn (string $c) => [
            'day' => 'DATE('.self::local($c).')',
            'week' => 'DATE_FORMAT(DATE_SUB(DATE('.self::local($c).'), INTERVAL WEEKDAY('.self::local($c).") DAY), '%Y-%m-%d')",
            'month' => 'DATE_FORMAT('.self::local($c).", '%Y-%m')",
        ][$group];
        $cashier = ! empty($f['cashierId']) ? ' AND s.cashierId = '.(int) $f['cashierId'] : '';
        $sales = DB::select('SELECT '.$bucket('s.createdAt')." b, COUNT(*) invoices, SUM(s.subtotal) gross, SUM(s.lineDiscount + s.billDiscount) disc, SUM(s.taxAmount) tax,
            SUM(s.total) total, SUM(s.totalCost) cost FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? $cashier GROUP BY b ORDER BY b", [$f['gte'], $f['lt']]);
        $rets = DB::select('SELECT '.$bucket('r.createdAt')." b, SUM(r.refundTotal) refund, SUM(r.refundNet) refundNet, SUM(r.costReversed) costBack
            FROM (SELECT r0.*, (SELECT SUM(refundAmount) FROM return_items WHERE returnId = r0.id) refundNet FROM returns r0) r
            JOIN sales s ON s.id = r.saleId WHERE r.createdAt >= ? AND r.createdAt < ? $cashier GROUP BY b", [$f['gte'], $f['lt']]);
        $sm = $rm = [];
        foreach ($sales as $s) {
            $sm[(string) $s->b] = $s;
        }
        foreach ($rets as $r) {
            $rm[(string) $r->b] = $r;
        }
        $buckets = array_unique(array_merge(array_keys($sm), array_keys($rm)));
        sort($buckets);

        return array_map(function ($b) use ($sm, $rm) {
            $s = $sm[$b] ?? null;
            $r = $rm[$b] ?? null;
            $inv = (int) self::n($s?->invoices);
            $total = self::n($s?->total);

            return ['period' => (string) $b, 'invoices' => $inv, 'grossSales' => self::r2($s?->gross), 'discounts' => self::r2($s?->disc), 'tax' => self::r2($s?->tax),
                'salesTotal' => self::r2($s?->total), 'returns' => self::r2($r?->refund), 'netAfterReturns' => Money::fixed($total - self::n($r?->refund)),
                'averageBill' => $inv ? Money::fixed($total / $inv) : '0.00', 'cogs' => Money::fixed(self::n($s?->cost) - self::n($r?->costBack)),
                'grossProfit' => Money::fixed($total - self::n($s?->tax) - self::n($r?->refundNet) - (self::n($s?->cost) - self::n($r?->costBack)))];
        }, $buckets);
    }

    private static function periodCols(bool $fin): array
    {
        $c = [self::col('period', 'Period'), self::col('invoices', 'Invoices'), self::col('grossSales', 'Gross sales', true), self::col('discounts', 'Discounts', true),
            self::col('tax', 'Tax', true), self::col('salesTotal', 'Sales total', true), self::col('returns', 'Refunds', true),
            self::col('netAfterReturns', 'Net after refunds', true), self::col('averageBill', 'Average bill', true)];

        return $fin ? array_merge($c, [self::col('cogs', 'COGS', true), self::col('grossProfit', 'Gross profit (ex tax)', true)]) : $c;
    }

    private static function run(string $key, array $f, Request $req): array
    {
        $fin = Auth::can($req, 'reports.financial');
        $range = [$f['gte'], $f['lt']];
        $catSql = ! empty($f['categoryId']) ? ' AND p.categoryId = '.(int) $f['categoryId'] : '';
        $brandSql = ! empty($f['brandId']) ? ' AND p.brandId = '.(int) $f['brandId'] : '';

        switch ($key) {
            case 'daily-sales':
            case 'period-sales':
                $rows = self::periodSales($f, $key === 'daily-sales' ? 'day' : $f['group']);

                return ['columns' => self::periodCols(Auth::can($req, 'reports.financial')), 'rows' => $rows, 'summary' => self::totals($rows, ['invoices', 'salesTotal', 'returns', 'netAfterReturns'])];
            case 'sales-by-product':
            case 'sales-by-category':
            case 'sales-by-brand':
                $rows = self::productLines($f, substr($key, 9));

                return ['columns' => self::salesCols(), 'rows' => $rows, 'summary' => self::totals($rows, ['qtySold', 'netSales'])];
            case 'profit-by-product':
            case 'profit-by-category':
                $rows = self::productLines($f, substr($key, 10));

                return ['columns' => self::profitCols(), 'rows' => $rows, 'summary' => self::totals($rows, ['netSales', 'cogs', 'grossProfit'])];
            case 'sales-by-cashier':
                $cashier = ! empty($f['cashierId']) ? ' AND s.cashierId = '.(int) $f['cashierId'] : '';
                $rows = DB::select("SELECT s.cashierName cashier, COUNT(*) invoices, SUM(s.total) total, SUM(s.lineDiscount + s.billDiscount) discounts
                    FROM sales s WHERE s.createdAt >= ? AND s.createdAt < ? AND s.status <> 'VOIDED' $cashier GROUP BY s.cashierId, s.cashierName ORDER BY total DESC", $range);
                $voids = [];
                foreach (DB::select("SELECT cashierName cashier, COUNT(*) c FROM sales WHERE status = 'VOIDED' AND createdAt >= ? AND createdAt < ? GROUP BY cashierName", $range) as $v) {
                    $voids[$v->cashier] = (int) $v->c;
                }
                $out = array_map(fn ($r) => ['cashier' => $r->cashier, 'invoices' => (int) $r->invoices, 'total' => self::r2($r->total), 'discounts' => self::r2($r->discounts),
                    'voided' => $voids[$r->cashier] ?? 0, 'averageBill' => $r->invoices ? Money::fixed(self::n($r->total) / $r->invoices) : '0.00'], $rows);

                return ['columns' => [self::col('cashier', 'Cashier'), self::col('invoices', 'Invoices'), self::col('total', 'Sales total', true), self::col('averageBill', 'Average bill', true),
                    self::col('discounts', 'Discounts given', true), self::col('voided', 'Voided sales')], 'rows' => $out];
            case 'purchases':
                $sup = ! empty($f['supplierId']) ? ' AND po.supplierId = '.(int) $f['supplierId'] : '';
                $rows = DB::select("SELECT po.poNumber, DATE_FORMAT(po.purchaseDate, '%Y-%m-%d') purchaseDate, su.name supplier, po.supplierInvoiceNo, po.status,
                      po.invoiceTotal, po.amountPaid, po.invoiceTotal - po.amountPaid balance,
                      (SELECT SUM(qtyOrdered) FROM purchase_items WHERE purchaseOrderId = po.id) unitsOrdered,
                      (SELECT SUM(qtyReceived) FROM purchase_items WHERE purchaseOrderId = po.id) unitsAccepted,
                      (SELECT SUM(qtyDamaged) FROM purchase_items WHERE purchaseOrderId = po.id) unitsDamaged
                    FROM purchase_orders po JOIN suppliers su ON su.id = po.supplierId
                    WHERE po.purchaseDate >= ? AND po.purchaseDate <= ? $sup ORDER BY po.purchaseDate DESC", [Clock::dateValue($f['from']), Clock::dateValue($f['to'])]);
                $out = array_map(fn ($r) => ['poNumber' => $r->poNumber, 'purchaseDate' => $r->purchaseDate, 'supplier' => $r->supplier, 'supplierInvoiceNo' => $r->supplierInvoiceNo,
                    'status' => $r->status, 'invoiceTotal' => self::r2($r->invoiceTotal), 'amountPaid' => self::r2($r->amountPaid), 'balance' => self::r2($r->balance),
                    'unitsOrdered' => (int) $r->unitsOrdered, 'unitsAccepted' => (int) $r->unitsAccepted, 'unitsDamaged' => (int) $r->unitsDamaged], $rows);

                return ['columns' => [self::col('poNumber', 'PO'), self::col('purchaseDate', 'Date'), self::col('supplier', 'Supplier'), self::col('supplierInvoiceNo', 'Supplier invoice'),
                    self::col('status', 'Status'), self::col('unitsOrdered', 'Ordered'), self::col('unitsAccepted', 'Accepted'), self::col('unitsDamaged', 'Damaged'),
                    self::col('invoiceTotal', 'Invoice total', true), self::col('amountPaid', 'Paid', true), self::col('balance', 'Balance', true)],
                    'rows' => $out, 'summary' => self::totals($out, ['invoiceTotal', 'amountPaid', 'balance'])];
            case 'supplier-balances':
                $rows = DB::select("SELECT s.name supplier, s.phone,
                      COALESCE((SELECT SUM(invoiceTotal) FROM purchase_orders po WHERE po.supplierId = s.id AND po.status NOT IN ('CANCELLED','DRAFT')), 0) invoiced,
                      COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplierId = s.id), 0) paid
                    FROM suppliers s ORDER BY s.name");
                $out = array_map(fn ($r) => ['supplier' => $r->supplier, 'phone' => $r->phone, 'invoiced' => self::r2($r->invoiced), 'paid' => self::r2($r->paid),
                    'balance' => Money::fixed(self::n($r->invoiced) - self::n($r->paid))], $rows);

                return ['columns' => [self::col('supplier', 'Supplier'), self::col('phone', 'Phone'), self::col('invoiced', 'Invoiced', true), self::col('paid', 'Paid', true),
                    self::col('balance', 'Outstanding', true)], 'rows' => $out, 'summary' => self::totals($out, ['invoiced', 'paid', 'balance'])];
            case 'inventory-valuation':
                $rows = DB::select("SELECT p.sku, p.name, COALESCE(c.name, 'No category') category, COALESCE(b.name, '') brand, p.qtyOnHand, p.reorderLevel, p.avgCost, p.sellingPrice,
                      p.qtyOnHand * p.avgCost costValue, p.qtyOnHand * p.sellingPrice retailValue
                    FROM products p LEFT JOIN categories c ON c.id = p.categoryId LEFT JOIN brands b ON b.id = p.brandId
                    WHERE p.isActive = 1 $catSql $brandSql ORDER BY c.name, p.name");
                $out = array_map(fn ($r) => ['sku' => $r->sku, 'name' => $r->name, 'category' => $r->category, 'brand' => $r->brand, 'qtyOnHand' => (int) $r->qtyOnHand,
                    'sellingPrice' => self::r2($r->sellingPrice), 'retailValue' => self::r2($r->retailValue)]
                    + ($fin ? ['avgCost' => Money::fixed(self::n($r->avgCost)), 'costValue' => self::r2($r->costValue), 'potentialProfit' => Money::fixed(self::n($r->retailValue) - self::n($r->costValue))] : []), $rows);
                $cols = [self::col('sku', 'SKU'), self::col('name', 'Product'), self::col('category', 'Category'), self::col('brand', 'Brand'), self::col('qtyOnHand', 'On hand'),
                    self::col('sellingPrice', 'Selling price', true), self::col('retailValue', 'Retail value', true)];
                if ($fin) {
                    array_push($cols, self::col('avgCost', 'Avg cost', true), self::col('costValue', 'Cost value', true), self::col('potentialProfit', 'Potential profit', true));
                }

                return ['columns' => $cols, 'rows' => $out, 'summary' => self::totals($out, $fin ? ['qtyOnHand', 'retailValue', 'costValue', 'potentialProfit'] : ['qtyOnHand', 'retailValue'])];
            case 'low-stock':
                $rows = DB::select("SELECT p.sku, p.name, COALESCE(c.name, 'No category') category, p.qtyOnHand - p.qtyReserved available, p.reorderLevel,
                      CASE WHEN p.qtyOnHand - p.qtyReserved <= 0 THEN 'OUT' ELSE 'LOW' END status, (SELECT name FROM suppliers s WHERE s.id = p.supplierId) supplier
                    FROM products p LEFT JOIN categories c ON c.id = p.categoryId
                    WHERE p.isActive = 1 AND p.qtyOnHand - p.qtyReserved <= p.reorderLevel ORDER BY available, p.name");

                return ['columns' => [self::col('status', 'Status'), self::col('sku', 'SKU'), self::col('name', 'Product'), self::col('category', 'Category'),
                    self::col('available', 'Available'), self::col('reorderLevel', 'Reorder level'), self::col('supplier', 'Supplier')],
                    'rows' => array_map(fn ($r) => ['sku' => $r->sku, 'name' => $r->name, 'category' => $r->category, 'available' => (int) $r->available,
                        'reorderLevel' => (int) $r->reorderLevel, 'status' => $r->status, 'supplier' => $r->supplier], $rows)];
            case 'stock-movements':
                $prod = ! empty($f['productId']) ? ' AND m.productId = '.(int) $f['productId'] : '';
                $rows = DB::select('SELECT DATE_FORMAT('.self::local('m.createdAt').", '%Y-%m-%d %H:%i') time, p.sku, p.name, m.type, m.qtyChange, m.qtyAfter, m.refType, m.refId, m.reason, u.fullName user
                    FROM stock_movements m JOIN products p ON p.id = m.productId JOIN users u ON u.id = m.userId
                    WHERE m.createdAt >= ? AND m.createdAt < ? $prod $catSql ORDER BY m.id DESC LIMIT 5000", $range);
                $keys = ['time', 'sku', 'name', 'type', 'qtyChange', 'qtyAfter', 'refType', 'refId', 'reason', 'user'];

                return ['columns' => array_map(fn ($k) => self::col($k, $k === 'qtyChange' ? 'Change' : ($k === 'qtyAfter' ? 'Balance' : ucfirst($k))), $keys),
                    'rows' => array_map(fn ($r) => array_merge((array) $r, ['qtyChange' => (int) $r->qtyChange, 'qtyAfter' => (int) $r->qtyAfter, 'refId' => $r->refId === null ? '' : (int) $r->refId]), $rows)];
            case 'adjustments':
                $rows = DB::select('SELECT DATE_FORMAT('.self::local('m.createdAt').", '%Y-%m-%d %H:%i') time, p.sku, p.name, m.type, m.qtyChange, m.unitCost, -m.qtyChange * m.unitCost costLost, m.reason, u.fullName user
                    FROM stock_movements m JOIN products p ON p.id = m.productId JOIN users u ON u.id = m.userId
                    WHERE m.type IN ('DAMAGED','LOST','ADJUSTMENT','SUPPLIER_RETURN') AND m.createdAt >= ? AND m.createdAt < ? ORDER BY m.id DESC", $range);
                $out = array_map(fn ($r) => ['time' => $r->time, 'sku' => $r->sku, 'name' => $r->name, 'type' => $r->type, 'qtyChange' => (int) $r->qtyChange,
                    'reason' => $r->reason, 'user' => $r->user] + ($fin ? ['costImpact' => self::r2($r->costLost)] : []), $rows);
                $cols = [self::col('time', 'Time'), self::col('sku', 'SKU'), self::col('name', 'Product'), self::col('type', 'Type'), self::col('qtyChange', 'Qty'), self::col('reason', 'Reason'), self::col('user', 'By')];
                if ($fin) {
                    $cols[] = self::col('costImpact', 'Cost written off', true);
                }

                return ['columns' => $cols, 'rows' => $out] + ($fin ? ['summary' => self::totals($out, ['costImpact'])] : []);
            case 'returns':
                $rets = DB::select('SELECT DATE_FORMAT('.self::local('r.createdAt').", '%Y-%m-%d %H:%i') time, 'RETURN' kind, r.returnNumber ref, s.invoiceNumber invoice, r.type detail, r.reason,
                      r.refundTotal amount, (SELECT GROUP_CONCAT(DISTINCT method) FROM refunds WHERE returnId = r.id) method
                    FROM returns r JOIN sales s ON s.id = r.saleId WHERE r.createdAt >= ? AND r.createdAt < ?", $range);
                $voids = DB::select('SELECT DATE_FORMAT('.self::local('s.voidedAt').", '%Y-%m-%d %H:%i') time, 'VOID' kind, s.invoiceNumber ref, s.invoiceNumber invoice, 'Voided' detail,
                      s.voidReason reason, s.total amount, '' method FROM sales s WHERE s.status = 'VOIDED' AND s.voidedAt >= ? AND s.voidedAt < ?", $range);
                $rows = array_map(fn ($r) => array_merge((array) $r, ['amount' => self::r2($r->amount)]), array_merge($rets, $voids));
                usort($rows, fn ($a, $b) => strcmp((string) $b['time'], (string) $a['time']));

                return ['columns' => [self::col('time', 'Time'), self::col('kind', 'Kind'), self::col('ref', 'Reference'), self::col('invoice', 'Original invoice'), self::col('detail', 'Type'),
                    self::col('reason', 'Reason'), self::col('method', 'Refund method'), self::col('amount', 'Amount', true)], 'rows' => $rows, 'summary' => self::totals($rows, ['amount'])];
            case 'discounts':
                $cashier = ! empty($f['cashierId']) ? ' AND s.cashierId = '.(int) $f['cashierId'] : '';
                $rows = DB::select('SELECT DATE_FORMAT('.self::local('s.createdAt').", '%Y-%m-%d %H:%i') time, s.invoiceNumber, s.cashierName cashier,
                      (SELECT SUM(qty * listPrice) FROM sale_items WHERE saleId = s.id) listTotal,
                      (SELECT SUM(qty * listPrice) FROM sale_items WHERE saleId = s.id) - s.subtotal + s.lineDiscount + s.billDiscount discount,
                      (SELECT fullName FROM users WHERE id = s.discountApprovedById) approvedBy
                    FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? $cashier HAVING discount > 0 ORDER BY s.id DESC", $range);
                $out = array_map(fn ($r) => ['time' => $r->time, 'invoiceNumber' => $r->invoiceNumber, 'cashier' => $r->cashier, 'listTotal' => self::r2($r->listTotal),
                    'discount' => self::r2($r->discount), 'percent' => self::n($r->listTotal) ? Money::fixed(self::n($r->discount) / self::n($r->listTotal) * 100, 1) : '',
                    'approvedBy' => $r->approvedBy ?? ''], $rows);

                return ['columns' => [self::col('time', 'Time'), self::col('invoiceNumber', 'Invoice'), self::col('cashier', 'Cashier'), self::col('listTotal', 'List price total', true),
                    self::col('discount', 'Discount', true), self::col('percent', '%'), self::col('approvedBy', 'Approved by')], 'rows' => $out, 'summary' => self::totals($out, ['discount'])];
            case 'net-profit':
                $s = DB::selectOne("SELECT SUM(total - taxAmount) net, SUM(totalCost) cogs, SUM(taxAmount) tax FROM sales WHERE status <> 'VOIDED' AND createdAt >= ? AND createdAt < ?", $range);
                $r = DB::selectOne('SELECT SUM(ri.refundAmount) refundNet, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack
                    FROM return_items ri JOIN returns rt ON rt.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId WHERE rt.createdAt >= ? AND rt.createdAt < ?', $range);
                $w = DB::scalar("SELECT SUM(-m.qtyChange * m.unitCost) FROM stock_movements m WHERE m.type IN ('DAMAGED','LOST') AND m.createdAt >= ? AND m.createdAt < ?", $range);
                $exp = DB::select('SELECT category, SUM(amount) v FROM expenses WHERE expenseDate >= ? AND expenseDate <= ? GROUP BY category ORDER BY v DESC', [Clock::dateValue($f['from']), Clock::dateValue($f['to'])]);
                $netSales = self::n($s->net) - self::n($r->refundNet);
                $cogs = self::n($s->cogs) - self::n($r->costBack);
                $gross = $netSales - $cogs;
                $writeOff = self::n($w);
                $opex = array_sum(array_map(fn ($e) => self::n($e->v), $exp));
                $rows = array_merge([
                    ['line' => 'Net sales revenue (after discounts and returns, excluding tax)', 'amount' => Money::fixed($netSales)],
                    ['line' => 'Cost of goods sold', 'amount' => Money::fixed(-$cogs)],
                    ['line' => 'Gross profit', 'amount' => Money::fixed($gross)],
                    ['line' => 'Gross margin %', 'amount' => $netSales ? Money::fixed($gross / $netSales * 100, 1) : ''],
                    ['line' => 'Stock written off (damaged / lost)', 'amount' => Money::fixed(-$writeOff)],
                ], array_map(fn ($e) => ['line' => "Expense: $e->category", 'amount' => Money::fixed(-self::n($e->v))], $exp), [
                    ['line' => 'Total operating expenses', 'amount' => Money::fixed(-$opex)],
                    ['line' => 'Net profit', 'amount' => Money::fixed($gross - $writeOff - $opex)],
                    ['line' => 'Tax collected (not revenue)', 'amount' => self::r2($s->tax)],
                ]);

                return ['columns' => [self::col('line', 'Line'), self::col('amount', 'Amount', true)], 'rows' => $rows];
            case 'cash-reconciliation':
                $rows = [];
                for ($d = $f['from']; $d <= $f['to']; $d = Clock::addDays($d, 1)) {
                    $s = MoneyController::cashSummary($d);
                    $c = DB::table('cash_closings')->where('businessDate', $d)->first();
                    $nc = (array) $s['nonCashTotals'];
                    $rows[] = ['date' => $d, 'cashSales' => Money::fromCents($s['cashSales']), 'cashCollections' => Money::fromCents($s['cashCollections']),
                        'cashRefunds' => Money::fromCents($s['cashRefunds']), 'cashExpenses' => Money::fromCents($s['cashExpenses']),
                        'card' => $nc['CARD'] ?? '0.00', 'bank' => $nc['BANK_TRANSFER'] ?? '0.00', 'qr' => $nc['QR'] ?? '0.00', 'credit' => $nc['CREDIT'] ?? '0.00',
                        'expected' => $c ? Fmt::dec($c->expectedCash) : '', 'counted' => $c ? Fmt::dec($c->countedCash) : '', 'difference' => $c ? Fmt::dec($c->difference) : 'not closed'];
                    if (count($rows) > 92) {
                        break;
                    }
                }

                return ['columns' => [self::col('date', 'Date'), self::col('cashSales', 'Cash sales', true), self::col('cashCollections', 'Credit collected', true),
                    self::col('cashRefunds', 'Cash refunds', true), self::col('cashExpenses', 'Drawer expenses', true), self::col('card', 'Card', true),
                    self::col('bank', 'Bank transfer', true), self::col('qr', 'QR', true), self::col('credit', 'On account', true), self::col('expected', 'Expected cash', true),
                    self::col('counted', 'Counted', true), self::col('difference', 'Difference', true)], 'rows' => $rows];
            case 'best-sellers':
                $rows = self::productLines($f, 'product');
                usort($rows, fn ($a, $b) => $b['qtySold'] <=> $a['qtySold']);

                return ['columns' => self::salesCols(), 'rows' => array_slice($rows, 0, 50)];
            case 'slow-moving':
                $since = Clock::db(microtime(true) - $f['slowDays'] * 86400);
                $rows = DB::select("SELECT p.sku, p.name, p.qtyOnHand,
                      COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED' AND s.createdAt >= ?), 0) soldInWindow,
                      (SELECT DATE_FORMAT(MAX(s.createdAt), '%Y-%m-%d') FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED') lastSold
                    FROM products p WHERE p.isActive = 1 AND p.qtyOnHand > 0
                    HAVING soldInWindow <= GREATEST(1, p.qtyOnHand * 0.1) ORDER BY soldInWindow, p.qtyOnHand DESC LIMIT 200", [$since]);

                return ['columns' => [self::col('sku', 'SKU'), self::col('name', 'Product'), self::col('qtyOnHand', 'On hand'), self::col('soldInWindow', "Sold in last {$f['slowDays']} days"),
                    self::col('lastSold', 'Last sold')], 'rows' => array_map(fn ($r) => ['sku' => $r->sku, 'name' => $r->name, 'qtyOnHand' => (int) $r->qtyOnHand,
                        'soldInWindow' => (int) $r->soldInWindow, 'lastSold' => $r->lastSold ?? 'never'], $rows)];
        }
        throw ApiError::notFound('Unknown report');
    }

    public function index(Request $req)
    {
        $out = [];
        foreach (self::DEFS as $key => [$title, $perm]) {
            if (Auth::can($req, $perm)) {
                $out[] = ['key' => $key, 'title' => $title];
            }
        }

        return response()->json($out);
    }

    public function show(Request $req, string $key)
    {
        $def = self::DEFS[$key] ?? null;
        if (! $def) {
            throw ApiError::notFound('Unknown report');
        }
        if (! Auth::can($req, $def[1])) {
            throw ApiError::forbidden();
        }
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string', 'categoryId' => 'sometimes|integer', 'brandId' => 'sometimes|integer',
            'productId' => 'sometimes|integer', 'cashierId' => 'sometimes|integer', 'supplierId' => 'sometimes|integer', 'group' => 'sometimes|in:day,week,month',
            'slowDays' => 'sometimes|integer|min:7|max:365', 'format' => 'sometimes|in:json,csv']);
        $today = Clock::localToday();
        $range = Clock::range($q['from'] ?? $today, $q['to'] ?? $q['from'] ?? $today);
        if ($range['from'] > $range['to']) {
            throw ApiError::badRequest('"From" must be on or before "to"');
        }
        $f = $q + ['group' => 'day', 'slowDays' => 60] + $range;
        $f['slowDays'] = (int) $f['slowDays'];
        $out = self::run($key, $f, $req);
        if (($q['format'] ?? 'json') === 'csv') {
            if (! Auth::can($req, 'reports.export')) {
                throw ApiError::forbidden('You may view but not export reports');
            }

            return Csv::response("{$key}_{$range['from']}_{$range['to']}.csv", Csv::make($out['rows'], $out['columns']));
        }

        return response()->json(['key' => $key, 'title' => $def[0], 'from' => $range['from'], 'to' => $range['to']] + $out);
    }
}
