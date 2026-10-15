<?php

namespace Tests\Feature;

use App\Http\Controllers\ProductController;
use App\Support\Clock;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    private function supplier(string $name): int
    {
        return DB::table('suppliers')->insertGetId(['name' => $name, 'isActive' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
    }

    public function test_creates_a_product_with_opening_stock_recorded_as_a_movement(): void
    {
        $owner = $this->owner();
        DB::table('categories')->insertOrIgnore(['name' => 'Chargers', 'isActive' => 1, 'createdAt' => Clock::now()]);
        $cat = DB::table('categories')->where('name', 'Chargers')->value('id');
        $r = $owner->post('/api/products', ['sku' => 'chg-test-1', 'name' => 'Type-C Fast Charger', 'categoryId' => $cat, 'purchasePrice' => 1200,
            'sellingPrice' => 1800, 'minSellingPrice' => 1600, 'openingStock' => 20]);
        $r->assertStatus(201);
        $this->assertSame('CHG-TEST-1', $r->json('sku'));
        $this->assertSame(20, $r->json('qtyOnHand'));
        $this->assertSame('600.00', $r->json('unitProfit'));
        $m = DB::table('stock_movements')->where('productId', $r->json('id'))->first();
        $this->assertSame('OPENING', $m->type);
        $this->assertSame(20, (int) $m->qtyChange);
    }

    public function test_rejects_duplicate_skus_invalid_barcodes_negative_prices_and_min_above_selling(): void
    {
        $owner = $this->owner();
        $base = ['name' => 'X product', 'categoryId' => DB::table('categories')->value('id'), 'sellingPrice' => 100, 'minSellingPrice' => 90];
        $owner->post('/api/products', $base + ['sku' => 'DUP-1'])->assertStatus(201);
        $owner->post('/api/products', $base + ['sku' => 'DUP-1'])->assertStatus(409);
        $owner->post('/api/products', $base + ['sku' => 'BC-1', 'barcode' => '4006381333932'])->assertStatus(422);
        $owner->post('/api/products', ['sku' => 'NEG-1', 'sellingPrice' => -5] + $base)->assertStatus(422);
        $owner->post('/api/products', ['sku' => 'MIN-1', 'minSellingPrice' => 150] + $base)->assertStatus(422);
        $owner->post('/api/products', $base + ['sku' => 'BC-2', 'barcode' => '4006381333931'])->assertStatus(201);
    }

    public function test_creates_a_product_from_just_a_name_and_a_price(): void
    {
        $owner = $this->owner();
        $r = $owner->post('/api/products', ['name' => 'Samsung 43 inch Smart TV', 'sellingPrice' => 125000, 'openingStock' => 2])->assertStatus(201);
        $this->assertMatchesRegularExpression('/^P-\d{5}$/', $r->json('sku'));
        $this->assertNull($r->json('categoryId'));
        $this->assertNull($r->json('brandId'));
        $this->assertSame('125000', $r->json('minSellingPrice'));
        $this->assertSame(2, $r->json('qtyOnHand'));
        $second = $owner->post('/api/products', ['name' => 'Another item', 'sellingPrice' => 100]);
        $this->assertNotSame($r->json('sku'), $second->json('sku'));

        $owner->post('/api/sales', $this->sale($r->json('id'), 1, ['payments' => [['method' => 'CASH', 'amount' => 125000]]]))->assertStatus(201);
        $today = Clock::localToday();
        $labels = array_column($owner->get('/api/reports/sales-by-category', ['from' => $today, 'to' => $today])->json('rows'), 'label');
        $this->assertContains('No category', $labels);
        $inv = collect($owner->get('/api/reports/inventory-valuation')->json('rows'))->firstWhere('name', 'Samsung 43 inch Smart TV');
        $this->assertSame('No category', $inv['category']);
        $cat = collect($owner->get('/api/products/catalog')->json('data'))->firstWhere('id', $r->json('id'));
        $this->assertNull($cat['category']);
    }

    public function test_validates_ean13_check_digits(): void
    {
        $this->assertTrue(ProductController::validBarcode('4006381333931'));
        $this->assertFalse(ProductController::validBarcode('4006381333932'));
        $this->assertTrue(ProductController::validBarcode('ABC-123'));
    }

    public function test_records_price_history_when_the_selling_price_changes(): void
    {
        $p = $this->makeProduct();
        $this->owner()->put("/api/products/$p->id", ['sellingPrice' => 1900, 'priceChangeReason' => 'Supplier increase'])->assertOk();
        $h = DB::table('price_history')->where('productId', $p->id)->get();
        $this->assertCount(1, $h);
        $this->assertEquals(1800, (float) $h[0]->oldValue);
        $this->assertEquals(1900, (float) $h[0]->newValue);
    }

    public function test_manager_selling_price_changes_need_owner_approval(): void
    {
        $manager = $this->ensureUser('t_manager', 'manager');
        $p = $this->makeProduct();
        $this->assertSame('APPROVAL_REQUIRED', $manager->put("/api/products/$p->id", ['sellingPrice' => 2000])->json('error.code'));
        $ok = $manager->put("/api/products/$p->id", ['sellingPrice' => 2000, 'approval' => ['username' => 'owner', 'password' => 'Owner@12345']])->assertOk();
        $this->assertSame('2000', $ok->json('sellingPrice'));
        $manager->put("/api/products/$p->id", ['compatibility' => 'iPhone 15'])->assertOk();
    }

    public function test_filters_low_and_out_of_stock(): void
    {
        $owner = $this->owner();
        $out = $this->makeProduct(['qtyOnHand' => 0]);
        $low = $this->makeProduct(['qtyOnHand' => 2, 'reorderLevel' => 5]);
        $outIds = array_column($owner->get('/api/products', ['status' => 'OUT', 'pageSize' => 500])->json('data'), 'id');
        $lowIds = array_column($owner->get('/api/products', ['status' => 'LOW', 'pageSize' => 500])->json('data'), 'id');
        $this->assertContains($out->id, $outIds);
        $this->assertContains($low->id, $lowIds);
        $this->assertNotContains($out->id, $lowIds);
    }

    public function test_csv_import_creates_and_updates_and_is_all_or_nothing(): void
    {
        $owner = $this->owner();
        $csv = "sku,name,category,sellingPrice,purchasePrice,openingStock\nIMP-1,Imported cable,Cables,500,300,4\n,No SKU item,,250,,\n";
        $r = $this->call('POST', '/api/products/import', [], ['yash_sid' => $this->sessionOf($owner)], ['file' => UploadedFile::fake()->createWithContent('p.csv', $csv)],
            ['HTTP_X_REQUESTED_WITH' => 'yash-pos', 'HTTP_ACCEPT' => 'application/json']);
        $r->assertOk()->assertJson(['created' => 2, 'updated' => 0]);
        $this->assertSame(4, $this->qty((int) DB::table('products')->where('sku', 'IMP-1')->value('id')));
        $bad = "sku,name,sellingPrice\nIMP-1,Imported cable,600\nIMP-2,X,abc\n";
        $r2 = $this->call('POST', '/api/products/import', [], ['yash_sid' => $this->sessionOf($owner)], ['file' => UploadedFile::fake()->createWithContent('p.csv', $bad)],
            ['HTTP_X_REQUESTED_WITH' => 'yash-pos', 'HTTP_ACCEPT' => 'application/json']);
        $r2->assertStatus(422);
        $this->assertSame('500.00', DB::table('products')->where('sku', 'IMP-1')->value('sellingPrice'));
    }

    // ---- purchases and goods receiving ----

    public function test_does_not_change_stock_when_a_purchase_order_is_created(): void
    {
        $s = $this->supplier('Test supplier');
        $p = $this->makeProduct(['qtyOnHand' => 0, 'avgCost' => 0, 'purchasePrice' => 0]);
        $this->owner()->post('/api/purchases', ['supplierId' => $s, 'purchaseDate' => '2026-10-01', 'items' => [['productId' => $p->id, 'qtyOrdered' => 10, 'unitCost' => 1000]]])->assertStatus(201);
        $this->assertSame(0, $this->qty($p->id));
    }

    public function test_adds_only_accepted_units_allocates_freight_and_keeps_a_weighted_average_cost(): void
    {
        $owner = $this->owner();
        $s = $this->supplier('Freight supplier');
        $p = $this->makeProduct(['qtyOnHand' => 10, 'avgCost' => 1000, 'purchasePrice' => 1000]);
        $po = $owner->post('/api/purchases', ['supplierId' => $s, 'purchaseDate' => '2026-10-02', 'invoiceTotal' => 24000, 'items' => [['productId' => $p->id, 'qtyOrdered' => 20, 'unitCost' => 1200]]])->json();
        $item = $po['items'][0]['id'];
        $r1 = $owner->post("/api/purchases/{$po['id']}/receive", ['additionalCost' => 1000, 'items' => [['purchaseItemId' => $item, 'qtyReceived' => 12, 'qtyDamaged' => 2]]])->assertOk();
        $this->assertSame('PARTIALLY_RECEIVED', $r1->json('status'));
        $after = DB::table('products')->find($p->id);
        $this->assertSame(20, (int) $after->qtyOnHand);
        // landed = 1200 + 1000/10 = 1300; avg = (10*1000 + 10*1300)/20 = 1150
        $this->assertEqualsWithDelta(1150, (float) $after->avgCost, 0.0001);
        $this->assertEquals(1200, (float) $after->purchasePrice);
        $owner->post("/api/purchases/{$po['id']}/receive", ['items' => [['purchaseItemId' => $item, 'qtyReceived' => 9]]])->assertStatus(400);
        $r2 = $owner->post("/api/purchases/{$po['id']}/receive", ['items' => [['purchaseItemId' => $item, 'qtyReceived' => 7, 'qtyMissing' => 1]]]);
        $this->assertSame('RECEIVED', $r2->json('status'));
    }

    public function test_tracks_supplier_payments_and_refuses_overpayment(): void
    {
        $owner = $this->owner();
        $s = $this->supplier('Paid supplier');
        $p = $this->makeProduct();
        $po = $owner->post('/api/purchases', ['supplierId' => $s, 'purchaseDate' => '2026-10-03', 'items' => [['productId' => $p->id, 'qtyOrdered' => 5, 'unitCost' => 1000]]])->json();
        $owner->post("/api/purchases/{$po['id']}/payments", ['amount' => 2000, 'method' => 'CASH'])->assertStatus(201);
        $owner->post("/api/purchases/{$po['id']}/payments", ['amount' => 3500, 'method' => 'CASH'])->assertStatus(400);
        $this->assertEquals(3000, $owner->get("/api/suppliers/$s")->json('balance'));
    }

    // ---- stock adjustments ----

    public function test_cashier_cannot_adjust_and_manager_adjustments_apply_immediately_and_are_audited(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $manager = $this->ensureUser('t_manager', 'manager');
        $p = $this->makeProduct(['qtyOnHand' => 10]);
        $cashier->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'DAMAGED', 'qtyChange' => -1, 'reason' => 'Dropped'])->assertStatus(403);
        $r = $manager->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'DAMAGED', 'qtyChange' => -2, 'reason' => 'Cracked in display'])->assertStatus(201);
        $this->assertSame('APPROVED', $r->json('status'));
        $this->assertSame(8, $this->qty($p->id));
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'stock.adjust_approve')->where('entityId', (string) $r->json('id'))->count());
        $manager->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'LOST', 'qtyChange' => -50, 'reason' => 'Stolen'])->assertStatus(409);
    }

    public function test_pending_adjustment_waits_for_approval(): void
    {
        DB::table('roles')->where('code', 'cashier')->value('id');
        $owner = $this->owner();
        $role = $owner->post('/api/roles', ['name' => 'Stock clerk', 'code' => 'stock_clerk', 'maxDiscountPercent' => 0, 'permissions' => ['products.view', 'stock.adjust']])->assertStatus(201)->json('id');
        $owner->post('/api/users', ['username' => 'clerk1', 'fullName' => 'Clerk One', 'roleId' => $role, 'password' => 'Clerk-pass1'])->assertStatus(201);
        $clerk = $this->login('clerk1', 'Clerk-pass1');
        $p = $this->makeProduct(['qtyOnHand' => 5]);
        $a = $clerk->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'ADJUSTMENT', 'qtyChange' => 3, 'reason' => 'Found in back store'])->assertStatus(201);
        $this->assertSame('PENDING', $a->json('status'));
        $this->assertSame(5, $this->qty($p->id));
        $owner->post("/api/stock/adjustments/{$a->json('id')}/decide", ['approve' => true])->assertOk()->assertJson(['status' => 'APPROVED']);
        $this->assertSame(8, $this->qty($p->id));
        $owner->post("/api/stock/adjustments/{$a->json('id')}/decide", ['approve' => true])->assertStatus(409);
    }

    private function sessionOf($agent): string
    {
        return (fn () => $this->session)->call($agent);
    }
}
