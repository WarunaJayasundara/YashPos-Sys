<?php

namespace Tests\Feature;

use App\Services\StockAlerts;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class StockAlertsTest extends TestCase
{
    private function alerts(int $productId): array
    {
        return DB::table('stock_alerts')->where('productId', $productId)->orderBy('id')->pluck('level')->all();
    }

    private function sent(): array
    {
        return Mail::mailer()->getSymfonyTransport()->messages()->map(fn ($m) => $m->getOriginalMessage())->all();
    }

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('stock_alerts')->update(['emailedAt' => now('UTC')]); // start each test with nothing pending
        Mail::mailer()->getSymfonyTransport()->flush();
    }

    public function test_alerts_when_stock_reaches_the_reorder_level_and_again_when_it_sells_out(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 7, 'reorderLevel' => 5]);
        $owner->post('/api/sales', $this->sale($p->id, 1))->assertStatus(201); // 6 left: fine
        $this->assertSame([], $this->alerts($p->id));
        $owner->post('/api/sales', $this->sale($p->id, 1))->assertStatus(201); // 5 left: low
        $owner->post('/api/sales', $this->sale($p->id, 2))->assertStatus(201); // 3 left: still low, no repeat
        $this->assertSame(['LOW'], $this->alerts($p->id));
        $owner->post('/api/sales', $this->sale($p->id, 3))->assertStatus(201); // 0 left: sold out
        $this->assertSame(['LOW', 'OUT'], $this->alerts($p->id));
    }

    public function test_a_sale_that_fails_leaves_no_alert(): void
    {
        $owner = $this->owner();
        $a = $this->makeProduct(['qtyOnHand' => 3, 'reorderLevel' => 5]);
        $b = $this->makeProduct(['qtyOnHand' => 1]);
        $owner->post('/api/sales', ['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $a->id, 'qty' => 3], ['productId' => $b->id, 'qty' => 2]],
            'payments' => [['method' => 'CASH', 'amount' => 100000]]])->assertStatus(409);
        $this->assertSame([], $this->alerts($a->id));
    }

    public function test_damaged_write_offs_also_alert_and_inactive_products_do_not(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 6, 'reorderLevel' => 5]);
        $owner->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'DAMAGED', 'qtyChange' => -2, 'reason' => 'Cracked screens'])->assertStatus(201);
        $this->assertSame(['LOW'], $this->alerts($p->id));
        $off = $this->makeProduct(['qtyOnHand' => 6, 'reorderLevel' => 5, 'isActive' => 0]);
        $owner->post('/api/stock/adjustments', ['productId' => $off->id, 'type' => 'DAMAGED', 'qtyChange' => -6, 'reason' => 'Old stock'])->assertStatus(201);
        $this->assertSame([], $this->alerts($off->id));
    }

    public function test_the_bell_lists_low_items_for_the_owner_but_not_for_cashiers(): void
    {
        $p = $this->makeProduct(['name' => 'Bell test cable', 'qtyOnHand' => 1, 'reorderLevel' => 5]);
        $out = $this->makeProduct(['name' => 'Bell test charger', 'qtyOnHand' => 0]);
        $r = $this->owner()->get('/api/alerts/stock')->assertOk();
        $items = collect($r->json('items'))->keyBy('id');
        $this->assertSame('LOW', $items[$p->id]['status']);
        $this->assertSame(1, $items[$p->id]['available']);
        $this->assertSame('OUT', $items[$out->id]['status']);
        $this->assertGreaterThanOrEqual(1, $r->json('outCount'));
        $this->ensureUser('t_manager', 'manager')->get('/api/alerts/stock')->assertOk();
        $this->ensureUser('t_cashier', 'cashier')->get('/api/alerts/stock')->assertStatus(403);
    }

    public function test_emails_new_alerts_once_to_the_owner(): void
    {
        $owner = $this->owner();
        $owner->put('/api/settings', ['alertEmail' => 'not-an-email'])->assertStatus(422);
        $owner->put('/api/settings', ['alertEmail' => '', 'lowStockAlerts' => true])->assertOk();
        $p = $this->makeProduct(['name' => 'Email test earbuds', 'sku' => 'EM-'.Str::random(5), 'qtyOnHand' => 6, 'reorderLevel' => 5]);
        $owner->post('/api/sales', $this->sale($p->id, 2))->assertStatus(201);
        $this->assertSame(0, StockAlerts::emailPending(), 'no address set: nothing is sent, the alert waits');

        $owner->put('/api/settings', ['alertEmail' => 'owner@yashmobile.lk'])->assertOk();
        $this->assertSame(1, StockAlerts::emailPending());
        $mails = $this->sent();
        $this->assertCount(1, $mails);
        $this->assertSame('owner@yashmobile.lk', $mails[0]->getTo()[0]->getAddress());
        $this->assertStringContainsString('1 item running low', $mails[0]->getSubject());
        $this->assertStringContainsString('Email test earbuds', $mails[0]->getTextBody());
        $this->assertSame(0, StockAlerts::emailPending(), 'already emailed');

        $owner->put('/api/settings', ['lowStockAlerts' => false])->assertOk();
        $owner->post('/api/sales', $this->sale($p->id, 4))->assertStatus(201); // sold out
        $this->assertSame(0, StockAlerts::emailPending(), 'alerts switched off');
        $owner->put('/api/settings', ['lowStockAlerts' => true])->assertOk();
        $this->assertSame(1, StockAlerts::emailPending());
        $this->assertStringContainsString('sold out', $this->sent()[1]->getSubject());
        $this->assertGreaterThan(0, StockAlerts::emailSummary());
    }

    public function test_owner_can_send_a_test_email(): void
    {
        $this->owner()->post('/api/alerts/test-email', ['email' => 'owner@yashmobile.lk'])->assertOk();
        $this->assertStringContainsString('test email', $this->sent()[0]->getSubject());
        $this->ensureUser('t_cashier', 'cashier')->post('/api/alerts/test-email', ['email' => 'x@y.lk'])->assertStatus(403);
    }
}
