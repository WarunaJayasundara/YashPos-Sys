<?php

namespace App\Http\Controllers;

use App\Support\Auth;
use App\Support\Clock;
use App\Support\Fmt;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController
{
    private static function n(mixed $v): float
    {
        return $v === null ? 0.0 : (float) $v;
    }

    /** Net sales (ex tax), COGS and profit for a window, with returns netted on their own date. */
    private static function totals(string $gte, string $lt): array
    {
        $s = DB::selectOne("SELECT COUNT(*) c, SUM(total) total, SUM(taxAmount) tax, SUM(totalCost) cost FROM sales WHERE status <> 'VOIDED' AND createdAt >= ? AND createdAt < ?", [$gte, $lt]);
        $r = DB::selectOne('SELECT SUM(ri.refundAmount) refundNet, SUM(CASE WHEN ri.restock THEN ri.qty * si.unitCost ELSE 0 END) costBack,
              (SELECT SUM(refundTotal) FROM returns WHERE createdAt >= ? AND createdAt < ?) refundTotal
            FROM return_items ri JOIN returns rt ON rt.id = ri.returnId JOIN sale_items si ON si.id = ri.saleItemId
            WHERE rt.createdAt >= ? AND rt.createdAt < ?', [$gte, $lt, $gte, $lt]);
        $count = (int) $s->c;
        $netSales = self::n($s->total) - self::n($s->tax) - self::n($r->refundNet);
        $cogs = self::n($s->cost) - self::n($r->costBack);

        return ['sales' => $count, 'revenue' => self::n($s->total) - self::n($r->refundTotal), 'netSales' => $netSales, 'cogs' => $cogs,
            'grossProfit' => $netSales - $cogs, 'refunds' => self::n($r->refundTotal), 'avgBill' => $count ? self::n($s->total) / $count : 0];
    }

    public function index(Request $req): JsonResponse
    {
        Auth::require($req, 'dashboard.view');
        $fin = Auth::can($req, 'dashboard.financial');
        $today = Clock::range(Clock::localToday());
        $range = Clock::range(is_string($req->query('from')) ? $req->query('from') : null, is_string($req->query('to')) ? $req->query('to') : null);
        $t = self::totals($today['gte'], $today['lt']);
        $p = self::totals($range['gte'], $range['lt']);
        $win = [$range['gte'], $range['lt']];

        $stock = DB::selectOne('SELECT SUM(GREATEST(qtyOnHand,0)) units, SUM(GREATEST(qtyOnHand,0) * avgCost) cost, SUM(GREATEST(qtyOnHand,0) * sellingPrice) retail,
              SUM(CASE WHEN qtyOnHand - qtyReserved > 0 AND qtyOnHand - qtyReserved <= reorderLevel THEN 1 ELSE 0 END) low,
              SUM(CASE WHEN qtyOnHand - qtyReserved <= 0 THEN 1 ELSE 0 END) `out` FROM products WHERE isActive = 1');
        $expenses = $writeOff = 0.0;
        if ($fin) {
            $expenses = self::n(DB::scalar('SELECT SUM(amount) FROM expenses WHERE expenseDate >= ? AND expenseDate <= ?', [Clock::dateValue($range['from']), Clock::dateValue($range['to'])]));
            $writeOff = self::n(DB::scalar("SELECT SUM(-qtyChange * unitCost) FROM stock_movements WHERE type IN ('DAMAGED','LOST') AND createdAt >= ? AND createdAt < ?", $win));
        }
        $local = "CONVERT_TZ(s.createdAt, '+00:00', '".Clock::tzSql()."')";
        $series = DB::select("SELECT DATE($local) d, COUNT(*) sales, SUM(s.total) total, SUM(s.total - s.taxAmount - s.totalCost) profit
            FROM sales s WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? GROUP BY d ORDER BY d", $win);
        $best = DB::select("SELECT si.productId id, si.productName name, SUM(si.qty - si.qtyReturned) qty, SUM((si.lineTotal - si.allocatedBillDiscount) * (si.qty - si.qtyReturned) / si.qty) total
            FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ?
            GROUP BY si.productId, si.productName ORDER BY qty DESC, si.productId LIMIT 8", $win);
        $since = Clock::db(microtime(true) - 60 * 86400);
        $slow = DB::select("SELECT p.id, p.name, p.qtyOnHand,
              COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = p.id AND s.status <> 'VOIDED' AND s.createdAt >= ?), 0) sold
            FROM products p WHERE p.isActive = 1 AND p.qtyOnHand > 0 ORDER BY sold ASC, p.qtyOnHand DESC LIMIT 6", [$since]);
        $methods = DB::select("SELECT p.method, SUM(p.amount) v FROM payments p JOIN sales s ON s.id = p.saleId
            WHERE s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? GROUP BY p.method", $win);
        $recentSales = Fmt::rows('sales', DB::table('sales')->orderByDesc('id')->limit(8)->get(['id', 'invoiceNumber', 'createdAt', 'total', 'status', 'cashierName']));
        $recentPurchases = Auth::can($req, 'purchases.view')
            ? DB::table('purchase_orders as po')->join('suppliers as s', 's.id', '=', 'po.supplierId')->orderByDesc('po.id')->limit(5)
                ->get(['po.id', 'po.poNumber', 'po.purchaseDate', 'po.status', 'po.invoiceTotal', 's.name as _supplier'])
                ->map(fn ($r) => Fmt::row('purchase_orders', collect((array) $r)->except('_supplier')->all()) + ['supplier' => ['name' => $r->_supplier]])->all()
            : [];
        $low = DB::select('SELECT id, name, sku, qtyOnHand - qtyReserved available, reorderLevel FROM products WHERE isActive = 1 AND qtyOnHand - qtyReserved <= reorderLevel ORDER BY available LIMIT 8');

        $m = fn (float $v) => Money::fixed($v);

        return response()->json([
            'range' => ['from' => $range['from'], 'to' => $range['to']],
            'today' => ['revenue' => $m($t['revenue']), 'sales' => $t['sales'], 'avgBill' => $m($t['avgBill'])] + ($fin ? ['grossProfit' => $m($t['grossProfit'])] : []),
            'period' => ['revenue' => $m($p['revenue']), 'sales' => $p['sales'], 'avgBill' => $m($p['avgBill']), 'refunds' => $m($p['refunds'])] + ($fin ? [
                'netSales' => $m($p['netSales']), 'cogs' => $m($p['cogs']), 'grossProfit' => $m($p['grossProfit']),
                'grossMarginPercent' => $p['netSales'] ? round($p['grossProfit'] / $p['netSales'] * 100, 1) : null,
                'expenses' => $m($expenses), 'stockWrittenOff' => $m($writeOff), 'netProfit' => $m($p['grossProfit'] - $writeOff - $expenses),
            ] : []),
            'stock' => ['units' => (int) self::n($stock->units), 'lowCount' => (int) self::n($stock->low), 'outCount' => (int) self::n($stock->out), 'retailValue' => $m(self::n($stock->retail))]
                + ($fin ? ['costValue' => $m(self::n($stock->cost)), 'potentialProfit' => $m(self::n($stock->retail) - self::n($stock->cost))] : []),
            'series' => array_map(fn ($s) => ['date' => (string) $s->d, 'sales' => (int) $s->sales, 'total' => $m(self::n($s->total))] + ($fin ? ['profit' => $m(self::n($s->profit))] : []), $series),
            'bestSellers' => array_map(fn ($b) => ['id' => (int) $b->id, 'name' => $b->name, 'qty' => (int) self::n($b->qty), 'total' => $m(self::n($b->total))], $best),
            'slowMovers' => array_map(fn ($s) => ['id' => (int) $s->id, 'name' => $s->name, 'qtyOnHand' => (int) $s->qtyOnHand, 'soldLast60Days' => (int) self::n($s->sold)], $slow),
            'paymentMethods' => array_map(fn ($x) => ['method' => $x->method, 'total' => $m(self::n($x->v))], $methods),
            'recentSales' => $recentSales,
            'recentPurchases' => $recentPurchases,
            'lowStock' => array_map(fn ($l) => ['id' => (int) $l->id, 'name' => $l->name, 'sku' => $l->sku, 'available' => (int) $l->available, 'reorderLevel' => (int) $l->reorderLevel], $low),
        ]);
    }
}
