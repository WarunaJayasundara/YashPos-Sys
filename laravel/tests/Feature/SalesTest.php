<?php

namespace Tests\Feature;

use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SalesTest extends TestCase
{
    public function test_edits_the_customer_and_note_audited_but_never_items_or_money(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct();
        $id = $cashier->post('/api/sales', $this->sale($p->id, 2))->json('sale.id');
        $e = $cashier->patch("/api/sales/$id/details", ['customerName' => 'Kamal', 'customerPhone' => '0771234567', 'notes' => 'Gift wrap', 'total' => 1, 'items' => []])->assertOk();
        $e->assertJson(['customerName' => 'Kamal', 'customerPhone' => '0771234567', 'notes' => 'Gift wrap', 'total' => '3600']);
        $this->assertIsInt($e->json('customerId'));
        $this->assertCount(1, $e->json('items'));
        $this->assertTrue(DB::table('audit_logs')->where('action', 'sale.edit_details')->where('entityId', (string) $id)->exists());
        $this->assertNull($cashier->patch("/api/sales/$id/details", ['notes' => ''])->json('notes'));
        $this->ensureUser('t_cashier2', 'cashier')->patch("/api/sales/$id/details", ['notes' => 'x'])->assertStatus(403);
        $owner = $this->owner();
        $owner->post("/api/sales/$id/void", ['reason' => 'test void'])->assertOk();
        $owner->patch("/api/sales/$id/details", ['notes' => 'x'])->assertStatus(409);
    }

    public function test_does_not_change_the_customer_of_a_credit_bill(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['sellingPrice' => 1000, 'minSellingPrice' => 900]);
        $r = $owner->post('/api/sales', $this->sale($p->id, 1, ['customer' => ['phone' => '07'.random_int(10000000, 99999999), 'name' => 'Credit C'], 'payments' => [['method' => 'CREDIT', 'amount' => 1000]]]))->assertStatus(201);
        $e = $owner->patch("/api/sales/{$r->json('sale.id')}/details", ['customerName' => 'Someone else'])->assertStatus(409);
        $this->assertSame('CREDIT_CUSTOMER', $e->json('error.code'));
        $owner->patch("/api/sales/{$r->json('sale.id')}/details", ['notes' => 'Pay by Friday'])->assertOk();
    }

    public function test_computes_totals_on_the_server_and_ignores_client_sent_totals(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct(['sellingPrice' => 1800]);
        $r = $cashier->post('/api/sales', $this->sale($p->id, 3, ['total' => 1, 'subtotal' => 1, 'payments' => [['method' => 'CASH', 'amount' => 6000]]]))->assertStatus(201);
        $this->assertSame('5400', $r->json('sale.total'));
        $this->assertSame('600', $r->json('sale.changeDue'));
        $this->assertSame([['CASH', '5400']], array_map(fn ($x) => [$x['method'], $x['amount']], $r->json('sale.payments')));
        $this->assertArrayNotHasKey('totalCost', $r->json('sale'));
        $this->assertSame(17, $this->qty($p->id));
    }

    public function test_rejects_bad_quantities_unknown_products_and_insufficient_stock_without_side_effects(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct(['qtyOnHand' => 2]);
        $cashier->post('/api/sales', $this->sale($p->id, 0))->assertStatus(422);
        $cashier->post('/api/sales', $this->sale($p->id, -1))->assertStatus(422);
        $cashier->post('/api/sales', $this->sale(999999, 1))->assertStatus(400);
        $r = $cashier->post('/api/sales', $this->sale($p->id, 3))->assertStatus(409);
        $this->assertSame('INSUFFICIENT_STOCK', $r->json('error.code'));
        $this->assertSame(2, $this->qty($p->id));
        $this->assertSame(0, DB::table('sale_items')->where('productId', $p->id)->count());
    }

    public function test_a_multi_line_sale_is_all_or_nothing_when_one_line_lacks_stock(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $a = $this->makeProduct(['qtyOnHand' => 5]);
        $b = $this->makeProduct(['qtyOnHand' => 1]);
        $cashier->post('/api/sales', ['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $a->id, 'qty' => 2], ['productId' => $b->id, 'qty' => 2]],
            'payments' => [['method' => 'CASH', 'amount' => 10000]]])->assertStatus(409);
        $this->assertSame(5, $this->qty($a->id));
    }

    public function test_never_sells_more_than_is_in_stock(): void
    {
        $p = $this->makeProduct(['qtyOnHand' => 2]);
        $owner = $this->owner();
        $statuses = array_map(fn () => $owner->post('/api/sales', $this->sale($p->id, 1))->status(), range(1, 5));
        $this->assertSame([201, 201, 409, 409, 409], $statuses);
        $this->assertSame(0, $this->qty($p->id));
    }

    public function test_repeated_submission_with_the_same_client_request_id_creates_one_sale(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct(['qtyOnHand' => 10]);
        $body = $this->sale($p->id, 1);
        $a = $cashier->post('/api/sales', $body)->assertStatus(201);
        $b = $cashier->post('/api/sales', $body)->assertStatus(200);
        $this->assertSame($a->json('sale.id'), $b->json('sale.id'));
        $this->assertTrue($b->json('duplicate'));
        $this->assertSame(9, $this->qty($p->id));
    }

    public function test_issues_unique_sequential_invoice_numbers(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 30]);
        $nums = array_map(fn () => $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale.invoiceNumber'), range(1, 8));
        $this->assertCount(8, array_unique($nums));
        $seq = array_map(fn ($n) => (int) substr($n, strrpos($n, '-') + 1), $nums);
        sort($seq);
        $this->assertSame(7, $seq[7] - $seq[0]);
        $this->assertMatchesRegularExpression('/^YM-\d{4}-\d{6}$/', $nums[0]);
    }

    public function test_cashier_discount_above_the_role_limit_needs_supervisor_approval(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier'); // 5% limit
        $this->ensureUser('t_manager', 'manager', 'Manager!pw1');
        $p = $this->makeProduct(['sellingPrice' => 1000, 'minSellingPrice' => 800, 'qtyOnHand' => 10]);
        $cashier->post('/api/sales', $this->sale($p->id, 1, ['billDiscount' => 50]))->assertStatus(201);
        $blocked = $cashier->post('/api/sales', $this->sale($p->id, 1, ['billDiscount' => 100]))->assertStatus(403);
        $this->assertSame('APPROVAL_REQUIRED', $blocked->json('error.code'));
        $bad = $cashier->post('/api/sales', $this->sale($p->id, 1, ['billDiscount' => 100, 'approval' => ['username' => 't_cashier', 'password' => 'Passw0rd!x']]));
        $this->assertSame('APPROVAL_INVALID', $bad->json('error.code'));
        $ok = $cashier->post('/api/sales', $this->sale($p->id, 1, ['billDiscount' => 100, 'approval' => ['username' => 't_manager', 'password' => 'Manager!pw1']]))->assertStatus(201);
        $this->assertSame('900', $ok->json('sale.total'));
        $this->assertNotNull($ok->json('sale.discountApprovedById'));
    }

    public function test_selling_below_minimum_needs_approval_and_discounts_cannot_exceed_the_bill(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct(['sellingPrice' => 1000, 'minSellingPrice' => 990, 'qtyOnHand' => 10]);
        $r = $cashier->post('/api/sales', ['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $p->id, 'qty' => 1, 'unitPrice' => 980]], 'payments' => [['method' => 'CASH', 'amount' => 1000]]]);
        $this->assertSame('APPROVAL_REQUIRED', $r->json('error.code'));
        $this->owner()->post('/api/sales', $this->sale($p->id, 1, ['billDiscount' => 1500]))->assertStatus(400);
    }

    public function test_handles_split_payments_short_payments_and_credit_rules(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['sellingPrice' => 5000, 'minSellingPrice' => 4000, 'qtyOnHand' => 10]);
        $one = fn (array $payments, array $extra = []) => $owner->post('/api/sales', ['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $p->id, 'qty' => 1]], 'payments' => $payments] + $extra);
        $split = $one([['method' => 'CARD', 'amount' => 3000, 'reference' => 'AUTH1'], ['method' => 'CASH', 'amount' => 2500]])->assertStatus(201);
        $this->assertSame('500', $split->json('sale.changeDue'));
        $pays = array_map(fn ($x) => "{$x['method']}:{$x['amount']}", $split->json('sale.payments'));
        sort($pays);
        $this->assertSame(['CARD:3000', 'CASH:2000'], $pays);
        $this->assertSame('PAYMENT_SHORT', $one([['method' => 'CASH', 'amount' => 4999]])->assertStatus(422)->json('error.code'));
        $one([['method' => 'CARD', 'amount' => 6000]])->assertStatus(400);
        $one([['method' => 'CREDIT', 'amount' => 5000]])->assertStatus(400);
        $credit = $one([['method' => 'CASH', 'amount' => 1000], ['method' => 'CREDIT', 'amount' => 4000]], ['customer' => ['name' => 'Kamal', 'phone' => '0779876543']])->assertStatus(201);
        $this->assertSame('4000', $credit->json('sale.balanceDue'));
        $cust = $owner->get("/api/customers/{$credit->json('sale.customerId')}")->json();
        $this->assertSame('4000.00', $cust['balance']);
        $owner->post("/api/customers/{$cust['id']}/payments", ['amount' => 1500, 'method' => 'CASH'])->assertStatus(201);
        $this->assertSame('2500.00', $owner->get("/api/customers/{$cust['id']}")->json('balance'));
        $owner->post("/api/customers/{$cust['id']}/payments", ['amount' => 3000, 'method' => 'CASH'])->assertStatus(400);
    }

    public function test_stores_the_cost_at_the_time_of_sale(): void
    {
        $owner = $this->owner();
        $s = DB::table('suppliers')->insertGetId(['name' => 'Cost supplier', 'isActive' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
        $p = $this->makeProduct(['qtyOnHand' => 5, 'avgCost' => 1200, 'sellingPrice' => 1800]);
        $first = $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $this->assertEquals(1200, (float) $first['items'][0]['unitCost']);
        $po = $owner->post('/api/purchases', ['supplierId' => $s, 'purchaseDate' => '2026-10-05', 'items' => [['productId' => $p->id, 'qtyOrdered' => 4, 'unitCost' => 1600]]])->json();
        $owner->post("/api/purchases/{$po['id']}/receive", ['items' => [['purchaseItemId' => $po['items'][0]['id'], 'qtyReceived' => 4]]])->assertOk();
        // avg = (4*1200 + 4*1600)/8 = 1400
        $this->assertEquals(1400, (float) $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale.items.0.unitCost'));
        $again = $owner->get("/api/sales/{$first['id']}")->json();
        $this->assertEquals(1200, (float) $again['items'][0]['unitCost']);
        $this->assertSame('1200', $again['totalCost']);
    }

    public function test_cashier_can_open_only_their_own_sales(): void
    {
        $owner = $this->owner();
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct();
        $s = $owner->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $cashier->get("/api/sales/{$s['id']}")->assertStatus(403);
        $mine = $cashier->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $cashier->get("/api/sales/{$mine['id']}")->assertOk();
        $ids = array_column($cashier->get('/api/sales')->json(), 'id');
        $this->assertContains($mine['id'], $ids);
        $this->assertNotContains($s['id'], $ids);
    }

    public function test_writes_an_audit_log_entry_for_every_sale(): void
    {
        $p = $this->makeProduct();
        $s = $this->owner()->post('/api/sales', $this->sale($p->id, 1))->json('sale');
        $this->assertSame('owner', DB::table('audit_logs')->where('action', 'sale.create')->where('entityId', (string) $s['id'])->value('username'));
    }

    public function test_warranty_is_created_for_items_with_warranty(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['warrantyMonths' => 12]);
        $s = $owner->post('/api/sales', $this->sale($p->id, 1, ['items' => [['productId' => $p->id, 'qty' => 1, 'serialNumber' => 'SN-777']]]))->json('sale');
        $w = collect($owner->get('/api/warranties', ['q' => 'SN-777'])->json())->firstWhere('saleId', $s['id']);
        $this->assertTrue($w['isActive']);
        $this->assertSame((int) substr($w['startsAt'], 0, 4) + 1, (int) substr($w['expiresAt'], 0, 4));
        $this->assertSame(substr($w['startsAt'], 5, 5), substr($w['expiresAt'], 5, 5));
    }

    // ---- invoices and printing data ----

    public function test_receipt_data_is_a_snapshot(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['sellingPrice' => 1800, 'name' => 'Snapshot charger']);
        $s = $owner->post('/api/sales', $this->sale($p->id, 2))->json('sale');
        $owner->put("/api/products/$p->id", ['sellingPrice' => 2500, 'name' => 'Renamed charger'])->assertOk();
        $rec = $owner->get("/api/sales/{$s['id']}/receipt")->json();
        $this->assertSame('Snapshot charger', $rec['sale']['items'][0]['productName']);
        $this->assertSame('1800', $rec['sale']['items'][0]['unitPrice']);
        $this->assertSame('3600', $rec['sale']['total']);
        $this->assertArrayNotHasKey('unitCost', $rec['sale']['items'][0]);
        $this->assertSame('YASH MOBILE', $rec['settings']['shopName']);
    }

    public function test_generates_an_a4_pdf_invoice(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['name' => 'PDF test item']);
        $s = $owner->post('/api/sales', $this->sale($p->id, 1, ['notes' => 'Thank you, Kamal']))->json('sale');
        $pdf = $owner->get("/api/sales/{$s['id']}/invoice.pdf")->assertOk();
        $this->assertSame('application/pdf', $pdf->headers->get('Content-Type'));
        $this->assertStringStartsWith('%PDF-', $pdf->getContent());
    }
}
