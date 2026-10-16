<?php

namespace Tests\Feature;

use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class StockUndoTest extends TestCase
{
    private function lastMove(int $productId): object
    {
        return DB::table('stock_movements')->where('productId', $productId)->orderByDesc('id')->first();
    }

    public function test_owner_undoes_wrong_opening_stock_once_and_it_stays_in_the_history(): void
    {
        $owner = $this->owner();
        $id = $owner->post('/api/products', ['name' => 'Typo stock cable', 'sellingPrice' => 500, 'openingStock' => 50])->json('id');
        $move = $this->lastMove($id);
        $row = collect($owner->get("/api/products/$id/movements")->json())->firstWhere('id', $move->id);
        $this->assertTrue($row['canUndo']);

        $owner->post("/api/stock/movements/{$move->id}/undo", ['reason' => 'typed 50 instead of 5'])->assertOk();
        $this->assertSame(0, $this->qty($id));
        $rows = collect($owner->get("/api/products/$id/movements")->json());
        $this->assertTrue($rows->firstWhere('id', $move->id)['undone']);
        $this->assertFalse($rows->firstWhere('id', $move->id)['canUndo']);
        $this->assertFalse($rows->firstWhere('refType', 'UNDO')['canUndo'], 'an undo cannot itself be undone');
        $this->assertTrue(DB::table('audit_logs')->where('action', 'stock.undo')->where('entityId', (string) $move->id)->exists());
        $owner->post("/api/stock/movements/{$move->id}/undo")->assertStatus(409);
    }

    public function test_undoing_a_write_off_puts_the_units_back(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['qtyOnHand' => 10]);
        $owner->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'DAMAGED', 'qtyChange' => -3, 'reason' => 'Wrong item marked damaged'])->assertStatus(201);
        $owner->post('/api/stock/movements/'.$this->lastMove($p->id)->id.'/undo')->assertOk();
        $this->assertSame(10, $this->qty($p->id));
    }

    public function test_cannot_undo_sales_or_units_that_were_already_sold(): void
    {
        $owner = $this->owner();
        $id = $owner->post('/api/products', ['name' => 'Sold-out item', 'sellingPrice' => 500, 'openingStock' => 2])->json('id');
        $opening = $this->lastMove($id);
        $owner->post('/api/sales', $this->sale($id, 2))->assertStatus(201);
        $sale = $this->lastMove($id);
        $this->assertSame('NOT_UNDOABLE', $owner->post("/api/stock/movements/{$sale->id}/undo")->assertStatus(409)->json('error.code'));
        $this->assertSame('INSUFFICIENT_STOCK', $owner->post("/api/stock/movements/{$opening->id}/undo")->assertStatus(409)->json('error.code'));
        $this->assertSame(0, $this->qty($id));
    }

    public function test_only_the_owner_can_undo_or_delete_by_default(): void
    {
        $p = $this->makeProduct();
        $owner = $this->owner();
        $owner->post('/api/stock/adjustments', ['productId' => $p->id, 'type' => 'ADJUSTMENT', 'qtyChange' => 1, 'reason' => 'Count fix'])->assertStatus(201);
        $move = $this->lastMove($p->id);
        $manager = $this->ensureUser('t_manager', 'manager');
        $manager->post("/api/stock/movements/{$move->id}/undo")->assertStatus(403);
        $manager->send('DELETE', "/api/products/{$p->id}")->assertStatus(403);
        $this->ensureUser('t_cashier', 'cashier')->send('DELETE', "/api/products/{$p->id}")->assertStatus(403);
        $this->assertFalse(collect($manager->get("/api/products/{$p->id}/movements")->json())->isEmpty());
    }

    public function test_owner_deletes_a_product_added_by_mistake_but_not_one_with_history(): void
    {
        $owner = $this->owner();
        $id = $owner->post('/api/products', ['name' => 'Duplicate by mistake', 'sellingPrice' => 900, 'openingStock' => 4])->json('id');
        $owner->post('/api/stock/adjustments', ['productId' => $id, 'type' => 'DAMAGED', 'qtyChange' => -1, 'reason' => 'Test'])->assertStatus(201);
        $owner->send('DELETE', "/api/products/$id")->assertOk();
        $this->assertFalse(DB::table('products')->where('id', $id)->exists());
        $this->assertSame(0, DB::table('stock_movements')->where('productId', $id)->count());
        $this->assertTrue(DB::table('audit_logs')->where('action', 'product.delete')->where('entityId', (string) $id)->exists());

        $sold = $owner->post('/api/products', ['name' => 'Sold once', 'sellingPrice' => 900, 'openingStock' => 2])->json('id');
        $owner->post('/api/sales', $this->sale($sold, 1))->assertStatus(201);
        $this->assertSame('HAS_HISTORY', $owner->send('DELETE', "/api/products/$sold")->assertStatus(409)->json('error.code'));

        $sup = DB::table('suppliers')->insertGetId(['name' => 'Undo supplier', 'isActive' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
        $ordered = $owner->post('/api/products', ['name' => 'Ordered once', 'sellingPrice' => 900])->json('id');
        $owner->post('/api/purchases', ['supplierId' => $sup, 'purchaseDate' => '2026-10-17', 'items' => [['productId' => $ordered, 'qtyOrdered' => 1, 'unitCost' => 500]]])->assertStatus(201);
        $owner->send('DELETE', "/api/products/$ordered")->assertStatus(409);
        $owner->send('DELETE', '/api/products/999999')->assertStatus(404);
    }
}
