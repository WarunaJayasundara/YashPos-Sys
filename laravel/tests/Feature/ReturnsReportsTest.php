<?php

namespace Tests\Feature;

use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReturnsReportsTest extends TestCase
{
    public function test_partial_return_restocks_at_original_cost_and_refunds_the_net_price_paid(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 10, 'avgCost' => 1200, 'sellingPrice' => 1800]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 3, ['billDiscount' => 300]))->json('sale'); // 5400 - 300 = 5100
        $r = $owner->post('/api/returns', ['saleId' => $s['id'], 'reason' => 'Customer changed mind', 'items' => [['saleItemId' => $s['items'][0]['id'], 'qty' => 1, 'restock' => true]]])->assertStatus(201);
        $this->assertSame('1700', $r->json('refundTotal'));
        $this->assertSame('1200', $r->json('costReversed'));
        $this->assertSame(8, $this->qty($p->id));
        $this->assertSame('PARTIALLY_RETURNED', DB::table('sales')->where('id', $s['id'])->value('status'));
        $this->assertSame('5100', $owner->get("/api/sales/{$s['id']}")->json('total'));
    }

    public function test_repeated_partial_returns_refund_exactly_the_line_total_and_over_returns_are_refused(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 10, 'sellingPrice' => 1000, 'minSellingPrice' => 100]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 3, ['billDiscount' => 100]))->json('sale'); // 2900
        $line = $s['items'][0]['id'];
        $total = 0;
        for ($i = 0; $i < 3; $i++) {
            $total += (float) $owner->post('/api/returns', ['saleId' => $s['id'], 'reason' => 'Faulty batch', 'items' => [['saleItemId' => $line, 'qty' => 1, 'restock' => true]]])->json('refundTotal');
        }
        $this->assertEquals(2900, $total);
        $this->assertSame('RETURNED', DB::table('sales')->where('id', $s['id'])->value('status'));
        $owner->post('/api/returns', ['saleId' => $s['id'], 'reason' => 'Again', 'items' => [['saleItemId' => $line, 'qty' => 1, 'restock' => true]]])->assertStatus(409);
    }

    public function test_damaged_returns_are_written_off_not_restocked(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 5]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $owner->post('/api/returns', ['saleId' => $s['id'], 'reason' => 'Broken on arrival', 'items' => [['saleItemId' => $s['items'][0]['id'], 'qty' => 1, 'restock' => false]]])->assertStatus(201);
        $this->assertSame(4, $this->qty($p->id));
        $this->assertSame(1, DB::table('stock_movements')->where('productId', $p->id)->where('type', 'DAMAGED')->count());
    }

    public function test_cashier_returns_need_supervisor_approval(): void
    {
        $owner = $this->owner();
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct();
        $s = $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $body = ['saleId' => $s['id'], 'reason' => 'Wrong model', 'items' => [['saleItemId' => $s['items'][0]['id'], 'qty' => 1, 'restock' => true]]];
        $this->assertSame('APPROVAL_REQUIRED', $cashier->post('/api/returns', $body)->json('error.code'));
        $cashier->post('/api/returns', $body + ['approval' => ['username' => 'owner', 'password' => 'Owner@12345']])->assertStatus(201);
        $this->assertSame($s['invoiceNumber'], $cashier->get('/api/returns/lookup', ['invoice' => $s['invoiceNumber']])->json('invoiceNumber'));
    }

    public function test_void_restores_stock_and_marks_the_sale_and_cannot_be_voided_twice(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 4]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 2))->json('sale');
        $this->assertSame('VOIDED', $owner->post("/api/sales/{$s['id']}/void", ['reason' => 'Keyed wrong item'])->assertOk()->json('status'));
        $this->assertSame(4, $this->qty($p->id));
        $owner->post("/api/sales/{$s['id']}/void", ['reason' => 'again'])->assertStatus(409);
    }

    public function test_cashier_void_needs_approval(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct();
        $s = $cashier->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $this->assertSame('APPROVAL_REQUIRED', $cashier->post("/api/sales/{$s['id']}/void", ['reason' => 'Wrong item'])->json('error.code'));
        $cashier->post("/api/sales/{$s['id']}/void", ['reason' => 'Wrong item', 'approval' => ['username' => 'owner', 'password' => 'Owner@12345']])->assertOk();
    }

    // ---- profit and reports ----

    public function test_gross_profit_is_net_revenue_minus_cost_with_returns_and_discounts(): void
    {
        $owner = $this->owner();
        $cat = DB::table('categories')->insertGetId(['name' => 'Profit cat '.Str::random(6), 'isActive' => 1, 'createdAt' => Clock::now()]);
        $p = $this->makeProduct(['categoryId' => $cat, 'qtyOnHand' => 20, 'avgCost' => 1200, 'sellingPrice' => 1800, 'minSellingPrice' => 1000]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 5, ['billDiscount' => 500]))->json('sale'); // 8500, cost 6000
        $owner->post('/api/returns', ['saleId' => $s['id'], 'reason' => 'Return one', 'items' => [['saleItemId' => $s['items'][0]['id'], 'qty' => 1, 'restock' => true]]])->assertStatus(201);
        $today = Clock::localToday();
        $row = $owner->get('/api/reports/profit-by-category', ['from' => $today, 'to' => $today, 'categoryId' => $cat])->json('rows.0');
        $this->assertSame(5, $row['qtySold']);
        $this->assertSame(1, $row['qtyReturned']);
        $this->assertSame('6800.00', $row['netSales']);
        $this->assertSame('4800.00', $row['cogs']);
        $this->assertSame('2000.00', $row['grossProfit']);
        $this->assertSame('500.00', $row['discounts']);
    }

    public function test_date_filters_include_today_and_exclude_other_days(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct();
        $owner->post('/api/sales', $this->sale($p->id, 1))->assertStatus(201);
        $today = Clock::localToday();
        $yesterday = Clock::addDays($today, -1);
        $this->assertCount(1, $owner->get('/api/reports/sales-by-product', ['from' => $today, 'to' => $today, 'productId' => $p->id])->json('rows'));
        $this->assertCount(0, $owner->get('/api/reports/sales-by-product', ['from' => $yesterday, 'to' => $yesterday, 'productId' => $p->id])->json('rows'));
        $owner->get('/api/reports/daily-sales', ['from' => $today, 'to' => $yesterday])->assertStatus(400);
    }

    public function test_net_profit_subtracts_expenses_and_cash_closing_ignores_non_cash(): void
    {
        $owner = $this->owner();
        $today = Clock::localToday();
        $before = $owner->get('/api/cash/summary', ['date' => $today])->json();
        $p = $this->makeProduct(['sellingPrice' => 2000, 'minSellingPrice' => 1000, 'qtyOnHand' => 5]);
        $one = fn (string $m) => $owner->post('/api/sales', ['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $p->id, 'qty' => 1]], 'payments' => [['method' => $m, 'amount' => 2000]]])->assertStatus(201);
        $one('CARD');
        $one('CASH');
        $owner->post('/api/expenses', ['category' => 'Transport', 'description' => 'Courier', 'amount' => 300, 'expenseDate' => $today, 'method' => 'CASH', 'paidFromDrawer' => true])->assertStatus(201);
        $after = $owner->get('/api/cash/summary', ['date' => $today])->json();
        $this->assertEquals(2000, (float) $after['cashSales'] - (float) $before['cashSales']);
        $this->assertEquals(300, (float) $after['cashExpenses'] - (float) $before['cashExpenses']);
        $expected = (float) $after['expectedBeforeFloat'] + 5000;
        $c = $owner->post('/api/cash/close', ['date' => $today, 'openingFloat' => 5000, 'countedCash' => $expected - 100])->assertStatus(201);
        $this->assertSame('-100', $c->json('difference'));
        $owner->post('/api/cash/close', ['date' => $today, 'openingFloat' => 0, 'countedCash' => 0])->assertStatus(409);
        $np = collect($owner->get('/api/reports/net-profit', ['from' => $today, 'to' => $today])->json('rows'));
        $line = fn (string $l) => (float) $np->first(fn ($r) => str_starts_with($r['line'], $l))['amount'];
        $this->assertEqualsWithDelta($line('Gross profit') + $line('Stock written off') + $line('Total operating expenses'), $line('Net profit'), 0.01);
    }

    public function test_exports_csv_only_for_users_allowed_to_export(): void
    {
        $csv = $this->owner()->get('/api/reports/inventory-valuation', ['format' => 'csv'])->assertOk();
        $this->assertStringContainsString('text/csv', $csv->headers->get('Content-Type'));
        $this->assertStringContainsString('Cost value', $csv->getContent());
        $this->ensureUser('t_cashier', 'cashier')->get('/api/reports/inventory-valuation', ['format' => 'csv'])->assertStatus(403);
    }

    public function test_every_report_runs_for_the_owner(): void
    {
        $owner = $this->owner();
        $keys = array_column($owner->get('/api/reports')->json(), 'key');
        $this->assertCount(20, $keys);
        foreach ($keys as $k) {
            $owner->get("/api/reports/$k", ['from' => Clock::addDays(Clock::localToday(), -30), 'to' => Clock::localToday(), 'group' => 'week'])->assertOk();
        }
        $owner->get('/api/dashboard')->assertOk()->assertJsonStructure(['today', 'period' => ['netProfit'], 'stock', 'series', 'bestSellers', 'recentSales', 'lowStock']);
    }
}
